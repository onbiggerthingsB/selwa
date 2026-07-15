// Corpus plumbing for the real-content measurement: a DETERMINISTIC train/held-out split
// (so coverage work — Step 2 — is developed on train and gated on held-out it never saw,
// preventing overfit to the sample), and a CSV loader for the rigorous run once the real
// MedRepBench label CSV is downloaded locally (the sandbox blocks curl and the HF APIs 503,
// so the committed sample is WebFetch-transcribed; point MEDREPBENCH_CSV at the real file
// for a defensible number).

import { existsSync, readFileSync } from 'node:fs';
import { MEDREPBENCH_SAMPLE, type RealReport, type RealItem } from './sample';

// Deterministic [0,1) hash (FNV-1a → normalized). Reproducible, no RNG — required so the
// held-out split is identical across runs (and Math.random is unavailable here anyway).
function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

export interface CorpusSplit {
  train: RealReport[];
  heldout: RealReport[];
}

// Split by report (never split a report's rows across sets). Held-out is the gate.
export function splitCorpus(reports: RealReport[], heldoutFraction = 0.34): CorpusSplit {
  const train: RealReport[] = [];
  const heldout: RealReport[] = [];
  for (const r of reports) (hash01(r.image) < heldoutFraction ? heldout : train).push(r);
  return { train, heldout };
}

// Minimal RFC-4180 CSV field splitter (handles quoted fields with embedded commas, quotes,
// and newlines — the `items` column is JSON, so it needs this).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// Load the real MedRepBench label CSV (columns image, meta, items) → RealReport[].
export function loadMedRepBenchCsv(path: string): RealReport[] {
  const rows = parseCsv(readFileSync(path, 'utf8'));
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const iImage = header.indexOf('image');
  const iItems = header.indexOf('items');
  if (iImage === -1 || iItems === -1) throw new Error(`CSV missing image/items columns; got: ${header.join(',')}`);
  const out: RealReport[] = [];
  for (const r of rows.slice(1)) {
    const raw = r[iItems]?.trim();
    if (!raw) continue;
    let items: RealItem[];
    try {
      items = JSON.parse(raw) as RealItem[];
    } catch {
      continue; // skip a malformed items cell rather than fabricate
    }
    if (Array.isArray(items) && items.length) out.push({ image: r[iImage], kind: 'csv', items });
  }
  return out;
}

// The rigorous CSV if provided, else the committed WebFetch sample. Returns the source tag
// so the runner can be honest about which number it is producing.
export function resolveCorpus(): { reports: RealReport[]; source: string } {
  const csv = process.env.MEDREPBENCH_CSV;
  if (csv && existsSync(csv)) return { reports: loadMedRepBenchCsv(csv), source: `real CSV (${csv})` };
  return { reports: MEDREPBENCH_SAMPLE, source: 'committed WebFetch sample (working baseline — not the defensible number)' };
}
