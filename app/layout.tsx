import type { ReactNode } from 'react';
import './globals.css';
import { APP_TITLE, APP_DESCRIPTION } from '@/lib/config';

export const metadata = {
  title: APP_TITLE,
  description: APP_DESCRIPTION
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
