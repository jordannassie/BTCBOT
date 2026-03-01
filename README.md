# BTCBOT Next.js Starter

This repository is a minimal **Next.js (App Router)** project configured for deployment on **Netlify** with a wired **Supabase** client.

## Features
- TypeScript + strict linting via `next lint`
- `app/` directory layout with a status panel that confirms Supabase connectivity
- Netlify deployment via `@netlify/plugin-nextjs`
- Supabase client helper touching `auth.getSession` to verify environment variables

## Local development
1. Copy `.env.example` to `.env.local` and fill in your Supabase project values.
2. Install dependencies and run the dev server:
   ```bash
   npm install
   npm run dev
   ```
3. Visit http://localhost:3000/ to see the status card and API integration.

## Supabase wiring
- `lib/supabaseClient.ts` exports a shared client using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- `/api/supabase-status` calls `supabase.auth.getSession()` and returns a JSON sanity check.
- `components/SupabaseStatus` hits that API route on the client to show live connectivity feedback.

## Netlify deployment
1. Push the repository to a Git remote that Netlify can access.
2. Create a new site on Netlify and connect your repo.
3. In Netlify site settings, set the following environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Ensure Netlify runs `npm run build` (default with the plugin).
5. The `netlify.toml` file enables the Next.js plugin, routes the publish directory to `.next`, and declares the same Supabase variables for production.

## Testing
- `npm run lint` runs Next.js's ESLint config.
- The Supabase status component exercises a basic GET request; inspect the Network tab to confirm that `/api/supabase-status` returns `200`.

## Next steps
- Swap in your actual Supabase tables, policies, or storage buckets.
- Add Netlify Functions under `netlify/functions` if you need serverless endpoints outside of Next.js.
- Configure secrets via Netlify's UI or CLI and avoid committing `.env.local`.
