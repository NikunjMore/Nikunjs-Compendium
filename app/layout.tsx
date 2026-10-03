import type { Metadata, Viewport } from 'next';
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
  themeColor: '#0b0b0b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
