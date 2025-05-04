import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Mastodon EU Feed',
  description: 'Explore public timelines from European Mastodon instances.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}