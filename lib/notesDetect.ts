// Deterministic immutable detectors for the doctor-notes safety guard (M3.2).
//
// SAFETY MODEL: These detectors extract the *immutable* facts of a note —
// negations, doses, drugs, bare numbers — straight from the curated lexicon,
// with no LLM judgement. The fidelity guard (M3.3) compares the immutables
// extracted from the SOURCE against those extracted from the LLM OUTPUT; any
// dropped/altered negation, dose, or drug forces an abstain. This file is
// focused purely on *correct extraction* — the 18-failure-mode comparison
// lives in notesGuard.

import type { Immutable } from './types';
import {
  NEGATION_MARKERS,
  DOSE_UNITS,
  FREQUENCY_TOKENS,
  KNOWN_DRUGS,
  type NegationMarker,
} from '@/data/medical-lexicon';

// --- Clause splitting -------------------------------------------------------
// Split on sentence punctuation and the conjunctions that re-assert scope, so a
// negation/hedge cannot leak across a clause boundary.
const CLAUSE_SPLIT_RE = /[。.；;!?！？\n]|但是|但|而|及|和|，|,|\band\b|\bbut\b/giu;

export function splitClauses(text: string): string[] {
  return text
    .split(CLAUSE_SPLIT_RE)
    .map((c) => (c ?? '').trim())
    .filter((c) => c.length > 0);
}

// --- Negation ---------------------------------------------------------------
// ZH suffix-hedges scope the finding to their LEFT; everything else (ZH prefix
// negators, all EN markers) scopes to the RIGHT.
const ZH_SUFFIX_HEDGES = new Set(['待排', '待排除', '待查', '不除外', '不能除外', '性质待定', '随诊']);

// Markers sorted longest-first so '不能除外' beats '不', 'no evidence of' beats
// 'no', '未见明显' beats '未见'.
function markersForLang(lang: 'en' | 'zh'): NegationMarker[] {
  return NEGATION_MARKERS.filter((m) => m.lang === lang).sort(
    (a, b) => b.marker.length - a.marker.length,
  );
}

// Strip a leading/trailing dangling conjunction or whitespace left over from a
// finding span.
function cleanFinding(s: string): string {
  return s.replace(/^[\s,，、的]+/u, '').replace(/[\s,，、的]+$/u, '').trim();
}

function detectNegations(clause: string, lang: 'en' | 'zh'): Immutable[] {
  const out: Immutable[] = [];
  const markers = markersForLang(lang);
  // Track spans already consumed by a marker match to avoid double-counting
  // overlapping markers (e.g. '阴性' is both a marker and a high-risk token).
  const consumed: Array<[number, number]> = [];
  const overlaps = (start: number, end: number) =>
    consumed.some(([s, e]) => start < e && end > s);

  for (const m of markers) {
    let from = 0;
    const needle = lang === 'en' ? m.marker.toLowerCase() : m.marker;
    const hay = lang === 'en' ? clause.toLowerCase() : clause;
    for (;;) {
      const idx = hay.indexOf(needle, from);
      if (idx === -1) break;
      const end = idx + needle.length;
      from = end;
      if (overlaps(idx, end)) continue;
      consumed.push([idx, end]);

      const isSuffix = lang === 'zh' && ZH_SUFFIX_HEDGES.has(m.marker);
      let finding: string;
      if (isSuffix) {
        // Scope the finding to the LEFT of the marker (e.g. 占位待排 → 占位).
        finding = cleanFinding(clause.slice(0, idx));
      } else {
        // Scope to the RIGHT, up to the clause end (already clause-bounded).
        finding = cleanFinding(clause.slice(end));
      }
      out.push({
        type: 'negation',
        raw: clause.slice(idx, end),
        finding,
        polarity: m.polarity,
        strength: m.strength,
      });
    }
  }
  return out;
}

// --- ZH number-word normalization ------------------------------------------
const ZH_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

// Convert a short ZH numeral string (一二三十/半, up to ~99) to Arabic.
// Returns null if it does not parse as a number.
function zhNumToArabic(s: string): string | null {
  const t = s.trim();
  if (t === '半') return '0.5';
  if (/^\d+(?:[.,]\d+)?$/u.test(t)) return t.replace(',', '');
  // Handle 十-based numbers: 十=10, 十一=11, 二十=20, 二十三=23.
  if (t.includes('十')) {
    const [head, tail] = t.split('十');
    const tens = head === '' ? 1 : ZH_DIGITS[head];
    const ones = tail === '' || tail === undefined ? 0 : ZH_DIGITS[tail];
    if (tens === undefined || ones === undefined) return null;
    return String(tens * 10 + ones);
  }
  if (t.length === 1 && t in ZH_DIGITS) return String(ZH_DIGITS[t]);
  return null;
}

// Normalize an amount token (Arabic or ZH numeral) to a plain Arabic string.
function normalizeAmount(raw: string): string {
  const arabic = raw.replace(/,/g, '');
  if (/^\d+(?:\.\d+)?$/u.test(arabic)) return arabic;
  const zh = zhNumToArabic(raw);
  return zh ?? arabic;
}

// --- Dosage -----------------------------------------------------------------
const DOSE_DIM = new Map(DOSE_UNITS.map((u) => [u.token, u.dim]));
// Unit alternation, longest-first so 'mg/dL' beats 'mg', '毫克/公斤' beats '毫克'.
const DOSE_UNIT_ALT = DOSE_UNITS.map((u) => u.token)
  .sort((a, b) => b.length - a.length)
  .map((t) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
  .join('|');

// amount (+ optional range) + optional space + unit. Amount may be Arabic or a
// ZH numeral cluster. Unicode-aware; allow zero or one space.
const AMOUNT = '\\d+(?:[.,]\\d+)?|[零一二两三四五六七八九十]+|半';
const DOSE_RE = new RegExp(
  `(?<amount>${AMOUNT})(?:\\s*[-~–至]\\s*(?<amax>${AMOUNT}))?\\s*(?<unit>${DOSE_UNIT_ALT})`,
  'giu',
);

// Frequency tokens sorted longest-first for greedy matching within a clause.
const FREQ_SORTED = [...FREQUENCY_TOKENS].sort((a, b) => b.length - a.length);

function findFrequency(clause: string, lang: 'en' | 'zh'): string | undefined {
  for (const f of FREQ_SORTED) {
    if (lang === 'en') {
      // Word-boundary match for ASCII frequency codes (QD, BID…).
      if (/^[a-z0-9/]+$/i.test(f)) {
        const re = new RegExp(`\\b${f.replace(/[/]/g, '\\/')}\\b`, 'i');
        if (re.test(clause)) return f;
      } else if (clause.includes(f)) {
        return f;
      }
    } else if (clause.includes(f)) {
      return f;
    }
  }
  return undefined;
}

function detectDoses(clause: string, lang: 'en' | 'zh'): { doses: Immutable[]; spans: Array<[number, number]> } {
  const doses: Immutable[] = [];
  const spans: Array<[number, number]> = [];
  const freq = findFrequency(clause, lang);
  for (const match of clause.matchAll(DOSE_RE)) {
    const g = match.groups!;
    const unit = g.unit;
    const dim = DOSE_DIM.get(unit) ?? unit;
    const amount = normalizeAmount(g.amount);
    const im: Immutable = {
      type: 'dosage',
      raw: match[0],
      amount,
      unitDim: dim,
    };
    if (g.amax !== undefined) {
      im.range = { min: amount, max: normalizeAmount(g.amax) };
    }
    if (freq) im.frequency = freq;
    doses.push(im);
    const start = match.index ?? 0;
    spans.push([start, start + match[0].length]);
  }
  return { doses, spans };
}

// --- Drugs ------------------------------------------------------------------
// Alias → canonical id. Longest aliases first so multi-char ZH names win.
const DRUG_ALIASES: Array<{ form: string; id: string }> = KNOWN_DRUGS.flatMap((d) =>
  d.forms.map((form) => ({ form, id: d.id })),
).sort((a, b) => b.form.length - a.form.length);

const EN_DRUG_SUFFIX = /(olol|pril|sartan|statin|cillin|mycin|azole|pine|prazole|gliptin|formin|dipine)$/i;
const ZH_DRUG_SUFFIX = /(唑|平|林|汀|坦|普利|胺|酮|砜|单抗|霉素|地平|沙坦)$/u;

function detectDrugs(
  clause: string,
  lang: 'en' | 'zh',
  doseSpans: Array<[number, number]>,
): Immutable[] {
  const out: Immutable[] = [];
  const seen = new Set<string>();
  const consumed: Array<[number, number]> = [];
  const overlaps = (start: number, end: number) =>
    consumed.some(([s, e]) => start < e && end > s);

  // Pass 1: known drugs.
  const hay = lang === 'en' ? clause.toLowerCase() : clause;
  for (const { form, id } of DRUG_ALIASES) {
    const needle = lang === 'en' ? form.toLowerCase() : form;
    // Skip cross-script aliases that can't appear in this clause's language is
    // unnecessary — indexOf simply won't find them — but EN word-boundary
    // matters to avoid 'u' inside words. For ZH, substring is correct.
    let from = 0;
    for (;;) {
      const idx = hay.indexOf(needle, from);
      if (idx === -1) break;
      const end = idx + needle.length;
      from = end;
      if (overlaps(idx, end)) continue;
      if (lang === 'en') {
        // Require word boundaries for EN aliases.
        const before = idx === 0 ? '' : hay[idx - 1];
        const after = end >= hay.length ? '' : hay[end];
        if (/[a-z0-9]/i.test(before) || /[a-z0-9]/i.test(after)) continue;
      }
      consumed.push([idx, end]);
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ type: 'drug', raw: clause.slice(idx, end), drugId: id });
      }
    }
  }

  // Pass 2: unknown med-context tokens (look like a drug but not in the seed).
  if (lang === 'en') {
    const tokenRe = /[A-Za-z][A-Za-z-]*[A-Za-z]/g;
    for (const m of clause.matchAll(tokenRe)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      if (!EN_DRUG_SUFFIX.test(m[0])) continue;
      consumed.push([start, end]);
      out.push({ type: 'drug', raw: m[0], drugId: null });
    }
  } else {
    // ZH: scan maximal CJK runs (length ≥ 3) ending in a drug suffix that sit
    // adjacent to a dose/frequency token in the clause. The detectors doc keys
    // unknown ZH drugs to dose/freq adjacency; we also accept a verb cue
    // (服用/继续/口服) so a standalone medication directive is caught.
    const freq = findFrequency(clause, lang);
    const hasMedContext = doseSpans.length > 0 || !!freq || /服用|口服|继续用|停用|加用|改为/u.test(clause);
    const cjkRe = /[一-鿿]{3,}/gu;
    for (const m of clause.matchAll(cjkRe)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      // Trim a leading med-verb so the token is just the drug name.
      let token = m[0];
      let tStart = start;
      const verbStrip = token.match(/^(继续服用|继续用|停用|加用|改用|改为|口服|服用)/u);
      if (verbStrip) {
        token = token.slice(verbStrip[0].length);
        tStart = start + verbStrip[0].length;
      }
      if (token.length < 3) continue;
      if (!ZH_DRUG_SUFFIX.test(token)) continue;
      if (!hasMedContext) continue;
      const tEnd = tStart + token.length;
      if (overlaps(tStart, tEnd)) continue;
      consumed.push([tStart, tEnd]);
      out.push({ type: 'drug', raw: token, drugId: null });
    }
  }

  return out;
}

// --- Bare numbers -----------------------------------------------------------
// Numbers not already consumed by a dose, with an optional trailing unit-ish
// token. Used by the guard to catch dropped/altered counts (e.g. 3 days).
function detectBareNumbers(
  clause: string,
  doseSpans: Array<[number, number]>,
): Immutable[] {
  const out: Immutable[] = [];
  const overlaps = (start: number, end: number) =>
    doseSpans.some(([s, e]) => start < e && end > s);
  const numRe = /\d+(?:[.,]\d+)?/g;
  for (const m of clause.matchAll(numRe)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (overlaps(start, end)) continue;
    // Trailing unit-ish token (e.g. '天', 'days', '%').
    const rest = clause.slice(end);
    const unitMatch = rest.match(/^\s*([%a-zA-Z一-鿿]+)/u);
    out.push({
      type: 'number',
      raw: m[0],
      amount: m[0].replace(/,/g, ''),
      numUnit: unitMatch ? unitMatch[1] : null,
    });
  }
  return out;
}

// --- Public entry point -----------------------------------------------------
export function detectImmutables(text: string, lang: 'en' | 'zh'): Immutable[] {
  const result: Immutable[] = [];
  for (const clause of splitClauses(text)) {
    result.push(...detectNegations(clause, lang));
    const { doses, spans } = detectDoses(clause, lang);
    result.push(...doses);
    result.push(...detectDrugs(clause, lang, spans));
    result.push(...detectBareNumbers(clause, spans));
  }
  return result;
}
