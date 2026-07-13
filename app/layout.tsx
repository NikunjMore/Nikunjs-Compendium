import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Inter } from 'next/font/google';
import './globals.css';

/* Rohan's site sets Inter; we self-host it via next/font for zero layout shift. */
const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://www.nikunjmore.com'),
  title: ', I\'m Nikunj More',
  description:
    'I like building things, especially with ambitious people. Projects, school, and miscellany from Nikunj More. Click the grey boxes.',
  openGraph: {
    title: ', I\'m Nikunj More',
    description:
      'I like building things, especially with ambitious people. Click the grey boxes.',
    url: 'https://www.nikunjmore.com',
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
    <html lang="en" className={inter.className} suppressHydrationWarning>
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
            building things, especially with ambitious people, the kind who
            make you think bigger and then actually build with you. Lately,
            I&apos;ve been drawn to AI product management. My work has taken me
            through Adiom, Three Big Trees, De Anza Student Government, and
            PeerPrep. My main project is The Insight Company of California, a
            suite of private productivity tools that runs locally and keeps
            your information on your own computer. The first is a dictation
            app built around owning your voice and picking up where you left
            off. I studied at De Anza College and now study Business
            Administration and Statistics at UC Berkeley, with a minor in
            EECS. I&apos;m getting up to speed on JEPA architectures. I also
            like Vitamin D3, bouldering, pickleball, random endeavors with
            friends, and Coke Zero. Find me in the Bay Area, on LinkedIn, via
            email at nikunjmore12@gmail.com or nikunj.more@berkeley.edu, or by
            phone at (650) 880-9285.
          </div>
        </noscript>
      </body>
    </html>
  );
}
