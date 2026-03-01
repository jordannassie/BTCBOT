'use client';

import { useEffect, useState } from 'react';

type StatusResponse = {
  status: 'ok' | 'error';
  message: string;
  session: { expires_at: number } | null;
};

export default function SupabaseStatus() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/supabase-status', { signal: controller.signal })
      .then((res) => res.json())
      .then((payload: StatusResponse) => {
        setStatus(payload);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError('Unable to reach Supabase: ' + err.message);
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  if (loading) {
    return <p className="status">Connecting to Supabase...</p>;
  }

  if (error || !status) {
    return <p className="status error">{error ?? 'Unexpected response from Supabase.'}</p>;
  }

  return (
    <div className="status">
      <p>Status: {status.status.toUpperCase()}</p>
      <p>{status.message}</p>
      {status.session && (
        <p>Session expires: {new Date(status.session.expires_at * 1000).toLocaleString()}</p>
      )}
    </div>
  );
}
