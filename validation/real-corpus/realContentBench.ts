// Grounding-on-real-content scorer (Prove-the-Number, Half A). Feeds externally-authored
// real report rows (validation/real-corpus/sample.ts) straight through the SHIPPED
// deterministic pipeline (groundExtraction → classify → guard) — image-free, no API.
//
// RE-POINTED FOR B1 (grilling Q7). Under B1 our low/normal/high classification is INTERNAL: it
// drives the guards, and the user never sees it. So the old headline gate — "confidently-wrong",
// i.e. our classification vs the report's flag — scored a signal nobody reads, and was blind to
// the bug that actually shipped (the chip compared a CONVERTED value against the report's RAW
// printed range, making every unit-converted row wrong in both directions). The metrics that
// describe what the user actually risks:
//   • chipCoverage — fraction of rows where the chip reproduces the report's own comparison
//                    (the delivered value; ceiling = rows that print a range)
//   • r6Coverage   — of rows we know to be high-stakes, fraction reaching the confirm gate.
//                    An analyte we cannot NAME (a US "Troponin I") scores 0 here — which is
//                    exactly the gap this number exists to scream about.
//   • defer rate   — chipDeferred: where we honestly assert nothing.
// Two invariants are enforced as tests, not numbers: validation/b1VerdictLeakage.test.ts (no
// verdict may surface) and validation/chipFidelity.test.ts (the chip must match the report).
// confident-agreement is KEPT but DEMOTED to internal guard-health — it still validates the
// guards' inputs; it is no longer the safety gate.

import { groundExtraction } from '@/lib/grounding';
import { buildSummary } from '@/lib/summary';
import { confirmBurden, type ConfirmRow } from '@/validation/confirmBurden';
import type { RealReport } from './sample';

export interface ClassifiedDetail {
  name: string;
  value: string;
  unit: string;
  ourClass: string;
  needsConfirm: boolean;
  datasetFlag: 'normal' | 'abnormal' | 'unscored';
  agree: boolean | null; // null = not scorable (dataset flag missing)
}

export interface RealCorpusSummary {
  reports: number;
  items: number;
  // --- B1 metrics: what the USER actually sees (the old confident-agreement scored our
  // INTERNAL classification, which under B1 never reaches them — it could not see the chip-frame
  // bug that made every unit-converted row wrong). These score the visible output instead.
  chipReproduced: number; // chip states the report's own comparison — the delivered value
  chipDeferred: number; // "ask your clinician" / "not assessed" — we assert nothing
  chipCoverage: number; // reproduced / items  (ceiling = rows that print a range)
  highStakesRows: number; // rows whose analyte we know to be high-stakes
  highStakesConfirmed: number; // ...of those, routed to the confirm gate (R6)
  r6Coverage: number; // confirmed / highStakes — a Troponin we cannot NAME scores 0 here
  recognized: number; // analyte mapped to our reference table (entry !== null)
  classified: number; // action !== 'abstain' — an interpretation was shown
  abstained: number; // withheld → source only
  abstainRate: number;
  abstainByReason: Record<string, number>;
  confirmRate: number; // among classified rows
  confirmByRule: Record<string, number>;
  agreementScored: number;
  agreement: number; // fraction matching the report's own flag
  // The REAL safety gate: agreement among rows we present CONFIDENTLY (needsConfirm=false).
  // A confirm-flagged disagreement (e.g. R11 band-vs-printed-range) is safe, not a wrong call,
  // so it must not count against safety — only a confidently-wrong row does.
  confidentScored: number;
  confidentAgreement: number;
  confidentlyWrong: ClassifiedDetail[]; // MUST stay empty — a confident wrong call is the failure
  classifiedDetail: ClassifiedDetail[];
  disagreements: ClassifiedDetail[];
}

// Our classification collapses to binary; null = not an abnormal/normal call we can score.
function ourAbnormal(classification: string): boolean | null {
  if (classification === 'normal') return false;
  if (classification === 'low' || classification === 'high' || classification === 'critical') return true;
  return null;
}

export function scoreRealCorpus(reports: RealReport[]): RealCorpusSummary {
  const confirmRows: ConfirmRow[] = [];
  let chipReproduced = 0;
  let chipDeferred = 0;
  let highStakesRows = 0;
  let highStakesConfirmed = 0;
  const abstainByReason: Record<string, number> = {};
  const classifiedDetail: ClassifiedDetail[] = [];
  let items = 0;
  let recognized = 0;
  let classified = 0;
  let abstained = 0;
  let agreementScored = 0;
  let agree = 0;

  for (const rep of reports) {
    for (const it of rep.items) {
      items += 1;
      const report = groundExtraction(
        {
          rows: [
            {
              name: it.item_name,
              value: it.item_value || null,
              unit: it.item_unit || null,
              printedRange: it.item_range || null,
              confidence: 'high',
            },
          ],
        },
        'unknown',
      );
      const row = report.rows[0];
      if (row.entry) recognized += 1;

      // B1: score the VISIBLE chip, and whether high-stakes rows reach the confirm gate.
      const chip = buildSummary(report, 'en').sections[0].chipEn;
      if (/your report’s range/.test(chip)) chipReproduced += 1;
      else chipDeferred += 1;
      if (row.entry?.highStakes) {
        highStakesRows += 1;
        if (row.needsConfirm) highStakesConfirmed += 1;
      }

      if (row.action === 'abstain') {
        abstained += 1;
        const reason =
          row.entry === null
            ? 'R1-UNKNOWN-ANALYTE'
            : row.valueNum === null
              ? 'NON-NUMERIC-VALUE'
              : (row.flags[0]?.id ?? 'OTHER-ABSTAIN');
        abstainByReason[reason] = (abstainByReason[reason] ?? 0) + 1;
        continue;
      }

      // Emitted an interpretation.
      classified += 1;
      confirmRows.push({ emitted: true, needsConfirm: row.needsConfirm, ruleIds: row.flags.map((f) => f.id) });

      const scored = it.is_abnormal === '0' || it.is_abnormal === '1';
      const ours = ourAbnormal(row.classification);
      const datasetFlag: ClassifiedDetail['datasetFlag'] = !scored ? 'unscored' : it.is_abnormal === '1' ? 'abnormal' : 'normal';
      let rowAgree: boolean | null = null;
      if (scored && ours !== null) {
        agreementScored += 1;
        rowAgree = ours === (it.is_abnormal === '1');
        if (rowAgree) agree += 1;
      }
      classifiedDetail.push({ name: it.item_name.trim(), value: it.item_value, unit: it.item_unit, ourClass: row.classification, needsConfirm: row.needsConfirm, datasetFlag, agree: rowAgree });
    }
  }

  const cb = confirmBurden(confirmRows);
  const confident = classifiedDetail.filter((d) => !d.needsConfirm && d.agree !== null);
  const confidentAgree = confident.filter((d) => d.agree === true).length;
  return {
    reports: reports.length,
    items,
    chipReproduced,
    chipDeferred,
    chipCoverage: items === 0 ? NaN : chipReproduced / items,
    highStakesRows,
    highStakesConfirmed,
    r6Coverage: highStakesRows === 0 ? NaN : highStakesConfirmed / highStakesRows,
    recognized,
    classified,
    abstained,
    abstainRate: items === 0 ? NaN : abstained / items,
    abstainByReason,
    confirmRate: cb.confirmRate,
    confirmByRule: cb.byRule,
    agreementScored,
    agreement: agreementScored === 0 ? NaN : agree / agreementScored,
    confidentScored: confident.length,
    confidentAgreement: confident.length === 0 ? NaN : confidentAgree / confident.length,
    confidentlyWrong: confident.filter((d) => d.agree === false),
    classifiedDetail,
    disagreements: classifiedDetail.filter((d) => d.agree === false),
  };
}
