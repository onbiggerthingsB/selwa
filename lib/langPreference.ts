'use client';

import { useSyncExternalStore } from 'react';
import { LANGS, type Lang } from '@/lib/i18n';

export const LANG_PREFERENCE_KEY = 'ht:language-preference';

const DEFAULT_LANG: Lang = 'en';
const CHANGE_EVENT = 'health-translator:language-preference';
let unavailableStoragePreference: Lang = DEFAULT_LANG;
let storageWriteFailed = false;

function isLang(value: string | null): value is Lang {
  return value !== null && (LANGS as readonly string[]).includes(value);
}

function getClientSnapshot(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  if (storageWriteFailed) return unavailableStoragePreference;
  try {
    const stored = window.localStorage.getItem(LANG_PREFERENCE_KEY);
    return isLang(stored) ? stored : DEFAULT_LANG;
  } catch {
    return unavailableStoragePreference;
  }
}

function getServerSnapshot(): Lang {
  return DEFAULT_LANG;
}

function subscribe(onStoreChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === LANG_PREFERENCE_KEY || event.key === null) {
      storageWriteFailed = false;
      onStoreChange();
    }
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

function setLangPreference(lang: Lang): void {
  unavailableStoragePreference = lang;
  try {
    window.localStorage.setItem(LANG_PREFERENCE_KEY, lang);
    storageWriteFailed = false;
  } catch {
    // Keep the current runtime usable when storage is blocked. A full reload
    // falls back to English because the preference could not be persisted.
    storageWriteFailed = true;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useLangPreference(): readonly [Lang, (lang: Lang) => void] {
  const lang = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
  return [lang, setLangPreference] as const;
}
