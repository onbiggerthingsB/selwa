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
        <h1>Health Translator</h1>
        <p className="tagline">Understand your lab report in plain language — safely.</p>
      </header>
      <CaptureCard />
      <SavedVisits lang={lang} />
      <InstallPrompt />
    </main>
  );
}
