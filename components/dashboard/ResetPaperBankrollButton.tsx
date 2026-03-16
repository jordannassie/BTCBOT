'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Message = { text: string; type: 'success' | 'error' };

export default function ResetPaperBankrollButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const handleReset = async () => {
    if (loading) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/paper-bankroll-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true })
      });
      const payload = await res.json();
      if (payload.ok) {
        setMessage({ text: 'Paper bankrolls reset', type: 'success' });
        router.refresh();
      } else {
        setMessage({ text: payload.error ?? 'Reset failed', type: 'error' });
      }
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Unexpected error', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="account-summary-reset">
      <button className="range-btn reset-bankroll-btn" type="button" onClick={handleReset} disabled={loading}>
        {loading ? 'Resetting…' : 'Reset Paper Bankroll'}
      </button>
      {message && (
        <p className={`account-summary-reset-message ${message.type}`}>{message.text}</p>
      )}
    </div>
  );
}
