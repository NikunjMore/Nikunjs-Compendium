import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Inter } from 'next/font/google';
import './globals.css';

/* Rohan's site sets Inter; we self-host it via next/font for zero layout shift. */
const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://nikunjs-compendium.vercel.app'),
  title: 'Nikunj’s Compendium',
  description:
    'I like building things, especially with ambitious people. Projects, school, and miscellany from Nikunj More. Click the grey boxes.',
  openGraph: {
    title: 'Nikunj’s Compendium',
    description:
      'I like building things, especially with ambitious people. Click the grey boxes.',
    url: 'https://nikunjs-compendium.vercel.app',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
  alternates: { canonical: '/' },
};

export const viewport: Viewport = {
  themeColor: '#050505',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body>
        {/* Flag JS before paint so prose stays hidden until the dots build it.
            Without JS the class never lands and the full text is visible. */}
        <Script id="js-flag" strategy="beforeInteractive">
          {"document.documentElement.classList.add('js');"}
        </Script>
        {children}
        <noscript>
          <div className="noscript">
            The interactive bits need JavaScript. The full text: I like
            building things, especially with ambitious people (currently: Arya
            Somu). I’m navigating the world one project at a time; technical
            product management seems to be on my horizon, the role where
            shipping means aligning people, not just code, ideally at
            enterprise scale. Currently building The Insight Company of
            California: useful insights for the human race, with endeavors
            like Beli for Spotify (log and rank everything you listen to,
            trade taste with friends), a road trip app (the stops, the route,
            and the drive itself in one place), and the next generation of
            recovery tracking in a form factor nobody has shipped yet. After
            hours: a bouldering AI that reads the wall and plans the optimal
            path for your height and reach, an agent that argues with you to
            help you learn (disagreement is the feature), and a bad-habit
            breaker that catches the habit the moment it starts, built on
            Meta’s dev tools. School: De Anza College (2024 to 2026, five
            associate degrees: Statistics, Economics, Business Administration,
            Accounting, Applied Math), transferring to UC Berkeley for
            Business Administration, Data Science, and Applied Math. Misc: not
            enough second and third order thinking in the world, so I made a
            program to help you with yours; vitamin D3, bouldering,
            pickleball, random endeavors with friends. Oh, and Coke Zero.
            Find me in the Bay Area, on LinkedIn (linkedin.com/in/nikunj-more),
            via email (nikunjmore12@gmail.com / nikunj.more@berkeley.edu), or
            by phone at (650) 880-9285, call or text.
          </div>
        </noscript>
      </body>
    </html>
  );
}
