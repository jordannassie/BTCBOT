import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'BTCBOT · Trading Dashboard',
  description: 'Professional crypto trading bot dashboard powered by Supabase'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
