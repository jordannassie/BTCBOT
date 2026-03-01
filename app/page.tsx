import SupabaseStatus from '@/components/SupabaseStatus';

export default function HomePage() {
  return (
    <>
      <section>
        <h1>BTCBOT · Netlify + Supabase</h1>
        <p>
          This Next.js app is pre-wired to deploy on Netlify using the official plugin and talk to a Supabase
          project via environment variables.
        </p>
      </section>

      <section>
        <h2>Supabase Connection</h2>
        <p className="small">
          The client-side component below pings the `/api/supabase-status` route, which uses the server-side
          Supabase client. You can monitor the HTTP status to verify your credentials work before wiring
          real data tables.
        </p>
        <SupabaseStatus />
      </section>

      <section>
        <h2>Next Steps</h2>
        <ul>
          <li>Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` both locally and on Netlify.</li>
          <li>Create a Supabase table or storage bucket to start persisting data.</li>
          <li>Extend the `/api` folder with your own routes or use Supabase Edge Functions.</li>
        </ul>
      </section>
    </>
  );
}
