// BTC Strategies page removed — product is now Copy Trading only.
// Redirect to the Copy Trading dashboard so any saved bookmarks still work.
import { redirect } from 'next/navigation';

export default function StrategiesPage() {
  redirect('/dashboard');
}
