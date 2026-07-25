// ZH->BO validation-study runner.
//
//   npx tsx validation/tibetan-study/run.ts template
//       -> writes generation-template.csv: one row per sample item, one empty bo
//          column per model. Fill each model's column via its API with the prompt in
//          PROTOCOL.md, then run `check`.
//
//   npx tsx validation/tibetan-study/run.ts check <filled.csv>
//       -> runs the mechanical fidelity check per model, prints a summary, and writes
//          scoring-sheet.csv for the human reviewer (model identities blinded).
//
// The mechanical check is automatable and needs no Tibetan competence. The scoring
// sheet is where the human does the ONLY thing no machine can: judge whether the
// Tibetan means the right thing. See PROTOCOL.md.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseCsv, serializeCsv } from '@/lib/tibetanImport';
import { STUDY_SAMPLE } from './sample';
import { checkModel, type StudyCandidate } from './mechanicalCheck';

const MODELS = ['claude', 'gemini', 'qwen', 'glm', 'doubao'] as const;
const HERE = path.dirname(new URL(import.meta.url).pathname);

function writeTemplate(): void {
  const columns = ['id', 'kind', 'zh', ...MODELS.map((m) => `bo_${m}`)];
  const rows = STUDY_SAMPLE.map((item) => ({
    id: item.id,
    kind: item.kind,
    zh: item.zh,
    ...Object.fromEntries(MODELS.map((m) => [`bo_${m}`, ''])),
  }));
  const target = path.join(HERE, 'generation-template.csv');
  writeFileSync(target, serializeCsv(columns, rows), 'utf8');
  console.log(`Wrote ${target}`);
  console.log(`  ${rows.length} items · ${MODELS.length} model columns to fill (${MODELS.join(', ')}).`);
  console.log('  Fill each bo_<model> column with that model\'s ZH->BO output (prompt in PROTOCOL.md), then:');
  console.log('    npx tsx validation/tibetan-study/run.ts check validation/tibetan-study/generation-template.csv');
}

function runCheck(filledPath: string): void {
  const { rows } = parseCsv(readFileSync(filledPath, 'utf8'));
  const zhById = new Map(STUDY_SAMPLE.map((i) => [i.id, i.zh]));

  console.log(`ZH->BO mechanical fidelity — ${filledPath}\n`);
  const perModel = MODELS.map((model) => {
    const candidates: StudyCandidate[] = rows
      .filter((row) => (row[`bo_${model}`] ?? '').trim().length > 0)
      .map((row) => ({ id: row.id, zh: zhById.get(row.id) ?? '', bo: row[`bo_${model}`] ?? '' }));
    if (candidates.length === 0) return { model, filled: false as const };
    const report = checkModel(model, candidates);
    console.log(
      `  ${model.padEnd(8)} filled ${String(report.total).padStart(2)}/${STUDY_SAMPLE.length}`
      + ` · mechanically clean ${report.passed}/${report.total}`
      + ` · structural failures ${report.failed}`,
    );
    for (const r of report.results.filter((x) => !x.pass)) {
      console.log(`      ✗ ${r.id}: ${r.findings.map((f) => f.check).join(', ')}`);
    }
    return { model, filled: true as const, report };
  });

  const anyFilled = perModel.some((m) => m.filled);
  if (!anyFilled) {
    console.log('  No model columns filled yet. Fill generation-template.csv and re-run.');
    return;
  }

  // Blinded scoring sheet: shuffle a fixed, seed-free permutation of model labels so the
  // reviewer does not know which output is which model. Deterministic (no RNG) for
  // reproducibility — a fixed rotation per row index.
  const blindOrder = MODELS.map((_, i) => i);
  const columns = ['id', 'kind', 'zh', 'candidate_A', 'candidate_B', 'candidate_C', 'candidate_D', 'candidate_E',
    'score_A', 'score_B', 'score_C', 'score_D', 'score_E', 'dangerous_error_note'];
  const filledById = new Map(rows.map((row) => [row.id, row]));
  const key: Record<string, string> = {};
  const scoreRows = STUDY_SAMPLE.map((item, index) => {
    const row = filledById.get(item.id);
    const rotation = index % MODELS.length;
    const order = blindOrder.map((i) => MODELS[(i + rotation) % MODELS.length]);
    const record: Record<string, string> = { id: item.id, kind: item.kind, zh: item.zh, dangerous_error_note: '' };
    order.forEach((model, slot) => {
      const label = String.fromCharCode(65 + slot); // A..E
      record[`candidate_${label}`] = row?.[`bo_${model}`] ?? '';
      record[`score_${label}`] = '';
      key[`${item.id}:${label}`] = model;
    });
    return record;
  });
  const sheetPath = path.join(HERE, 'scoring-sheet.csv');
  const keyPath = path.join(HERE, 'scoring-key.json');
  writeFileSync(sheetPath, serializeCsv(columns, scoreRows), 'utf8');
  writeFileSync(keyPath, JSON.stringify(key, null, 2), 'utf8');
  console.log(`\n  Wrote ${sheetPath} (blinded, for the reviewer)`);
  console.log(`  Wrote ${keyPath} (which label was which model — do NOT show the reviewer)`);
  console.log('\n  Reviewer scores each candidate 0-2 (0 wrong/dangerous · 1 understandable but off · 2 correct)');
  console.log('  and flags any dangerous error. Then apply the PROTOCOL.md pass/fail rule to pick Branch A or B.');
}

const [command, arg] = process.argv.slice(2);
if (command === 'check' && arg) {
  runCheck(arg);
} else {
  writeTemplate();
}
