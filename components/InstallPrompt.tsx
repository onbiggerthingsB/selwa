'use client';
import { useEffect, useState } from 'react';

export function InstallPrompt() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    setShow(isIos && !standalone);
  }, []);
  if (!show) return null;
  return (
    <p className="install-hint">
      Add to Home Screen: tap the Share button, then “Add to Home Screen”.
    </p>
  );
}
