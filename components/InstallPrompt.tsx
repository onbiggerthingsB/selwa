'use client';
import { useSyncExternalStore } from 'react';

// One-shot read of a browser-only value with an SSR fallback (false). Using
// useSyncExternalStore avoids both setState-in-effect and a hydration mismatch.
const subscribe = () => () => {};
function getSnapshot(): boolean {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return isIos && !standalone;
}
const getServerSnapshot = () => false;

export function InstallPrompt() {
  const show = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!show) return null;
  return (
    <p className="install-hint">
      Add to Home Screen: tap the Share button, then “Add to Home Screen”.
    </p>
  );
}
