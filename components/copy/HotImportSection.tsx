'use client';

// HOT tab — manual wallet import from Polymarket leaderboard page source.
//
// Workflow:
//   1. Operator pastes raw HTML source from any Polymarket leaderboard page.
//   2. "Extract Wallets" runs two regex passes over the text client-side.
//   3. Deduplicated candidates are shown with checkboxes; already-tracked
//      wallets are flagged and pre-deselected.
//   4. "Add Selected" / "Add All" POST each address to /api/copy/wallets,
//      which creates a tracked_wallet row + a default PAPER copy_bot.
//   5. After adding, 'copy:refresh' is dispatched so TrackedWalletsSection
//      reloads automatically — no page refresh needed.
//
// Parsing rules:
//   Pass 1 — profile URL segments:  /profile/0x[a-fA-F0-9]{40}
//   Pass 2 — bare hex addresses:    \b0x[a-fA-F0-9]{40}\b
//   Dedup: first occurrence wins; original order preserved.
//   Display names: looked up in ±500-char context window via JSON field
//   patterns ("name", "username", "pseudonym") and HTML text heuristics.

import { useCallback, useEffect, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type ExtractedWallet = {
  wallet_address: string;   // normalised lowercase 0x{40}
  display_name:   string | null;
  profile_url:    string;
};

type AddStatus = 'idle' | 'adding' | 'added' | 'error' | 'duplicate';

type CandidateRow = ExtractedWallet & {
  isTracked: boolean;
  addStatus: AddStatus;
  selected:  boolean;
};

// ─── Parsing ─────────────────────────────────────────────────────────────────

// Pass 1: /profile/0x… URL segments — highest fidelity source
const PROFILE_PATTERN = /\/profile\/(0x[a-fA-F0-9]{40})/gi;

// Pass 2: raw 0x addresses not caught by pass 1
const RAW_ADDR_PATTERN = /\b(0x[a-fA-F0-9]{40})\b/gi;

/**
 * Try to find a human-readable display name in the ±500-char context window
 * surrounding an address occurrence.
 *
 * Strategy (in priority order):
 *   1. JSON field patterns: "name":"…", "username":"…", "pseudonym":"…", etc.
 *   2. Short HTML text nodes between > and < that don't look like code.
 */
function extractDisplayName(context: string): string | null {
  // JSON patterns — most reliable when the page embeds Next.js __NEXT_DATA__
  const jsonPatterns = [
    /"(?:name|username|pseudonym|displayName|display_name|pseudo)"\s*:\s*"([^"]{2,50})"/i,
    /"(?:name|username|pseudonym|displayName|display_name|pseudo)"\s*:\s*'([^']{2,50})'/i,
  ];
  for (const pat of jsonPatterns) {
    const m = context.match(pat);
    if (m?.[1] && !/^0x[a-fA-F0-9]/i.test(m[1])) return m[1].trim();
  }

  // HTML text heuristic — find short visible text between closing and opening tags
  const htmlTextRe = />([A-Za-z][A-Za-z0-9 ._\-']{1,38})</g;
  let m: RegExpExecArray | null;
  while ((m = htmlTextRe.exec(context)) !== null) {
    const text = m[1].trim();
    if (/^0x[a-fA-F0-9]/i.test(text)) continue; // skip hex
    if (/^https?:\/\//i.test(text))   continue;  // skip URLs
    if (text.length < 2 || text.length > 40) continue;
    return text;
  }

  return null;
}

/**
 * Parse raw HTML (or plain text) and return deduplicated wallet candidates
 * in original order.
 */
function parseSource(source: string): ExtractedWallet[] {
  const seen = new Set<string>();
  const results: ExtractedWallet[] = [];
  const WINDOW = 500; // chars of context to inspect for display names

  function push(raw: string, ctxStart: number, ctxEnd: number) {
    const addr = raw.toLowerCase();
    if (seen.has(addr)) return;
    seen.add(addr);
    const ctx    = source.slice(Math.max(0, ctxStart), Math.min(source.length, ctxEnd));
    const name   = extractDisplayName(ctx);
    results.push({
      wallet_address: addr,
      display_name:   name,
      profile_url:    `https://polymarket.com/profile/${addr}`,
    });
  }

  // Pass 1 — /profile/0x…
  const p1 = new RegExp(PROFILE_PATTERN.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = p1.exec(source)) !== null) {
    push(m[1], m.index - WINDOW, m.index + m[0].length + WINDOW);
  }

  // Pass 2 — raw 0x addresses
  const p2 = new RegExp(RAW_ADDR_PATTERN.source, 'gi');
  while ((m = p2.exec(source)) !== null) {
    push(m[1], m.index - WINDOW, m.index + m[0].length + WINDOW);
  }

  return results;
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function truncate(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}

function ExternalLinkIcon() {
  return (
    <svg
      width="10" height="10" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HotImportSection() {
  const [source,       setSource]       = useState('');
  const [candidates,   setCandidates]   = useState<CandidateRow[]>([]);
  const [trackedSet,   setTrackedSet]   = useState<Set<string>>(new Set());
  const [extracted,    setExtracted]    = useState(false);
  const [working,      setWorking]      = useState(false);
  const [globalError,  setGlobalError]  = useState<string | null>(null);

  // ── Load tracked wallets for duplicate detection ───────────────────────────

  const loadTracked = useCallback(async () => {
    try {
      const r = await fetch('/api/copy/wallets', { cache: 'no-store' });
      const p = await r.json();
      if (p.ok) {
        setTrackedSet(
          new Set(
            (p.rows ?? []).map((w: { wallet_address: string }) =>
              w.wallet_address.toLowerCase()
            )
          )
        );
      }
    } catch {}
  }, []);

  useEffect(() => { loadTracked(); }, [loadTracked]);

  // Stay in sync when Wallets tab refreshes its data
  useEffect(() => {
    const onFetched = () => loadTracked();
    window.addEventListener('copy:data-fetched', onFetched);
    return () => window.removeEventListener('copy:data-fetched', onFetched);
  }, [loadTracked]);

  // ── Extract ───────────────────────────────────────────────────────────────

  const handleExtract = () => {
    if (!source.trim()) return;
    const parsed = parseSource(source);

    // Assign sequential "Hot Alpha N" fallback names to wallets with no parsed name.
    // Counter increments only for wallets without a name, preserving extraction order.
    let alphaIdx = 0;
    const rows: CandidateRow[] = parsed.map((w) => {
      let displayName = w.display_name;
      if (!displayName) {
        alphaIdx += 1;
        displayName = `Hot Alpha ${alphaIdx}`;
      }
      const isTracked = trackedSet.has(w.wallet_address);
      return {
        ...w,
        display_name: displayName,
        isTracked,
        addStatus: isTracked ? 'duplicate' : 'idle',
        selected:  !isTracked,
      };
    });

    setCandidates(rows);
    setExtracted(true);
    setGlobalError(null);
  };

  // ── Selection helpers ─────────────────────────────────────────────────────

  const toggleSelect = (addr: string) => {
    setCandidates((prev) =>
      prev.map((c) =>
        c.wallet_address === addr && c.addStatus === 'idle'
          ? { ...c, selected: !c.selected }
          : c
      )
    );
  };

  const toggleSelectAll = () => {
    const idleRows  = candidates.filter((c) => c.addStatus === 'idle');
    const allChecked = idleRows.length > 0 && idleRows.every((c) => c.selected);
    setCandidates((prev) =>
      prev.map((c) =>
        c.addStatus === 'idle' ? { ...c, selected: !allChecked } : c
      )
    );
  };

  // ── Add flow ──────────────────────────────────────────────────────────────

  /** POST one wallet; return resulting status. */
  const addOne = async (w: ExtractedWallet): Promise<AddStatus> => {
    try {
      const res = await fetch('/api/copy/wallets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          wallet_address: w.wallet_address,
          display_name:   w.display_name ?? undefined,
          source:         'hot_import',
          is_active:      false,   // always start disabled — operator reviews first
        }),
        cache: 'no-store',
      });
      const p = await res.json();
      if (p.ok) return 'added';
      // Supabase unique constraint violation
      if (p.error?.toLowerCase().includes('duplicate') ||
          p.error?.toLowerCase().includes('unique')    ||
          p.error?.toLowerCase().includes('already'))    return 'duplicate';
      return 'error';
    } catch {
      return 'error';
    }
  };

  /** Sequentially add a list of wallets, updating row state as we go. */
  const addWallets = async (toAdd: CandidateRow[]) => {
    if (!toAdd.length) return;
    setWorking(true);
    setGlobalError(null);

    for (const w of toAdd) {
      setCandidates((prev) =>
        prev.map((c) =>
          c.wallet_address === w.wallet_address ? { ...c, addStatus: 'adding' } : c
        )
      );
      const status = await addOne(w);
      setCandidates((prev) =>
        prev.map((c) =>
          c.wallet_address === w.wallet_address
            ? { ...c, addStatus: status, selected: false }
            : c
        )
      );
    }

    setWorking(false);
    // Refresh tracked set + notify Wallets tab to reload
    await loadTracked();
    window.dispatchEvent(new CustomEvent('copy:refresh'));
  };

  const handleAddSelected = () => {
    const toAdd = candidates.filter((c) => c.selected && c.addStatus === 'idle');
    addWallets(toAdd);
  };

  const handleAddAll = () => {
    const toAdd = candidates.filter((c) => c.addStatus === 'idle');
    // Visually select them all first
    setCandidates((prev) =>
      prev.map((c) => (c.addStatus === 'idle' ? { ...c, selected: true } : c))
    );
    addWallets(toAdd);
  };

  // ── Derived stats ─────────────────────────────────────────────────────────

  const totalFound    = candidates.length;
  const newCount      = candidates.filter((c) => !c.isTracked).length;
  const dupCount      = candidates.filter((c) =>  c.isTracked).length;
  const addedCount    = candidates.filter((c) => c.addStatus === 'added').length;
  const selectedCount = candidates.filter((c) => c.selected && c.addStatus === 'idle').length;
  const idleCount     = candidates.filter((c) => c.addStatus === 'idle').length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="copy-section copy-hot-import-section">

      {/* ── Section header ── */}
      <div className="copy-section-head">
        <div className="copy-section-title-row">
          <h2 className="copy-section-title">Import from Leaderboard</h2>
          <span className="copy-hot-import-badge">MANUAL IMPORT</span>
        </div>
        <p className="copy-hot-import-subtitle">
          Paste the raw HTML source from any Polymarket leaderboard page.
          Wallet addresses are extracted, deduped, and ready to track in one click.
        </p>
      </div>

      {/* ── Two-column body ── */}
      <div className="copy-hot-import-layout">

        {/* ──────────────── LEFT — paste area ──────────────── */}
        <div className="copy-hot-import-left">

          <label className="copy-hot-import-label" htmlFor="hot-source-input">
            Paste Leaderboard Source
          </label>

          <textarea
            id="hot-source-input"
            className="copy-hot-import-textarea"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              if (extracted) { setCandidates([]); setExtracted(false); }
            }}
            placeholder={
              'Paste the full HTML page source here…\n\n' +
              'How to get it:\n' +
              '1. Open the Polymarket leaderboard in your browser\n' +
              '2. Press Ctrl+U  (or Cmd+U on Mac) to view source\n' +
              '3. Select All → Copy → Paste here\n\n' +
              'You can also paste raw addresses directly, one per line.'
            }
            spellCheck={false}
            autoComplete="off"
          />

          <div className="copy-hot-import-left-footer">
            <div className="copy-hot-import-left-actions">
              <button
                className="copy-btn copy-btn-primary"
                onClick={handleExtract}
                disabled={!source.trim()}
              >
                Extract Wallets
              </button>
              {source.trim() && (
                <button
                  className="copy-btn copy-btn-secondary copy-btn-sm"
                  onClick={() => {
                    setSource('');
                    setCandidates([]);
                    setExtracted(false);
                    setGlobalError(null);
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            {source.length > 0 && (
              <span className="copy-hot-import-char-count">
                {(source.length / 1_000).toFixed(1)}k chars
              </span>
            )}
          </div>

          {/* Parsing guide */}
          <div className="copy-hot-import-guide">
            <div className="copy-hot-import-guide-title">Extraction rules</div>
            <div className="copy-hot-import-guide-row">
              <code className="copy-mono" style={{ fontSize: '0.65rem' }}>/profile/0x[a-fA-F0-9]&#123;40&#125;</code>
              <span>profile URL segments</span>
            </div>
            <div className="copy-hot-import-guide-row">
              <code className="copy-mono" style={{ fontSize: '0.65rem' }}>0x[a-fA-F0-9]&#123;40&#125;</code>
              <span>raw hex addresses</span>
            </div>
          </div>
        </div>

        {/* ──────────────── RIGHT — results ──────────────── */}
        <div className="copy-hot-import-right">

          {!extracted ? (
            /* Empty state */
            <div className="copy-hot-import-placeholder">
              <div className="copy-hot-import-placeholder-icon">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 16 12 12 8 16"/>
                  <line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                </svg>
              </div>
              <p className="copy-hot-import-placeholder-text">
                Paste source on the left and press <strong>Extract Wallets</strong>.
              </p>
            </div>

          ) : totalFound === 0 ? (
            /* No results */
            <div className="copy-hot-import-placeholder">
              <p className="copy-hot-import-placeholder-text" style={{ color: '#f87171' }}>
                No wallet addresses found in the pasted source.
                <br />
                Make sure you pasted the full page HTML, not just visible text.
              </p>
            </div>

          ) : (
            /* Results */
            <>
              {/* Stats chips */}
              <div className="copy-hot-import-stats">
                <span className="copy-hot-stat copy-hot-stat-total">{totalFound} found</span>
                <span className="copy-hot-stat copy-hot-stat-new">{newCount} new</span>
                {dupCount > 0 && (
                  <span className="copy-hot-stat copy-hot-stat-dup">{dupCount} already tracked</span>
                )}
                {addedCount > 0 && (
                  <span className="copy-hot-stat copy-hot-stat-added">{addedCount} added ✓</span>
                )}
              </div>

              {/* Candidate list */}
              <div className="copy-hot-import-list">

                {/* List header — select-all checkbox */}
                {idleCount > 0 && (
                  <div className="copy-hot-import-list-head">
                    <label className="copy-hot-import-check-wrap" title="Select / deselect all new wallets">
                      <input
                        type="checkbox"
                        className="copy-hot-import-check"
                        checked={
                          candidates.filter((c) => c.addStatus === 'idle').every((c) => c.selected)
                        }
                        onChange={toggleSelectAll}
                      />
                    </label>
                    <span className="copy-hot-import-list-head-label">
                      SELECT ALL NEW
                    </span>
                  </div>
                )}

                {candidates.map((c) => (
                  <div
                    key={c.wallet_address}
                    className={[
                      'copy-hot-import-row',
                      c.addStatus === 'added'    ? 'copy-hot-import-row-added' : '',
                      c.isTracked                ? 'copy-hot-import-row-dup'   : '',
                      c.addStatus === 'error'    ? 'copy-hot-import-row-error' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {/* Checkbox */}
                    <label className="copy-hot-import-check-wrap">
                      <input
                        type="checkbox"
                        className="copy-hot-import-check"
                        checked={c.selected}
                        disabled={c.addStatus !== 'idle'}
                        onChange={() => toggleSelect(c.wallet_address)}
                      />
                    </label>

                    {/* Identity */}
                    <div className="copy-hot-import-identity">
                      {c.display_name && (
                        <div className="copy-hot-import-name">{c.display_name}</div>
                      )}
                      <div className="copy-hot-import-addr">
                        <span className="copy-mono">{truncate(c.wallet_address)}</span>
                        <a
                          href={c.profile_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="copy-wallet-pm-link"
                          style={{ marginLeft: '0.3rem' }}
                          title={`View Polymarket profile: ${c.wallet_address}`}
                        >
                          <ExternalLinkIcon />
                        </a>
                      </div>
                    </div>

                    {/* Status label */}
                    <div className="copy-hot-import-row-status">
                      {c.addStatus === 'adding'   && (
                        <span className="copy-hot-import-status copy-hot-import-status-adding">Adding…</span>
                      )}
                      {c.addStatus === 'added'    && (
                        <span className="copy-hot-import-status copy-hot-import-status-added">✓ Tracked</span>
                      )}
                      {c.addStatus === 'error'    && (
                        <span className="copy-hot-import-status copy-hot-import-status-error">Error</span>
                      )}
                      {c.addStatus === 'duplicate' && (
                        <span className="copy-hot-import-status copy-hot-import-status-dup">Already tracked</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Action buttons */}
              {(idleCount > 0 || addedCount > 0) && (
                <div className="copy-hot-import-actions">
                  <button
                    className="copy-btn copy-btn-primary"
                    onClick={handleAddSelected}
                    disabled={working || selectedCount === 0}
                  >
                    {working ? 'Adding…' : `Add Selected (${selectedCount})`}
                  </button>
                  <button
                    className="copy-btn copy-btn-secondary"
                    onClick={handleAddAll}
                    disabled={working || idleCount === 0}
                  >
                    Add All ({idleCount})
                  </button>
                  {globalError && (
                    <span style={{ fontSize: '0.72rem', color: '#f87171' }}>{globalError}</span>
                  )}
                </div>
              )}

              {/* All done */}
              {idleCount === 0 && addedCount > 0 && dupCount + addedCount === totalFound && (
                <div className="copy-hot-import-done">
                  <span style={{ color: '#34d399', fontWeight: 700 }}>✓</span>
                  {' '}All wallets processed.{' '}
                  Switch to <strong>Wallets</strong> to see them.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
