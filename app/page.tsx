'use client';
import { useState } from 'react';
import { CaptureCard } from '@/components/CaptureCard';
import { SavedVisits } from '@/components/SavedVisits';
import { InstallPrompt } from '@/components/InstallPrompt';

export default function Home() {
  const [lang] = useState<'en' | 'zh'>('en');
  return (
    <main className="home">
      <header>
        <span className="wordmark">
          <span className="mark" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
              <path d="M14 3v4h4" />
              <path d="M9 13.5l2 2 4-4.5" />
            </svg>
          </span>
          Health Translator
        </span>
        <p className="tagline">
          Understand your lab report in plain language — safely.
          <span className="zh" lang="zh">用您能读懂的语言，安心了解您的化验单。</span>
        </p>
      </header>
      <CaptureCard />
      <SavedVisits lang={lang} />
      <InstallPrompt />
    </main>
  );
}
