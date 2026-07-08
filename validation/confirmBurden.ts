// Confirm-burden metric (harden-extraction H0).
//
// A BASELINE over-confirm measurement, established BEFORE H1/H3 add rules
// (R13 suppression, strengthened R11, extraction-reliability checks) that will
// push more rows through the "confirm the values" gate. Without this baseline we
// cannot tell genuine hardening from confirm-fatigue / alert-desensitization.
//
// Reads `needsConfirm` (the real confirm mechanism — `action: 'confirm'` is dead
// type surface, removed in H0) off grounded labs rows. Pure & deterministic; the
// runner supplies the rows from groundExtraction over the labs corpus.

export interface ConfirmRow {
  emitted: boolean; // action !== 'abstain' (an abstained row shows source only)
  needsConfirm: boolean; // routed to the confirm-the-values gate
  ruleIds: string[]; // flag ids carried on the row (which rules fired)
}

export interface ConfirmBurden {
  emitted: number; // rows that produced an interpretation (not abstained)
  confirmed: number; // emitted AND needsConfirm
  confirmRate: number; // confirmed / emitted; NaN when nothing emitted (never 1.0 by fiat)
  byRule: Record<string, number>; // flag ids that rode along on confirmed rows
}

/**
 * Confirm burden over a set of grounded labs rows: what fraction of emitted rows
 * we route to the confirm gate, and which rules drove it. Excludes abstained rows
 * from the denominator (they never reach the confirm gate). NaN rate when the
 * denominator is empty — reported "N/A", never a misleading 1.0.
 */
export function confirmBurden(rows: ConfirmRow[]): ConfirmBurden {
  const emittedRows = rows.filter((r) => r.emitted);
  const confirmedRows = emittedRows.filter((r) => r.needsConfirm);
  const byRule: Record<string, number> = {};
  for (const r of confirmedRows) {
    for (const id of r.ruleIds) byRule[id] = (byRule[id] ?? 0) + 1;
  }
  return {
    emitted: emittedRows.length,
    confirmed: confirmedRows.length,
    confirmRate: emittedRows.length === 0 ? NaN : confirmedRows.length / emittedRows.length,
    byRule,
  };
}
