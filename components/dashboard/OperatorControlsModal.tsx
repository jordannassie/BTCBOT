'use client';

import { FormEvent, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { BotSettings } from '@/lib/botData';
import { updateOperatorSettings } from '@/app/actions/operatorControls';

type OperatorControlsModalProps = {
  onClose: () => void;
};

const formatUSD = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

type FormState = {
  isEnabled: boolean;
  mode: 'PAPER' | 'LIVE';
  edgeThreshold: string;
  tradeSize: string;
  maxTradesPerHour: string;
  paperBalanceUsd: number | null;
  paperBalanceInput: string;
};

const emptyState: FormState = {
  isEnabled: false,
  mode: 'PAPER',
  edgeThreshold: '',
  tradeSize: '',
  maxTradesPerHour: '',
  paperBalanceUsd: null,
  paperBalanceInput: ''
};

const mapSettingsToForm = (settings: BotSettings | null): FormState => {
  if (!settings) return emptyState;
  const balance = settings.paper_balance_usd ?? null;
  return {
    isEnabled: Boolean(settings.is_enabled),
    mode: settings.mode,
    edgeThreshold: settings.edge_threshold != null ? String(settings.edge_threshold) : '',
    tradeSize:
      settings.trade_size != null
        ? String(settings.trade_size)
        : settings.trade_size_usd != null
        ? String(settings.trade_size_usd)
        : '',
    maxTradesPerHour: settings.max_trades_per_hour != null ? String(settings.max_trades_per_hour) : '',
    paperBalanceUsd: balance,
    paperBalanceInput: balance != null ? balance.toFixed(2) : ''
  };
};

export default function OperatorControlsModal({ onClose }: OperatorControlsModalProps) {
  const [formState, setFormState] = useState<FormState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveConfirmed, setLiveConfirmed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const parsePaperBalance = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return Math.round(parsed * 100) / 100;
  };

  const commitPaperBalance = (): number | null => {
    const rounded = parsePaperBalance(formState.paperBalanceInput);
    setFormState((prev) => ({
      ...prev,
      paperBalanceUsd: rounded,
      paperBalanceInput: rounded != null ? rounded.toFixed(2) : ''
    }));
    return rounded;
  };

  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/bot-settings', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Unable to load operator settings');
        }
        const payload = await response.json();
        setFormState(mapSettingsToForm(payload.settings ?? null));
        setLiveConfirmed(payload.settings?.mode === 'LIVE');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load operator settings');
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const roundedBalance = commitPaperBalance();

    startTransition(() => {
      updateOperatorSettings({
        isEnabled: formState.isEnabled,
        mode: formState.mode,
        edgeThreshold: formState.edgeThreshold ? Number(formState.edgeThreshold) : null,
        tradeSize: formState.tradeSize ? Number(formState.tradeSize) : null,
        maxTradesPerHour: formState.maxTradesPerHour ? Number(formState.maxTradesPerHour) : null,
        paperBalanceUsd: roundedBalance
      })
        .then(() => {
          router.refresh();
          onClose();
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to save settings');
        });
    });
  };

  if (loading) {
    return (
      <div className="modal-backdrop">
        <div className="operator-modal">
          <p>Loading controls…</p>
        </div>
      </div>
    );
  }

  const requiresLiveConfirmation = formState.mode === 'LIVE' && !liveConfirmed;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="operator-modal">
        <header className="operator-modal__header">
          <div>
            <p className="summary-eyebrow">Operator Controls</p>
            <h2>bot settings</h2>
          </div>
          <button className="close-modal" onClick={onClose} aria-label="Close operator controls">
            ×
          </button>
        </header>

        <form className="operator-form" onSubmit={handleSubmit}>
          {error && <p className="form-error">{error}</p>}

          <label>
            <span>Bot enabled</span>
            <input
              type="checkbox"
              checked={formState.isEnabled}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, isEnabled: event.target.checked }))
              }
            />
          </label>

          <label>
            <span>Mode</span>
            <select
              value={formState.mode}
              onChange={(event) => setFormState((prev) => ({ ...prev, mode: event.target.value as 'PAPER' | 'LIVE' }))}
            >
              <option value="PAPER">PAPER</option>
              <option value="LIVE">LIVE</option>
            </select>
          </label>

          {formState.mode === 'LIVE' && (
            <label className="operator-checkbox">
              <input
                type="checkbox"
                checked={liveConfirmed}
                onChange={(event) => setLiveConfirmed(event.target.checked)}
              />
              <span>I understand this will enable LIVE trading.</span>
            </label>
          )}

          <label>
            <span>Edge threshold</span>
            <input
              type="number"
              step="0.01"
              value={formState.edgeThreshold}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, edgeThreshold: event.target.value }))
              }
            />
          </label>

          <label>
            <span>Trade size</span>
            <input
              type="number"
              step="1"
              value={formState.tradeSize}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, tradeSize: event.target.value }))
              }
            />
          </label>

          <label>
            <span>Max trades / hour</span>
            <input
              type="number"
              step="1"
              value={formState.maxTradesPerHour}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, maxTradesPerHour: event.target.value }))
              }
            />
          </label>

          <label>
            <div className="operator-label-row">
              <span>Paper balance</span>
              <span className="operator-form__meta">
                {formState.paperBalanceUsd != null ? formatUSD(formState.paperBalanceUsd) : '—'}
              </span>
            </div>
            <input
              type="text"
              inputMode="decimal"
              value={formState.paperBalanceInput}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, paperBalanceInput: event.target.value }))
              }
              onBlur={commitPaperBalance}
              placeholder="0.00"
            />
          </label>

          <button type="submit" disabled={isPending || requiresLiveConfirmation}>
            {isPending ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </div>
    </div>
  );
}
