import type { Metadata, Viewport } from 'next';
import { Fraunces, Newsreader } from 'next/font/google';
import { DisclaimerBanner } from '@/components/DisclaimerBanner';
import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
});

const newsreader = Newsreader({
  subsets: ['latin'],
  display: 'swap',
  style: ['normal', 'italic'],
  variable: '--font-newsreader',
});

export const metadata: Metadata = {
  title: 'Health Translator',
  description: 'Plain-language, safety-guarded summaries of your lab reports (Mandarin ↔ English).',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Health Translator' },
};

export const viewport: Viewport = { themeColor: '#F4EFE7', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${newsreader.variable}`}>
      <body>
        <DisclaimerBanner />
        {children}
      </body>
    </html>
  );
}
