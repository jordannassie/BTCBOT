'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import WalletSparkline from './WalletSparkline';
import SourceAvatar from './SourceAvatar';

// ─── Types ────────────────────────────────────────────────────────────────────

type WalletMetrics = {
  copy_score:       number | null;
  pnl_7d:           number | null;
  pnl_30d:          number | null;
  pnl_all:          number | null;
  win_rate:         number | null;
  trade_count:      number | null;
  trades_per_day:   number | null;   // added by migration 0007 + enrichment
  volume:           number | null;
  avg_hold_minutes: number | null;
  quick_exit_rate:  number | null;   // added by migration 0007 (worker-populated)
  max_drawdown:     number | null;
  category_focus:   string | null;
  last_trade_at:    string | null;
  updated_at:       string | null;
  // Phase 3 fast-turnover fields (null when DB migration not yet applied)
  wallet_class:          string | null;
  median_hold_minutes:   number | null;
  pct_under_15min:       number | null;
  pct_under_30min:       number | null;
  recent_closed_count:   number | null;
};

type WalletRow = {
  id: string;
  wallet_address: string;
  display_name: string | null;
  is_active: boolean;
  source: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  metrics: WalletMetrics | null;
  // Bot counts injected by GET /api/copy/wallets
  bot_count: number;           // total bots linked to this wallet
  bots_enabled_count: number;  // how many of those bots are currently enabled
};

type SeriesPoint = { x: string; y: number };
type WalletSeries = { wallet_address: string; points: SeriesPoint[] };

type SortKey    = 'copy_score' | 'pnl_7d' | 'pnl_30d' | 'pnl_all' | 'win_rate' | 'trade_count' | 'volume';
type SortDir    = 'desc' | 'asc';
type FilterMode = 'all' | 'proven' | 'candidate' | 'avoid';

// ─── Wallet classification ────────────────────────────────────────────────────
//
// Field mapping (requested → available in wallet_metrics):
//   short_market_pct  → quick_exit_rate × 100  (fraction of exits before resolution)
//   closed_positions  → trade_count             (30-day trade count from Polymarket)
//   median_hold_min   → avg_hold_minutes        (only avg available; used as proxy)
//   quick_exit_pct    → quick_exit_rate × 100   (same field as short_market_pct proxy)
//   tags              → w.tags[]                (fast / short / scalp / 5m / 15m strings)
//
// PROVEN SHORT:
//   quick_exit_rate ≥ 0.80  (= short_market_pct ≥ 80%)
//   AND trade_count ≥ 5     (= closed_positions ≥ 5)
//   AND avg_hold_minutes ≤ 20  (= median_hold_min ≤ 20)
//   [quick_exit_pct ≥ 60 is already implied by quick_exit_rate ≥ 0.80]
//   Fallback when quick_exit_rate is null: avg_hold_minutes ≤ 10 AND trade_count ≥ 5
//   OR tags contain proven/short/scalp indicators.
//
// SHORT CANDIDATE:
//   (quick_exit_rate ≥ 0.80 OR avg_hold_minutes ≤ 20)
//   AND trade_count ≥ 3
//   AND NOT PROVEN SHORT
//
// AVOID:
//   Has enough data (trade_count ≥ 5) but does not meet either short criteria
//
// null: insufficient data to classify (new wallet, no metrics yet)

export type WalletClass = 'proven-short' | 'short-candidate' | 'avoid' | null;

function classifyWallet(w: WalletRow): WalletClass {
  const m = w.metrics;
  if (!m) return null;

  const exitRate = m.quick_exit_rate;                    // 0–1 fraction
  const hold     = m.avg_hold_minutes;
  const trades   = m.trade_count ?? 0;
  const hasTags  = w.tags?.some((t) => /proven|short|scalp|5m|15m/i.test(t));

  // Signals short-exit behaviour (primary: exitRate; fallback: hold time + tags)
  const isShortMarket =
    (exitRate != null && exitRate >= 0.80) ||
    (hold != null && hold <= 10) ||
    hasTags;

  const hasEnoughData  = trades >= 5 || (hold != null && hold > 0);
  const hasMinimumData = trades >= 3 || (hold != null && hold > 0);

  if (!hasMinimumData) return null;

  // PROVEN SHORT: strong signals across all dimensions
  const provenHold = hold != null && hold > 0 && hold <= 20;
  if (isShortMarket && trades >= 5 && provenHold) return 'proven-short';

  // SHORT CANDIDATE: showing short patterns but lacking full confirmation
  const candidateHold = hold != null && hold > 0 && hold <= 20;
  if ((isShortMarket || candidateHold) && hasMinimumData) return 'short-candidate';

  // AVOID: enough data, but clearly not a short trader
  if (hasEnoughData) return 'avoid';

  return null;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtCompact(v: number | null | undefined): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const prefix = v < 0 ? '-$' : '$';
  if (abs >= 1_000_000) return `${prefix}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${prefix}${(abs / 1_000).toFixed(1)}K`;
  return `${prefix}${abs.toFixed(2)}`;
}

function fmtNum(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString();
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function fmtRelative(d: string | null | undefined): string {
  if (!d) return '—';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs  = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtHold(minutes: number | null | undefined): string {
  if (minutes == null || minutes === 0) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtTradesPerDay(perDay: number | null | undefined, total: number | null | undefined): string {
  // Use stored trades_per_day; fall back to trade_count / 30 (leaderboard window)
  const val = perDay ?? (total != null ? total / 30 : null);
  if (val == null) return '—';
  if (val < 0.1) return '<0.1/d';
  return `${val.toFixed(1)}/d`;
}

function holdClass(minutes: number | null | undefined): string {
  if (minutes == null || minutes === 0) return 'copy-td-muted';
  if (minutes <= 20)  return 'copy-fast-hold';
  if (minutes < 60)   return 'copy-fast-hold-mid';
  if (minutes < 360)  return '';
  return 'copy-td-muted';
}

// ─── Fast-trader tier ─────────────────────────────────────────────────────────
// Returns a display label + CSS modifier for the fast-trader badge and row tint.
//   FAST 5M     → avg_hold_minutes ≤ 7  (scalper / ultra-short style)
//   FAST 15M    → avg_hold_minutes ≤ 20 (short-hold swing)
//   FAST TRADER → avg_hold_minutes < 60 (sub-hour, generally fast)
//   null        → not a fast trader
type FastTier = { label: string; mod: string } | null;
function fastTier(minutes: number | null | undefined): FastTier {
  if (minutes == null || minutes === 0) return null;
  if (minutes <= 7)  return { label: 'FAST 5M',     mod: 'fast5m'  };
  if (minutes <= 20) return { label: 'FAST 15M',    mod: 'fast15m' };
  if (minutes < 60)  return { label: 'FAST TRADER', mod: 'fast'    };
  return null;
}

const truncate = (addr: string) =>
  addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;

// Deterministic random name derived from the wallet address.
// Same address always produces the same name — no DB write needed.
const NAME_ADJ = [
  'Shadow', 'Neon', 'Ghost', 'Iron', 'Silver', 'Dark', 'Swift', 'Bold',
  'Quiet', 'Frost', 'Slick', 'Deep', 'Sharp', 'Wild', 'Jade', 'Steel',
  'Copper', 'Golden', 'Crimson', 'Azure', 'Onyx', 'Ivory', 'Ember', 'Blind',
];
const NAME_NOUN = [
  'Whale', 'Wolf', 'Eagle', 'Hawk', 'Shark', 'Bull', 'Bear', 'Fox',
  'Lynx', 'Raven', 'Falcon', 'Viper', 'Orca', 'Jaguar', 'Titan',
  'Phantom', 'Cipher', 'Scout', 'Drifter', 'Nomad', 'Ranger', 'Stalker',
  'Pilgrim', 'Alpha',
];

function generateWalletName(address: string): string {
  let h = 0;
  for (let i = 0; i < address.length; i++) {
    h = Math.imul(h * 31 + address.charCodeAt(i), 1) >>> 0;
  }
  return `${NAME_ADJ[h % NAME_ADJ.length]} ${NAME_NOUN[(h >>> 4) % NAME_NOUN.length]}`;
}

const walletLabel = (w: WalletRow) =>
  w.display_name || generateWalletName(w.wallet_address);

function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'copy-score-none';
  if (score >= 70)   return 'copy-score-high';
  if (score >= 40)   return 'copy-score-mid';
  return 'copy-score-low';
}

function pnlClass(v: number | null | undefined): string {
  if (v == null) return 'copy-td-muted';
  return v >= 0 ? 'copy-num-pos' : 'copy-num-neg';
}

// ─── Status + signal helpers ──────────────────────────────────────────────────

type StatusInfo = { label: string; cls: string };

function walletStatus(w: WalletRow): StatusInfo {
  const m = w.metrics;
  // "has real data" = metrics exist with a non-trivial score or trade count
  const hasData = m != null && (
    (m.trade_count != null && m.trade_count > 0) ||
    (m.copy_score  != null && m.copy_score  > 0)
  );

  if (!hasData) {
    if (!w.is_active) return { label: 'Imported',         cls: 'copy-wallet-status-imported' };
    if (!m)           return { label: 'Collecting Data',  cls: 'copy-wallet-status-tracking' };
    return               { label: 'Tracking',            cls: 'copy-wallet-status-tracking' };
  }
  // Avg hold time drives fast/slow trader classification
  if (m?.avg_hold_minutes != null && m.avg_hold_minutes > 0 && m.avg_hold_minutes < 60) {
    return { label: 'Fast Trader', cls: 'copy-wallet-status-fast' };
  }
  if (m?.avg_hold_minutes != null && m.avg_hold_minutes >= 480) {
    return { label: 'Slow Trader', cls: 'copy-wallet-status-slow' };
  }
  if ((m?.copy_score ?? 0) > 0) {
    return { label: 'Scoring', cls: 'copy-wallet-status-scoring' };
  }
  return { label: 'No Data Yet', cls: 'copy-wallet-status-nodata' };
}

function getSignals(w: WalletRow): string[] {
  const m = w.metrics;
  if (!m) return [];
  const out: string[] = [];

  // Active Today — last trade within 24 h
  if (m.last_trade_at) {
    const h = (Date.now() - new Date(m.last_trade_at).getTime()) / 3_600_000;
    if (h < 24) out.push('Active Today');
  }

  // Fast-exit signals — only show if quick_exit_rate is explicitly available
  // (avg-hold-based fast labels are now shown as the blue fast badge instead)
  if (m.quick_exit_rate != null && m.quick_exit_rate >= 0.7) out.push('Quick Exit');

  // High Volume — > $10k in the Polymarket 30-day window
  if (m.volume != null && m.volume > 10_000) out.push('High Volume');

  return out.slice(0, 3);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ExternalLinkIcon() {
  return (
    <svg
      className="copy-wallet-ext-icon"
      width="10" height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  );
}

function WalletAddressRow({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <div className="copy-wallet-addr-row">
      <span className="copy-td-sub copy-mono" title={address}>
        {truncate(address)}
      </span>
      <button
        className="copy-wallet-copy-btn"
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy address'}
        aria-label="Copy wallet address"
      >
        {copied ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        )}
      </button>
    </div>
  );
}

// ─── Wallet Class Badge (Phase 3) ─────────────────────────────────────────────
// Displays the worker-assigned wallet_class from wallet_metrics.
// Returns '—' safely when the field is null (pre-migration or no data).
//
// Classes: FAST_COPY | CONVICTION_COPY | MIXED | AVOID | UNSCORABLE

const WALLET_CLASS_STYLES: Record<string, { bg: string; color: string; border: string; label: string }> = {
  FAST_COPY:       { bg: 'rgba(16,185,129,0.14)',   color: '#34d399', border: 'rgba(16,185,129,0.4)',  label: 'FAST COPY'   },
  CONVICTION_COPY: { bg: 'rgba(59,130,246,0.14)',   color: '#60a5fa', border: 'rgba(59,130,246,0.4)',  label: 'CONVICTION'  },
  MIXED:           { bg: 'rgba(234,179,8,0.12)',    color: '#fbbf24', border: 'rgba(234,179,8,0.35)',  label: 'MIXED'       },
  AVOID:           { bg: 'rgba(239,68,68,0.10)',    color: '#f87171', border: 'rgba(239,68,68,0.30)',  label: 'AVOID'       },
  UNSCORABLE:      { bg: 'rgba(255,255,255,0.04)',  color: 'rgba(248,250,252,0.3)', border: 'rgba(255,255,255,0.1)', label: 'UNSCORED' },
};

function WalletClassBadge({ cls }: { cls: string | null | undefined }) {
  if (!cls) return <span className="copy-td-muted">—</span>;
  const s = WALLET_CLASS_STYLES[cls];
  if (!s) {
    return (
      <span className="copy-td-muted copy-mono" style={{ fontSize: '0.68rem' }} title={`wallet_class: ${cls}`}>
        {cls}
      </span>
    );
  }
  return (
    <span
      className="copy-class-badge"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
      title={`wallet_class: ${cls}`}
    >
      {s.label}
    </span>
  );
}

function EmptyWallets({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="copy-empty">
      <div className="copy-empty-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
          <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
          <path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>
        </svg>
      </div>
      <p className="copy-empty-title">No tracked wallets</p>
      <p className="copy-empty-sub">Add a Polymarket wallet address to begin monitoring its trades and ranking its performance.</p>
      <button className="copy-btn copy-btn-primary" style={{ marginTop: '1rem' }} onClick={onAdd}>
        + Add Wallet
      </button>
    </div>
  );
}

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
}
function SortHeader({ label, sortKey, active, dir, onSort }: SortHeaderProps) {
  const isActive = active === sortKey;
  return (
    <th className={`copy-th-sort${isActive ? ` ${dir}` : ''}`} onClick={() => onSort(sortKey)} title={`Sort by ${label}`}>
      {label}
    </th>
  );
}

// ── Bot count badge per wallet row ──────────────────────────────────────────
// Green:  all bots enabled        → "3"
// Orange: some bots disabled      → "1/3"
// Grey:   all bots disabled / 0   → "0" (muted) or "0/3" (warning)

function BotCountBadge({ total, enabled }: { total: number; enabled: number }) {
  if (total === 0) {
    return <span className="copy-wallet-bots copy-wallet-bots-none">—</span>;
  }
  if (enabled === total) {
    return (
      <span className="copy-wallet-bots copy-wallet-bots-ok" title={`${total} bot${total !== 1 ? 's' : ''}, all enabled`}>
        {total}
      </span>
    );
  }
  if (enabled === 0) {
    return (
      <span className="copy-wallet-bots copy-wallet-bots-off" title={`${total} bot${total !== 1 ? 's' : ''}, all disabled — re-enable from Bots tab`}>
        0/{total}
      </span>
    );
  }
  return (
    <span className="copy-wallet-bots copy-wallet-bots-partial" title={`${enabled} of ${total} bot${total !== 1 ? 's' : ''} enabled`}>
      {enabled}/{total}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TrackedWalletsSection() {
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [seriesMap, setSeriesMap] = useState<Map<string, SeriesPoint[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Sort state
  const [sortKey, setSortKey] = useState<SortKey>('copy_score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Filter mode — which wallet class to show
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  // Add wallet form
  const [fAddress, setFAddress] = useState('');
  const [fName, setFName] = useState('');
  const [fSaving, setFSaving] = useState(false);
  const [fError, setFError] = useState<string | null>(null);
  const [fSuccess, setFSuccess] = useState(false);

  // ── Background enrichment ─────────────────────────────────────────────────
  // Fetches fresh Polymarket stats for wallets with missing or stale metrics
  // (> 1 hour since last update) and silently merges them into React state.

  const enrichStaleWallets = useCallback(async (walletList: WalletRow[]) => {
    const threshold = Date.now() - 3_600_000; // 1 hour
    const stale = walletList.filter((w) => {
      if (!w.metrics) return true;
      if (!w.metrics.updated_at) return true;
      return new Date(w.metrics.updated_at).getTime() < threshold;
    });
    if (!stale.length) return;

    setEnriching(true);
    const addresses = stale.slice(0, 20).map((w) => w.wallet_address).join(',');
    try {
      const res = await fetch(
        `/api/copy/wallet-enrich?addresses=${encodeURIComponent(addresses)}`,
        { cache: 'no-store' }
      );
      const payload = await res.json();
      if (!payload.ok) return;

      const map = new Map<string, WalletMetrics>(
        (payload.metrics ?? []).map((m: WalletMetrics & { wallet_address: string }) => [
          m.wallet_address,
          m,
        ])
      );

      setWallets((prev) =>
        prev.map((w) => {
          const fresh = map.get(w.wallet_address);
          return fresh ? { ...w, metrics: fresh } : w;
        })
      );
    } catch {
      // Best-effort — silently swallow network errors
    } finally {
      setEnriching(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [walletsRes, seriesRes] = await Promise.all([
        fetch('/api/copy/wallets', { cache: 'no-store' }),
        fetch('/api/copy/wallet-series', { cache: 'no-store' }),
      ]);

      const walletsPayload = await walletsRes.json();
      let loadedWallets: WalletRow[] = [];
      if (walletsPayload.ok) {
        loadedWallets = walletsPayload.rows ?? [];
        setWallets(loadedWallets);
      } else {
        setError(walletsPayload.error ?? 'Failed to load wallets');
      }

      if (seriesRes.ok) {
        const seriesPayload = await seriesRes.json();
        if (seriesPayload.ok) {
          const map = new Map<string, SeriesPoint[]>();
          for (const entry of (seriesPayload.series ?? []) as WalletSeries[]) {
            map.set(entry.wallet_address, entry.points);
          }
          setSeriesMap(map);
        }
      }

      // Trigger background enrichment without blocking render
      if (loadedWallets.length > 0) {
        enrichStaleWallets(loadedWallets);
      }
    } catch {
      setError('Network error loading wallets');
    } finally {
      setLoading(false);
    }
  }, [enrichStaleWallets]);

  useEffect(() => { load(); }, [load]);

  // ── Sort ──────────────────────────────────────────────────────────────────

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  // Classification counts for filter pills — computed once per wallet load
  const classCounts = useMemo(() => {
    const counts = { proven: 0, candidate: 0, avoid: 0 };
    for (const w of wallets) {
      const c = classifyWallet(w);
      if (c === 'proven-short')    counts.proven++;
      else if (c === 'short-candidate') counts.candidate++;
      else if (c === 'avoid')      counts.avoid++;
    }
    return counts;
  }, [wallets]);

  // Classification rank: proven-short=0, short-candidate=1, avoid=2, null=3
  const classRank = (w: WalletRow) => {
    const c = classifyWallet(w);
    if (c === 'proven-short')    return 0;
    if (c === 'short-candidate') return 1;
    if (c === 'avoid')           return 2;
    return 3;
  };

  const sorted = useMemo(() => {
    // 1. Filter
    const filterClass: Record<FilterMode, WalletClass | null> = {
      all: null, proven: 'proven-short', candidate: 'short-candidate', avoid: 'avoid',
    };
    const targetClass = filterClass[filterMode];
    const base = targetClass ? wallets.filter((w) => classifyWallet(w) === targetClass) : wallets;

    // 2. Sort
    return [...base].sort((a, b) => {
      // Active wallets always float above inactive ones
      const activeDiff = (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0);
      if (activeDiff !== 0) return activeDiff;

      // In "All" view: proven-short first → candidate → avoid → unclassified
      if (filterMode === 'all') {
        const rankDiff = classRank(a) - classRank(b);
        if (rankDiff !== 0) return rankDiff;
      }

      // Within same class group: sort by avg_hold_minutes ascending (fastest first)
      // for proven/candidate views; fall back to metric sort otherwise
      if (filterMode === 'proven' || filterMode === 'candidate' || filterMode === 'all') {
        const ah_a = a.metrics?.avg_hold_minutes ?? Infinity;
        const ah_b = b.metrics?.avg_hold_minutes ?? Infinity;
        if (ah_a !== ah_b) return ah_a - ah_b;
      }

      // Tiebreaker: chosen column sort
      const av = a.metrics?.[sortKey] ?? -Infinity;
      const bv = b.metrics?.[sortKey] ?? -Infinity;
      return sortDir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets, sortKey, sortDir, filterMode]);

  // ── Toggle single wallet ──────────────────────────────────────────────────
  // Optimistic: flip immediately, revert + show inline error if save fails.

  const handleToggleActive = async (wallet: WalletRow) => {
    const nextActive = !wallet.is_active;

    // Flip immediately in local state so the toggle feels instant
    setWallets((prev) =>
      prev.map((w) =>
        w.wallet_address === wallet.wallet_address ? { ...w, is_active: nextActive } : w
      )
    );
    setTogglingId(wallet.wallet_address);

    try {
      const res = await fetch('/api/copy/wallets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: wallet.wallet_address, is_active: nextActive }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok) {
        await load(); // reload for accurate bot counts
      } else {
        // Revert optimistic change
        setWallets((prev) =>
          prev.map((w) =>
            w.wallet_address === wallet.wallet_address ? { ...w, is_active: wallet.is_active } : w
          )
        );
        setToggleError(payload.error ?? 'Failed to update — reverted');
        setTimeout(() => setToggleError(null), 4_000);
      }
    } catch {
      setWallets((prev) =>
        prev.map((w) =>
          w.wallet_address === wallet.wallet_address ? { ...w, is_active: wallet.is_active } : w
        )
      );
      setToggleError('Network error — change reverted');
      setTimeout(() => setToggleError(null), 4_000);
    } finally {
      setTogglingId(null);
    }
  };

  // ── Bulk selection helpers ────────────────────────────────────────────────

  const allSelected = wallets.length > 0 && selectedIds.size === wallets.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleSelect = (addr: string) =>
    setSelectedIds((prev) => { const s = new Set(prev); s.has(addr) ? s.delete(addr) : s.add(addr); return s; });

  const toggleSelectAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(wallets.map((w) => w.wallet_address)));

  const clearSelection = () => setSelectedIds(new Set());

  // ── Bulk toggle selected wallets + their linked bots ─────────────────────
  // Syncs all selected wallets to the specified is_active value.
  // Linked bots are mirrored automatically by the API (wallet is master switch).

  const handleBulkSetActive = async (activate: boolean) => {
    const targets  = wallets.filter((w) => selectedIds.has(w.wallet_address));
    const toChange = targets.filter((w) => w.is_active !== activate);

    if (toChange.length === 0) {
      clearSelection();
      return;
    }

    setBulkWorking(true);
    try {
      await Promise.all(
        toChange.map((w) =>
          fetch('/api/copy/wallets', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet_address: w.wallet_address, is_active: activate }),
            cache: 'no-store',
          })
        )
      );
      await load();
      clearSelection();
      const verbPast = activate ? 'enabled' : 'disabled';
      setBulkResult(`${toChange.length} wallet${toChange.length !== 1 ? 's' : ''} ${verbPast}.`);
      setTimeout(() => setBulkResult(null), 5_000);
    } finally {
      setBulkWorking(false);
    }
  };

  // ── Add wallet ────────────────────────────────────────────────────────────

  const handleAddWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    setFError(null);
    setFSuccess(false);
    if (!fAddress.trim()) { setFError('Wallet address is required'); return; }
    setFSaving(true);
    try {
      const res = await fetch('/api/copy/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: fAddress.trim(), display_name: fName.trim() || undefined }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (!payload.ok) { setFError(payload.error ?? 'Failed to add wallet'); return; }
      setFAddress('');
      setFName('');
      setFSuccess(true);
      await load();
      setTimeout(() => setFSuccess(false), 2500);
    } finally {
      setFSaving(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="copy-section">
      {/* ── Section header ── */}
      <div className="copy-section-head">
        <div className="copy-section-title-row">
          <h2 className="copy-section-title">Tracked Wallets</h2>
          {!loading && wallets.length > 0 && (
            <span className="copy-section-count">
              {filterMode !== 'all' ? `${sorted.length} / ${wallets.length}` : wallets.length}
            </span>
          )}
          {enriching && (
            <span className="copy-wallet-enriching" title="Fetching fresh stats from Polymarket…">
              ⟳ Enriching
            </span>
          )}
        </div>
        <div className="copy-section-actions">
          <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={load} disabled={loading} title="Refresh">↻</button>
          <button
            className={`copy-btn copy-btn-sm ${showForm ? 'copy-btn-secondary' : 'copy-btn-primary'}`}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? 'Cancel' : '+ Add Wallet'}
          </button>
        </div>
      </div>

      {/* ── Classification filter bar ── */}
      {!loading && wallets.length > 0 && (
        <div className="copy-filter-bar">
          <button
            className={`copy-filter-btn ${filterMode === 'all' ? 'copy-filter-btn-active' : ''}`}
            onClick={() => setFilterMode('all')}
          >
            All Wallets
            <span className="copy-filter-count">{wallets.length}</span>
          </button>
          <button
            className={`copy-filter-btn copy-filter-btn-proven ${filterMode === 'proven' ? 'copy-filter-btn-active copy-filter-btn-proven-active' : ''}`}
            onClick={() => setFilterMode('proven')}
            title="quick_exit_rate ≥80% · trade_count ≥5 · avg_hold ≤20m"
          >
            Proven Short
            {classCounts.proven > 0 && <span className="copy-filter-count">{classCounts.proven}</span>}
          </button>
          <button
            className={`copy-filter-btn copy-filter-btn-candidate ${filterMode === 'candidate' ? 'copy-filter-btn-active copy-filter-btn-candidate-active' : ''}`}
            onClick={() => setFilterMode('candidate')}
            title="avg_hold ≤20m · trade_count ≥3 · not yet Proven Short"
          >
            Short Candidate
            {classCounts.candidate > 0 && <span className="copy-filter-count">{classCounts.candidate}</span>}
          </button>
          <button
            className={`copy-filter-btn copy-filter-btn-avoid ${filterMode === 'avoid' ? 'copy-filter-btn-active copy-filter-btn-avoid-active' : ''}`}
            onClick={() => setFilterMode('avoid')}
            title="Has ≥5 trades but does not meet short-trader criteria"
          >
            Avoid
            {classCounts.avoid > 0 && <span className="copy-filter-count">{classCounts.avoid}</span>}
          </button>
        </div>
      )}

      {/* Bulk action result */}
      {bulkResult && (
        <div className="copy-backfill-result">✓ {bulkResult}</div>
      )}

      {/* Inline toggle error (auto-clears after 4 s) */}
      {toggleError && (
        <div className="copy-toggle-error">{toggleError}</div>
      )}

      {/* ── Bulk selection bar (appears when selection > 0) ── */}
      {!loading && wallets.length > 0 && (
        <div className="copy-bulk-bar">
          <label className="copy-bulk-bar-select-all" title={allSelected ? 'Deselect all' : 'Select all'}>
            <input
              type="checkbox"
              className="copy-bulk-check"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected; }}
              onChange={toggleSelectAll}
            />
            <span style={{ fontSize: '0.75rem', color: 'rgba(248,250,252,0.5)' }}>
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select'}
            </span>
          </label>

          {selectedIds.size > 0 && (
            <>
              <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={clearSelection}>
                Clear
              </button>
              <div style={{ display: 'flex', gap: '0.4rem', marginLeft: 'auto' }}>
                <button
                  className="copy-btn copy-btn-secondary copy-btn-sm"
                  onClick={() => handleBulkSetActive(true)}
                  disabled={bulkWorking}
                  title="Enable selected wallets and re-enable their linked bots"
                >
                  {bulkWorking ? '…' : `Enable (${selectedIds.size})`}
                </button>
                <button
                  className="copy-btn copy-btn-sm copy-btn-danger"
                  onClick={() => handleBulkSetActive(false)}
                  disabled={bulkWorking}
                  title="Disable selected wallets and disable their linked bots"
                >
                  {bulkWorking ? 'Working…' : `Disable (${selectedIds.size})`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Add wallet form ── */}
      {showForm && (
        <form className="copy-add-form" onSubmit={handleAddWallet}>
          <div className="copy-form-title">Add Tracked Wallet</div>
          <div className="copy-form-grid">
            <div className="copy-form-field copy-form-grid-wide">
              <label className="copy-form-label">
                Wallet Address <span style={{ color: '#f87171' }}>*</span>
              </label>
              <input
                className="copy-form-input"
                value={fAddress}
                onChange={(e) => setFAddress(e.target.value)}
                placeholder="0x…"
                spellCheck={false}
                autoComplete="off"
              />
              <span className="copy-form-hint">Paste the full Polymarket wallet address</span>
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Display Name</label>
              <input
                className="copy-form-input"
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="e.g. Whale A"
              />
              <span className="copy-form-hint">Optional label for this wallet</span>
            </div>
          </div>
          <div className="copy-form-actions">
            <button className="copy-btn copy-btn-primary" type="submit" disabled={fSaving}>
              {fSaving ? 'Adding…' : 'Add Wallet'}
            </button>
            {fError && <span className="copy-form-msg copy-form-error">{fError}</span>}
            {fSuccess && <span className="copy-form-msg copy-form-success">Wallet added successfully.</span>}
          </div>
        </form>
      )}

      {/* ── Table / states ── */}
      {loading ? (
        <div className="copy-loading">Loading wallets…</div>
      ) : error ? (
        <div className="copy-empty">
          <p className="copy-empty-title" style={{ color: '#f87171' }}>{error}</p>
        </div>
      ) : wallets.length === 0 ? (
        <EmptyWallets onAdd={() => setShowForm(true)} />
      ) : sorted.length === 0 && filterMode !== 'all' ? (
        <div className="copy-filter-empty">
          <span>
            {filterMode === 'proven'    && 'No Proven Short wallets yet — needs quick_exit_rate ≥80%, avg hold ≤20m, and ≥5 trades.'}
            {filterMode === 'candidate' && 'No Short Candidates yet — needs avg hold ≤20m and ≥3 trades.'}
            {filterMode === 'avoid'     && 'No Avoid wallets — all tracked wallets are showing short-trader signals.'}
          </span>
          <button className="copy-filter-empty-reset" onClick={() => setFilterMode('all')}>Show all wallets</button>
        </div>
      ) : (
        <div className="copy-table-wrap copy-table-scroll">
          <table className="copy-table copy-table-leaderboard">
            <thead>
              <tr>
                {/* Checkbox column */}
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    className="copy-bulk-check"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleSelectAll}
                    title={allSelected ? 'Deselect all' : 'Select all'}
                  />
                </th>
                <th className="copy-th-rank">#</th>
                <th style={{ minWidth: 200 }}>Wallet</th>
                <th style={{ minWidth: 68 }} title="Average position hold time — FAST 5M ≤7m · FAST 15M ≤20m · FAST TRADER <60m">Avg Hold</th>
                <th style={{ minWidth: 96 }} title="Worker-assigned wallet class: FAST_COPY · CONVICTION_COPY · MIXED · AVOID · UNSCORABLE">W. Class</th>
                <th style={{ minWidth: 72 }} title="Median hold time of closed trades (worker fast-turnover metric)">Med Hold</th>
                <th style={{ minWidth: 52 }} title="% of closed trades held under 15 minutes">%≤15m</th>
                <th style={{ minWidth: 52 }} title="Recent closed trade count (fast-turnover window)">Closed</th>
                <th style={{ minWidth: 50 }}>Active</th>
                <th style={{ minWidth: 60 }} title="Linked copy bots (enabled / total)">Bots</th>
                <SortHeader label="Score"      sortKey="copy_score"  active={sortKey} dir={sortDir} onSort={handleSort} />
                <th style={{ minWidth: 92 }}>Trend</th>
                <SortHeader label="7d P/L"     sortKey="pnl_7d"      active={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="30d P/L"    sortKey="pnl_30d"     active={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="All-time"   sortKey="pnl_all"     active={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Win Rate"   sortKey="win_rate"    active={sortKey} dir={sortDir} onSort={handleSort} />
                <th style={{ minWidth: 78 }} title="Estimated trades per day (trade_count ÷ 30-day window)">Trades/Day</th>
                <SortHeader label="Volume"     sortKey="volume"      active={sortKey} dir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((w, idx) => {
                const m          = w.metrics;
                const points     = seriesMap.get(w.wallet_address) ?? [];
                const winPct     = m?.win_rate != null ? m.win_rate * 100 : null;
                const isSelected = selectedIds.has(w.wallet_address);
                const tier       = fastTier(m?.avg_hold_minutes);
                const wClass     = classifyWallet(w);

                return (
                  <tr
                    key={w.wallet_address}
                    className={[
                      w.is_active ? '' : 'copy-row-inactive',
                      isSelected ? 'copy-row-selected' : '',
                      // Fast-tier row tint (blue gradient by speed)
                      tier ? `copy-row-${tier.mod}` : '',
                      // Classification row accent
                      wClass === 'proven-short' ? 'copy-row-proven-short' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {/* Row checkbox */}
                    <td>
                      <input
                        type="checkbox"
                        className="copy-bulk-check"
                        checked={isSelected}
                        onChange={() => toggleSelect(w.wallet_address)}
                      />
                    </td>

                    {/* Rank */}
                    <td className="copy-td-rank">{idx + 1}</td>

                    {/* Wallet identity */}
                    <td>
                      {/* Name row: avatar · HOT badge · classification badge · fast-speed badge · name link */}
                      <div className="copy-wallet-identity-name-row" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <SourceAvatar sourceType="COPY_TRADER" name={walletLabel(w)} size={28} style={{ flexShrink: 0 }} />
                        {w.source === 'hot_import' && (
                          <span className="copy-wallet-hot-badge" title="Imported via HOT tab">HOT</span>
                        )}
                        {wClass === 'proven-short' && (
                          <span className="copy-class-badge copy-class-badge-proven" title="quick_exit_rate ≥80% · avg hold ≤20m · ≥5 trades">
                            PROVEN SHORT
                          </span>
                        )}
                        {wClass === 'short-candidate' && (
                          <span className="copy-class-badge copy-class-badge-candidate" title="avg hold ≤20m · ≥3 trades · not yet Proven Short">
                            SHORT CANDIDATE
                          </span>
                        )}
                        {wClass === 'avoid' && (
                          <span className="copy-class-badge copy-class-badge-avoid" title="Sufficient data — does not meet short-trader criteria">
                            AVOID
                          </span>
                        )}
                        {tier && (
                          <span
                            className={`copy-fast-badge copy-fast-badge-${tier.mod}`}
                            title={`Avg hold: ${fmtHold(m?.avg_hold_minutes)}`}
                          >
                            {tier.label}
                          </span>
                        )}
                        <a
                          className="copy-td-name copy-wallet-pm-link"
                          href={`https://polymarket.com/profile/${w.wallet_address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View on Polymarket"
                        >
                          {w.display_name ?? generateWalletName(w.wallet_address)}
                          <ExternalLinkIcon />
                        </a>
                      </div>
                      {/* Address row: copy-to-clipboard + truncated address */}
                      <WalletAddressRow address={w.wallet_address} />
                      {/* Status label + quick-trading signal chips */}
                      <div className="copy-wallet-signals-row">
                        {(() => {
                          const s = walletStatus(w);
                          return <span className={`copy-wallet-status ${s.cls}`}>{s.label}</span>;
                        })()}
                        {getSignals(w).map((sig) => (
                          <span key={sig} className="copy-wallet-signal">{sig}</span>
                        ))}
                      </div>
                    </td>

                    {/* Avg Hold — moved to front for fast-trader visibility */}
                    <td className={`copy-td-num ${holdClass(m?.avg_hold_minutes)}`} style={{ fontWeight: tier ? 600 : undefined }}>
                      {fmtHold(m?.avg_hold_minutes)}
                    </td>

                    {/* Wallet Class — Phase 3 fast-turnover worker scoring */}
                    <td className="copy-td-num">
                      <WalletClassBadge cls={m?.wallet_class} />
                    </td>

                    {/* Median Hold — Phase 3 */}
                    <td className={`copy-td-num ${holdClass(m?.median_hold_minutes)}`}>
                      {fmtHold(m?.median_hold_minutes)}
                    </td>

                    {/* % ≤15m — Phase 3 */}
                    <td className="copy-td-num copy-td-muted">
                      {m?.pct_under_15min != null
                        ? `${(m.pct_under_15min * 100).toFixed(0)}%`
                        : '—'}
                    </td>

                    {/* Recent Closed Count — Phase 3 */}
                    <td className="copy-td-num copy-td-muted">
                      {m?.recent_closed_count ?? '—'}
                    </td>

                    {/* Active toggle */}
                    <td>
                      <div className="toggle-switch" style={{ width: 36, height: 20 }}>
                        <input
                          type="checkbox"
                          checked={w.is_active}
                          onChange={() => handleToggleActive(w)}
                          disabled={togglingId === w.wallet_address}
                          id={`wallet-active-${w.wallet_address}`}
                        />
                        <label className="toggle-slider" htmlFor={`wallet-active-${w.wallet_address}`} />
                      </div>
                    </td>

                    {/* Linked bots count */}
                    <td className="copy-td-num">
                      <BotCountBadge total={w.bot_count} enabled={w.bots_enabled_count} />
                    </td>

                    {/* Copy score */}
                    <td className="copy-td-num">
                      {m?.copy_score != null ? (
                        <span className={`copy-score-badge ${scoreColor(m.copy_score)}`}>
                          {m.copy_score.toFixed(1)}
                        </span>
                      ) : (
                        <span className="copy-td-muted">—</span>
                      )}
                    </td>

                    {/* Sparkline */}
                    <td className="copy-td-sparkline">
                      <WalletSparkline points={points} walletAddress={w.wallet_address} />
                    </td>

                    {/* P/L */}
                    <td className={`copy-td-num ${pnlClass(m?.pnl_7d)}`}>{fmtCompact(m?.pnl_7d)}</td>
                    <td className={`copy-td-num ${pnlClass(m?.pnl_30d)}`}>{fmtCompact(m?.pnl_30d)}</td>
                    <td className={`copy-td-num ${pnlClass(m?.pnl_all)}`}>{fmtCompact(m?.pnl_all)}</td>

                    {/* Win rate */}
                    <td className="copy-td-num">
                      {winPct != null ? (
                        <div className="copy-winrate">
                          <span style={{ color: winPct >= 55 ? '#34d399' : winPct >= 40 ? '#fbbf24' : '#f87171' }}>
                            {fmtPct(m?.win_rate)}
                          </span>
                          <div className="copy-winrate-bar">
                            <div
                              className="copy-winrate-fill"
                              style={{
                                width: `${Math.min(100, winPct)}%`,
                                background: winPct >= 55 ? '#34d399' : winPct >= 40 ? '#fbbf24' : '#f87171',
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="copy-td-muted">—</span>
                      )}
                    </td>

                    {/* Trades/Day */}
                    <td className="copy-td-num copy-td-muted">
                      {fmtTradesPerDay(m?.trades_per_day, m?.trade_count)}
                    </td>

                    <td className="copy-td-num copy-td-muted">{fmtCompact(m?.volume)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
