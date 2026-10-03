import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

const description =
  'UC Berkeley Haas + Stats student who builds AI products. Looking for a Summer 2027 product management internship.';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.nikunjmore.com'),
  title: 'Nikunj More',
  description,
  openGraph: {
    title: 'Nikunj More',
    description,
    url: 'https://www.nikunjmore.com',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
  alternates: { canonical: '/' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eeebe3' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1020' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
