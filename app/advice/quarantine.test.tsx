// QUARANTINE PROOF for Feature 2's /advice route (see app/advice/page.tsx for the why).
//
// This file is deliberately separate from page.test.tsx: the file-scoped vi.mock('next/navigation')
// below would replace the module for every test in whichever file it lives in, and the 21 preserved
// research tests render a next/link-using component that must keep resolving the real module.
//
// If someone later restores the portal by making page.tsx render the research component again,
// these tests fail loudly rather than silently re-shipping the harm surface.

import { describe, expect, it, vi } from 'vitest';

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ notFound }));

import AdvicePage from './page';

describe('/advice is quarantined', () => {
  it('calls notFound() instead of rendering the advice portal', () => {
    notFound.mockClear();

    expect(() => AdvicePage()).toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  // The check above is scoped to app/advice/page.tsx, so on its own it would not notice the portal
  // being re-exposed at a DIFFERENT route (adversarial probing shipped the full advice UI at
  // app/ask/page.tsx with the whole suite green). Scan every route in the app tree instead.
  it('is not re-exposed at any other route', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const appDir = join(process.cwd(), 'app');
    const pages: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (/^(page|layout|route|template|default)\.(tsx?|jsx?)$/.test(entry.name)) {
          pages.push(full);
        }
      }
    }
    await walk(appDir);
    expect(pages.length).toBeGreaterThan(0); // the walk itself must not silently find nothing

    // Strip comments first: app/page.tsx documents the quarantine by NAME, and a bare substring
    // match would flag that prose as if it were a live import.
    const stripComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/[^\n]*$/gm, '');

    const reExposed: string[] = [];
    for (const file of pages) {
      const code = stripComments(await readFile(file, 'utf8'));
      if (/AdvicePageResearch|AdviceEntryCard/.test(code)) {
        reExposed.push(file.slice(process.cwd().length + 1));
      }
    }

    expect(
      reExposed,
      'the quarantined advice portal must not be routable from anywhere',
    ).toEqual([]);
  });

  it('is a server component that ships no client bundle', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const source = await readFile(
      join(process.cwd(), 'app/advice/page.tsx'),
      'utf8',
    );

    // 'use client' here would ship the route (and its fetch path) to the browser again.
    expect(source).not.toMatch(/^\s*['"]use client['"]/m);
    // The route must not import the preserved research implementation. Matched as an import
    // specifically, because the file's comments name AdvicePageResearch.tsx on purpose.
    expect(source).not.toMatch(/^\s*import[^\n]*AdvicePageResearch/m);
    expect(source).not.toMatch(/from\s+['"][^'"]*AdvicePageResearch/);
  });
});
