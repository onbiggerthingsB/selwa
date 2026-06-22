import type { Metadata, Viewport } from 'next';
import { DisclaimerBanner } from '@/components/DisclaimerBanner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Health Translator',
  description: 'Plain-language, safety-guarded summaries of your lab reports (Mandarin ↔ English).',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Health Translator' },
};

export const viewport: Viewport = { themeColor: '#0f172a', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <DisclaimerBanner />
        {children}
      </body>
    </html>
  );
}
