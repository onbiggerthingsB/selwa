// Grounding-on-real-content scorer (Prove-the-Number, Half A). Feeds externally-authored
// real report rows (validation/real-corpus/sample.ts) straight through the SHIPPED
// deterministic pipeline (groundExtraction → classify → guard) — image-free, no API — and
// reads off the three product-defining numbers on real data:
//   • abstain-rate   — fraction of rows we WITHHOLD (show source only, no interpretation)
//   • confirm-rate   — of the rows we DO interpret, fraction routed to "confirm the values"
//   • agreement      — of interpreted+scorable rows, fraction whose normal/abnormal call
//                      matches the report's OWN abnormal flag
// This is the first measurement of the guard on content it was NOT tuned against.

import { groundExtraction } from '@/lib/grounding';
import { confirmBurden, type ConfirmRow } from '@/validation/confirmBurden';
import type { RealReport } from './sample';

export interface ClassifiedDetail {
  name: string;
  value: string;
  unit: string;
  ourClass: string;
  datasetFlag: 'normal' | 'abnormal' | 'unscored';
  agree: boolean | null; // null = not scorable (dataset flag missing)
}

export interface RealCorpusSummary {
  reports: number;
  items: number;
  recognized: number; // analyte mapped to our reference table (entry !== null)
  classified: number; // action !== 'abstain' — an interpretation was shown
  abstained: number; // withheld → source only
  abstainRate: number;
  abstainByReason: Record<string, number>;
  confirmRate: number; // among classified rows
  confirmByRule: Record<string, number>;
  agreementScored: number;
  agreement: number; // fraction matching the report's own flag
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
      classifiedDetail.push({ name: it.item_name.trim(), value: it.item_value, unit: it.item_unit, ourClass: row.classification, datasetFlag, agree: rowAgree });
    }
  }

  const cb = confirmBurden(confirmRows);
  return {
    reports: reports.length,
    items,
    recognized,
    classified,
    abstained,
    abstainRate: items === 0 ? NaN : abstained / items,
    abstainByReason,
    confirmRate: cb.confirmRate,
    confirmByRule: cb.byRule,
    agreementScored,
    agreement: agreementScored === 0 ? NaN : agree / agreementScored,
    classifiedDetail,
    disagreements: classifiedDetail.filter((d) => d.agree === false),
  };
}
