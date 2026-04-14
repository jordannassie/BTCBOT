// REDIRECT STUB — this route is not linked from the active dashboard UI.
// DashboardContent handles the Activity tab via client-side state, not URL routing.
// This page exists as a safety net in case anyone navigates directly to
// /dashboard/activity (e.g. via a bookmark or old link). It simply sends them
// back to /dashboard where the Activity tab is accessible.
// Do not add real content here without also wiring up DashboardContent to
// respect this URL, or replacing it with a proper route-based tab system.

import { redirect } from 'next/navigation';

export default function ActivityPage() {
  redirect('/dashboard');
}
