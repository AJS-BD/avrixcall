import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AvrixCall — Group calls for Avrixlab investors',
  description:
    'Admin-run group calls: one speaker at a time, live text chat for everyone.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-screen bg-[#0a0a0a] text-neutral-200 antialiased">
        {children}
      </body>
    </html>
  );
}
