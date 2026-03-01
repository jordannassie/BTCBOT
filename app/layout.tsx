import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'BTCBOT Connect',
  description: 'Next.js starter wired for Netlify and Supabase'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="page-grid">
          <main className="card">{children}</main>
        </div>
      </body>
    </html>
  );
}
