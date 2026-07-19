// Deterministic immutable detectors for the doctor-notes safety guard (M3.2).
//
// SAFETY MODEL: These detectors extract the *immutable* facts of a note —
// negations, doses, drugs, bare numbers — straight from the curated lexicon,
// with no LLM judgement. The fidelity guard (M3.3) compares the immutables
// extracted from the SOURCE against those extracted from the LLM OUTPUT; any
// dropped/altered negation, dose, or drug forces an abstain. This file is
// focused purely on *correct extraction* — the 18-failure-mode comparison
// lives in notesGuard.

import type { Immutable, ImperativePolarity } from './types';
import type { SourceLang } from './i18n';
import {
  NEGATION_MARKERS,
  DOSE_UNITS,
  FREQUENCY_TOKENS,
  KNOWN_DRUGS,
  IMPERATIVE_MARKERS,
  IMPERATIVE_INVERSION_MARKERS,
  IMPERATIVE_MONITORING_OBJECTS,
  IMPERATIVE_MED_ANAPHORS,
  MED_CLASS_ANCHORS,
  EN_MED_CLASS_ANCHORS,
  type NegationMarker,
} from '@/data/medical-lexicon';

// --- Clause splitting -------------------------------------------------------
// Split on sentence punctuation and the conjunctions that re-assert scope, so a
// negation/hedge cannot leak across a clause boundary. ASCII '.' and ',' are
// guarded so they only split as punctuation, not inside a number — a decimal
// point ('0.5 mg') or a thousands separator ('1,000 mg') must stay intact.
const CLAUSE_SPLIT_RE =
  /[。；;!?！？\n]|(?<!\d)[.,]|[.,](?!\d)|但是|但|而|及|和|，|\band\b|\bbut\b/giu;

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
function markersForLang(lang: SourceLang): NegationMarker[] {
  return NEGATION_MARKERS.filter((m) => m.lang === lang).sort(
    (a, b) => b.marker.length - a.marker.length,
  );
}

// Strip a leading/trailing dangling conjunction or whitespace left over from a
// finding span.
function cleanFinding(s: string): string {
  return s.replace(/^[\s,，、的]+/u, '').replace(/[\s,，、的]+$/u, '').trim();
}

function detectNegations(clause: string, lang: SourceLang): Immutable[] {
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
      if (lang === 'en') {
        // Require word boundaries on the alphanumeric EDGES of the marker so
        // 'no' does not fire inside "normal"/"diagnosis"/"lisinopril", while
        // punctuated markers ('non-', 'r/o') and multi-word markers still match.
        // Find the first/last alnum char of the needle and check the chars just
        // outside those positions are non-[A-Za-z0-9] boundaries.
        let firstAlnum = 0;
        while (firstAlnum < needle.length && !/[a-z0-9]/i.test(needle[firstAlnum])) firstAlnum++;
        let lastAlnum = needle.length - 1;
        while (lastAlnum >= 0 && !/[a-z0-9]/i.test(needle[lastAlnum])) lastAlnum--;
        if (firstAlnum <= lastAlnum) {
          const beforeIdx = idx + firstAlnum - 1;
          const afterIdx = idx + lastAlnum + 1;
          const before = beforeIdx < 0 ? '' : hay[beforeIdx];
          const after = afterIdx >= hay.length ? '' : hay[afterIdx];
          if (/[a-z0-9]/i.test(before) || /[a-z0-9]/i.test(after)) continue;
        }
      }
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
// Arabic form: comma-grouped thousands ('1,000', '12,500.5') OR a plain
// integer/decimal ('5', '0.5'). The comma is a thousands separator, never a
// decimal point — normalizeAmount strips it.
const AMOUNT = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?|[零一二两三四五六七八九十]+|半';
const DOSE_RE = new RegExp(
  `(?<amount>${AMOUNT})(?:\\s*[-~–至]\\s*(?<amax>${AMOUNT}))?\\s*(?<unit>${DOSE_UNIT_ALT})`,
  'giu',
);

// Frequency tokens sorted longest-first for greedy matching within a clause.
const FREQ_SORTED = [...FREQUENCY_TOKENS].sort((a, b) => b.length - a.length);

function findFrequency(clause: string, lang: SourceLang): string | undefined {
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

function detectDoses(clause: string, lang: SourceLang): { doses: Immutable[]; spans: Array<[number, number]> } {
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
  lang: SourceLang,
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
    // Mirror the ZH path: a suffix-matched token only counts as a drug when it
    // sits in a medication context within the same clause — a dose token, a
    // FREQUENCY_TOKENS match, or an English med-verb. This stops the suffix
    // list (e.g. 'pine') from flagging ordinary words like "spine".
    const freq = findFrequency(clause, lang);
    const hasMedContext =
      doseSpans.length > 0 ||
      !!freq ||
      /\b(?:take|takes|taking|continue|continues|start|started|stop|stopped|prescribe|prescribed|give|given)\b/i.test(
        clause,
      );
    const tokenRe = /[A-Za-z][A-Za-z-]*[A-Za-z]/g;
    for (const m of clause.matchAll(tokenRe)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      if (!EN_DRUG_SUFFIX.test(m[0])) continue;
      if (!hasMedContext) continue;
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

// --- Imperatives (R7b: medication hold/continue/dose-change polarity) --------
// Detect the DIRECTIVE polarity of a medication instruction so a hold↔continue flip
// or a dose-direction swap (the Khoong 2019 harm) can be caught in reconciliation.
// Markers are multi-char + med-scoped (see IMPERATIVE_MARKERS) so findings don't fire.
const IMPERATIVE_SORTED = [...IMPERATIVE_MARKERS].sort((a, b) => b.marker.length - a.marker.length);

// Flip a polarity for an inverting negation ("不要停药" = do not stop = continue).
function invertPolarity(p: ImperativePolarity): ImperativePolarity {
  if (p === 'hold') return 'continue';
  if (p === 'continue') return 'hold';
  return 'unknown'; // negated dose-change ("don't increase") is genuinely ambiguous
}

// Does an inverting negation sit IMMEDIATELY before the marker? Adjacency (endsWith),
// not a window scan — so 别的 (别 inside "other"), 不得不 (不得 inside "had to"), and EN
// 'nevertheless' (never) can't spuriously flip a HOLD into a CONTINUE (the unsafe
// direction: a real hold rendered as keep-taking).
function precededByInversion(clause: string, idx: number, lang: SourceLang): boolean {
  const raw = (lang === 'en' ? clause.toLowerCase() : clause).slice(0, idx);
  const prefix = lang === 'en' ? raw.replace(/\s+$/u, '') : raw;
  return IMPERATIVE_INVERSION_MARKERS.filter((m) => m.lang === lang).some((m) => {
    const needle = lang === 'en' ? m.marker.toLowerCase() : m.marker;
    if (!prefix.endsWith(needle)) return false;
    if (lang === 'en') {
      const before = prefix[prefix.length - needle.length - 1];
      if (before !== undefined && /[a-z0-9]/i.test(before)) return false; // word boundary
    }
    return true;
  });
}

function nearestDrugId(clause: string, idx: number, drugs: Immutable[]): string | null {
  let best: { dist: number; id: string | null } | null = null;
  for (const d of drugs) {
    const at = clause.indexOf(d.raw);
    if (at === -1) continue;
    const dist = Math.abs(at - idx);
    if (best === null || dist < best.dist) best = { dist, id: d.drugId ?? null };
  }
  return best ? best.id : null;
}

function clauseHasMedAnaphor(clause: string, lang: SourceLang): boolean {
  const hay = lang === 'en' ? clause.toLowerCase() : clause;
  if (IMPERATIVE_MED_ANAPHORS.filter((a) => a.lang === lang).some((a) => hay.includes(lang === 'en' ? a.token.toLowerCase() : a.token))) {
    return true;
  }
  // Drug-class nouns (降压药 / "statin" / "blood thinner") are a medication referent too.
  return lang === 'zh' ? MED_CLASS_ANCHORS.some((c) => clause.includes(c)) : EN_MED_CLASS_ANCHORS.some((c) => hay.includes(c));
}

// Chars that, right after a bare "停", make it a NON-medication word (停经 amenorrhea,
// 停止 cease, 停产/停售 out-of-stock, 停搏/停跳 arrest, 停留 dwell, …) → don't fire hold.
const STOP_FALSE_FRIEND_NEXT = new Set(['经', '诊', '产', '售', '搏', '跳', '留', '止', '工', '业', '学', '课', '滞', '顿', '车', '电', '水']);
// Chars after "暂停" that make it govern a non-drug object (暂停期间 during the pause,
// 暂停一下/片刻 pause briefly, 暂停后 after pausing) → don't fire hold.
const PAUSE_FALSE_FRIEND_NEXT = new Set(['期', '间', '一', '片', '时', '刻', '后', '会', '歇', '下']);
// ZH "停 …药" hold directive (停他汀类药物, 停降压药, 停这个药) — caught even when the
// specific drug/class isn't in the known-drug list.
const ZH_STOP_MED_RE = /停[一-龥]{1,8}?药/gu;
// EN "cut … in half" (halve) even when a drug/object sits between the words.
const EN_CUT_HALF_RE = /\bcut\b[a-z0-9\s'-]*\bin half\b/gi;

function detectImperatives(clause: string, lang: SourceLang, drugs: Immutable[]): Immutable[] {
  const out: Immutable[] = [];
  const consumed: Array<[number, number]> = [];
  const overlaps = (start: number, end: number) => consumed.some(([s, e]) => start < e && end > s);
  const hasDrug = drugs.length > 0;
  const hay = lang === 'en' ? clause.toLowerCase() : clause;

  const emit = (idx: number, end: number, polarity: ImperativePolarity, doseDir: 'up' | 'down' | 'unknown' | undefined, drugId: string | null) => {
    consumed.push([idx, end]);
    const inverted = precededByInversion(clause, idx, lang);
    const im: Immutable = { type: 'imperative', raw: clause.slice(idx, end), imperative: polarity, drugId };
    if (polarity === 'dose-change') {
      im.doseDir = inverted ? 'unknown' : doseDir ?? 'unknown'; // negated direction is unknowable
    } else if (inverted) {
      im.imperative = invertPolarity(polarity);
    }
    out.push(im);
  };

  for (const m of IMPERATIVE_SORTED) {
    if (m.lang !== lang) continue;
    const needle = lang === 'en' ? m.marker.toLowerCase() : m.marker;
    let from = 0;
    for (;;) {
      const idx = hay.indexOf(needle, from);
      if (idx === -1) break;
      const end = idx + needle.length;
      from = end;
      if (overlaps(idx, end)) continue;
      // EN: require word boundaries on the alnum edges (so 'hold' ≠ 'household').
      if (lang === 'en') {
        const before = idx === 0 ? '' : hay[idx - 1];
        const after = end >= hay.length ? '' : hay[end];
        if (/[a-z0-9]/i.test(before) || /[a-z0-9]/i.test(after)) continue;
      }
      // Bare "停"/"暂停" that is really a finding/state word (停经/停止/暂停期间…) — not a drug order.
      // Bare 停 preceded by 暂 is the 停 inside a (possibly-suppressed) 暂停 — never a separate order.
      if (m.marker === '停' && (STOP_FALSE_FRIEND_NEXT.has(clause[end]) || clause[idx - 1] === '暂')) continue;
      if (m.marker === '暂停' && PAUSE_FALSE_FRIEND_NEXT.has(clause[end])) continue;
      // Monitoring suppression: a bare CONTINUE marker followed by 观察/随访/… is a
      // monitoring instruction, not a drug directive (继续观察 ≠ keep taking).
      if (m.polarity === 'continue') {
        const rest = clause.slice(end);
        if (IMPERATIVE_MONITORING_OBJECTS.some((o) => rest.startsWith(o))) continue;
      }
      // Drug-scope gate for ambiguous bare markers (继续/维持/hold/停): require a drug in
      // the clause, OR a medication anaphor ("继续这个药" / "keep taking this medication")
      // so a directive on a pronoun-referenced drug still gets checked (bind drugId=null).
      let drugId = nearestDrugId(clause, idx, drugs);
      if (m.requiresDrugScope && !hasDrug) {
        if (!clauseHasMedAnaphor(clause, lang)) continue;
        drugId = null;
      }
      emit(idx, end, m.polarity, m.doseDir, drugId);
    }
  }

  // ZH "停 …药" hold directive (drug/class need not be a known drug).
  if (lang === 'zh') {
    for (const mt of clause.matchAll(ZH_STOP_MED_RE)) {
      const idx = mt.index ?? 0;
      const end = idx + mt[0].length;
      if (overlaps(idx, end)) continue;
      // Don't bridge a false-friend 停 (停经/停止/停产…) to a later 药 (停经后…用某药).
      if (STOP_FALSE_FRIEND_NEXT.has(clause[idx + 1])) continue;
      emit(idx, end, 'hold', undefined, nearestDrugId(clause, idx, drugs));
    }
  }

  // EN "cut … in half" (halve) — drug-scoped so "cut the pizza in half" doesn't fire.
  if (lang === 'en' && (hasDrug || clauseHasMedAnaphor(clause, lang))) {
    for (const mt of hay.matchAll(EN_CUT_HALF_RE)) {
      const idx = mt.index ?? 0;
      const end = idx + mt[0].length;
      if (overlaps(idx, end)) continue;
      emit(idx, end, 'dose-change', 'down', nearestDrugId(clause, idx, drugs));
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
export function detectImmutables(text: string, lang: SourceLang): Immutable[] {
  const result: Immutable[] = [];
  for (const clause of splitClauses(text)) {
    result.push(...detectNegations(clause, lang));
    const { doses, spans } = detectDoses(clause, lang);
    result.push(...doses);
    const drugs = detectDrugs(clause, lang, spans);
    result.push(...drugs);
    result.push(...detectImperatives(clause, lang, drugs)); // after drugs: needs spans for scope
    result.push(...detectBareNumbers(clause, spans));
  }
  return result;
}
