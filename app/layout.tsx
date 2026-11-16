import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AvrixCall',
  description:
    'Plain Jitsi group calls with Avrixlab branding. Join a room by name — no account, no rules.',
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
