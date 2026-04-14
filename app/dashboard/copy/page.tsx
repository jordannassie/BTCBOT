import { redirect } from 'next/navigation';

// Copy Trading is now at /dashboard (the main dashboard).
// This permanent redirect preserves any bookmarks to the old /dashboard/copy route.
export default function CopyTradingRedirect() {
  redirect('/dashboard');
}
