# SPEC — Two-person rule for Tibetan import

Repo root: `/Users/likerun/Desktop/health-translator`. All paths relative to it. Line numbers reference the scout report (branch `codex/remaining-work-cycle-ready`).

## 0. Summary — what this buys, said plainly

Today one person can fill a packet and run `npm run tibetan:import -- <dir>` alone; no line of code involves a second party (scout I §5). This spec replaces the single-packet import path with a paired-packet path: two reviewers each fill an independent packet, and the importer verifies agreement deterministically.

**Honest scope, up front.** This is an honest-participant control, not an anti-collusion mechanism. A solo operator can export two packets, paste the same `bo` column into both, and type a second name — that passes every check here with zero friction, and no local tool can prevent it. What the mechanism actually delivers:

- (a) the one-packet import path stops existing, so importing before a second review exists becomes an explicit act of fabrication rather than the default;
- (b) a recorded claim of two named reviewers that lands in git history and PR review, where a human can check it;
- (c) mechanical value independent of the two-person story: a row-set completeness gate that closes the silent-deletion hole (scout I §2), and cross-packet `zh`/context equality that closes the falsified-source hole;
- (d) fail-closed disagreement handling that never picks a winner.

The two-person rule itself is process, enforced by PR review; this code makes violating it deliberate and visible. The structural floor (A1–A9, B1–B13, PACKET, OVERWRITE) is untouched and runs after the dual gate.

## 1. Design decisions

### D1 — Two packets; the importer consumes both

- `npm run tibetan:export -- <dir-a> <dir-b>` writes **two** packet directories. Each contains the existing four CSVs (all `bo` empty, byte-identical between the two dirs — the export is already deterministic, scout E §4) **plus a new fifth file, `manifest.csv`**, differing between the two dirs only in a freshly generated `packet-id` UUID.
- Blindness between humans cannot be enforced by a local tool and we do not pretend it can. What the tooling enforces: the answers only ever meet inside the importer — no human merge step, no combined CSV, no code path that accepts one filled packet. Copying reviewer A's **filled directory** into the B slot is mechanically detected (the copied `manifest.csv` carries A's `packet-id`, refused per D2). Copying A's filled **column** into B's spreadsheet is not detectable and is not claimed to be.

### D2 — Identity capture and the self-approval check

New `manifest.csv` in each packet dir. Columns, in order: `packet-id, reviewer-name, reviewer-contact, review-date`. Export writes one data row: `packet-id` = `randomUUID()` (already imported; used at `lib/tibetanImport.ts:1589`), other cells empty. The reviewer fills name, contact (email/phone), date.

Importer refusals — packet-level throws whose message ends with the house-style sentence `Nothing was imported.`:
- manifest missing, malformed, or with empty `reviewer-name` or `reviewer-contact` (note: this means a freshly exported, untouched pair **throws** — the manifest must be filled even for a no-op run; see §5);
- `packet-id` equal across the two packets (copied-directory detection, including passing the same directory twice);
- normalized `reviewer-name` equal across packets, or normalized `reviewer-contact` equal across packets. Normalization: NFC → trim → casefold → collapse internal whitespace runs to one space.

**Code comment on the check, verbatim:** this is an honest-participant control. It prevents mistakes and shortcuts — importing before a second review exists, reusing a filled packet, one person signing both slots out of convenience. It does **not** prevent a determined solo operator from fabricating a second identity; that residual risk is covered by git history and PR review, not by this code. No cryptography, no signatures, and none should be added.

### D3 — Agreement semantics: strict, fail closed, adjudication is human

`planDualAgreement(rowsA, rowsB)` first **throws** if either packet contains the same non-empty `id` more than once (the per-row IDENTITY duplicate guard at `:1035-1043` runs *after* pairing; a `Map` keyed by id would silently keep last-wins, so the duplicate check must happen here, before matching).

Then per row (matched by `id` within packet kind), compare the two `bo` cells:

1. Canonicalize each cell: NFC-normalize, trim leading/trailing whitespace. If **both** canonical cells parse as JSON arrays of strings (the multi-alternative format, `parseReviewedForms` `lib/tibetanImport.ts:691-731`), compare element-wise on NFC-trimmed elements (so `["a", "b"]` vs `["a","b"]` with equal content agrees — reviewers hand-type JSON). Otherwise compare the whole canonical cells byte-for-byte.
2. **No tsheg- or internal-whitespace-insensitivity.** Tsheg placement changes segmentation; a tsheg difference is a disagreement. NFC is the only forgiveness, consistent with the existing A5 NFC-stability check.
3. Outcomes:
   - both empty → `skipped` (preserves the all-empty no-op round trip);
   - one empty, one filled → **refused**, diagnostic code `DUAL`, reason `coverage-mismatch`. Fail closed.
   - both filled, unequal → **refused**, `DUAL`, reason `disagreement`. The importer never picks a winner; legitimate synonymy goes to adjudication.
   - both filled, equal → the row proceeds. **The forwarded value is re-derived deterministically, never taken raw from either packet:** plain path — the canonical NFC-trimmed string (identical from either side by construction); JSON-array path — `JSON.stringify` of the NFC-trimmed element array (the two raw cells may differ in spacing, so re-serialization is mandatory; silently forwarding one packet's raw cell is forbidden). That re-serialized string is what `parseReviewedForms` and the downstream pipeline see, so A5 NFC-stability holds even if a reviewer typed decomposed codepoints.
4. Before comparing `bo`: every reviewer-visible non-`bo` column (`zh`, `en`, and the per-kind context columns) must be byte-equal **across the two packets** → else refuse `DUAL` / `context-mismatch`. The existing PACKET gate (`:1150-1201`) validates only the row we forward; a tampered `zh` in the *other* packet means that reviewer approved Tibetan against a falsified source.
5. **Adjudication is a named human step, not code:** the CLI prints a `DISAGREEMENTS` section (row id, packet, both values). The reviewers (or a third adjudicator) converge, **both** packets are edited to the agreed form, the adjudication is recorded in the PR description, and the import is re-run. Build no adjudication tooling.

Disagreed rows import nothing and — house invariant — leave every source file byte-identical. Agreed rows in the same run still import; disagreement is surfaced loudly, never silently resolved.

### D4 — Breaking change; the single-packet path stops working

`curatedBo === 0`: nothing has ever been imported, so no migration. `importReviewedPacket` changes signature to `(repoRoot, packetDirectoryA, packetDirectoryB, options?)` where `options.labTable` is forwarded to the completeness gate (D5.3) and to `executeTibetanImport` (the `input.labTable ?? REFERENCE_LABS` pattern already exists at `:987` and `:1626`). The CLI requires exactly two positional args and exits 2 otherwise. Same for export. No flag, no env var, no legacy mode. Honest caveat, in a comment: `executeTibetanImport({repoRoot, rows})` remains exported for the 34 in-memory tests; calling it directly bypasses the dual gate, the same trust level as editing the importer itself — the control governs the packet/CLI path, the only path humans use.

### D5 — Composition: dual gate first, floor unchanged

Ordering inside the new `importReviewedPacket`:

1. `readReviewedPacket(dirA)`, `readReviewedPacket(dirB)` — existing per-packet schema throws unchanged (four CSVs, terms-must-be-empty, decision-row presence, per packet).
2. Manifest gate (D2) — throws.
3. **Row-set completeness gate.** Applies to `glossary-names` and `floor-strings` rows **only** (`glossary-terms.csv` has no `id` column, `:516`; `decisions.csv` is a single advisory row — neither is gated, and the existing round-trip test's empty terms sheet stays valid). Compute the expected id sets from a fresh `extractLocalizedTextCorpus`: floor ids from non-reference, non-excluded calls (the `buildFloorStringRows` filter, `:377-401`); names ids from calls with `reference?.field === 'name'`, cross-checked against the **injected** `labTable ?? REFERENCE_LABS`. Do **not** route through `buildTibetanReviewPacket` (hard-coded asserts: 337 at `:477`, throw `:478`; 117/34 at `:493-494`) and do **not** call `buildGlossaryNameRows` as-is — it is private and iterates the real statically-imported `REFERENCE_LABS` (`:403-428`, `:13`, `:409`), so both explode on tmpdir fixtures. Then:
   - **Throw** (`Nothing was imported.`) if A's id set ≠ B's id set for either sheet — this is the deletion detection: a reviewer who dropped rows diverges from the other packet.
   - **Throw** if either packet contains an id absent from the expected set (fabricated/unknown rows).
   - **Do not throw** if the expected set contains ids absent from both packets — that is source drift (a `defineText` added since export, floor 161→162). Print a `DRIFT` notice listing the missing ids ("re-export to cover new strings") and continue; changed rows are still handled per-row by the existing B13 "Re-export and re-review" diagnostics (`:1130-1148`), which this gate must not preempt into a whole-import failure.
4. Dual agreement gate (D3) → agreed rows + `DUAL` refusals/skips.
5. Agreed rows feed the **unchanged** existing pipeline: `planTibetanImport` (IDENTITY, OVERWRITE, B13, PACKET, AST, SOURCE, FORMAT, A1–A9, B1–B10, B12) → `applyTibetanImportPlan` → `validateUpdatedSources` → `commitUpdatedFiles`. Do not relax any structural check.
6. Result object: `DUAL` refusals merge into the existing `{written, refused, skipped}` counts and `ImportRowResult.diagnostics` strings (so the `diagnostics(result)` / `toContain('DUAL')` test idiom works). CLI prints the summary plus the `DISAGREEMENTS` section and any `DRIFT` notice.

### D6 — What reviewers receive and return (CSV over email, non-programmers)

Each reviewer gets one folder (zipped for email) containing: the four CSVs, `manifest.csv`, and `INSTRUCTIONS.md` — written by the exporter into each packet dir, Chinese and English, stating: fill only the `bo` column and `manifest.csv` name/contact/date; leave `glossary-terms.csv` untouched (any entry there aborts everything); do not add, delete, or reorder rows; do not edit any other column; multi-alternative rows need a JSON array of exactly N strings; work in Google Sheets or LibreOffice and export as UTF-8 CSV (Excel's CSV export is unreliable); do not discuss answers with the other reviewer before both are submitted; return the whole folder. `INSTRUCTIONS.md` is a plain string constant — not app UI, no `defineText`, touches no corpus lock (scout T §4). The founder runs the import with both returned folders.

**BOM handling (decided, not open):** `parseCsv` (`:273-323`) has no BOM handling — a leading U+FEFF concatenates into the first header name and `requiredColumns` (`:583-585`) throws on a triviality. Reviewers' spreadsheet tools will prepend BOMs. Therefore: strip exactly one leading U+FEFF per file in `readReviewedPacket` and `readPacketManifest` before parsing. This is the only permitted touch to CSV parsing.

## 2. Files to create/change

| File | Change |
|---|---|
| `lib/tibetanImport.ts` | Add `MANIFEST_FILE = 'manifest.csv'` beside `REVIEW_PACKET_FILES` (`:42-47`). Extend `writeTibetanReviewPacket` (`:560-575`) — **signature unchanged** `(repoRoot, packetDirectory)` — to additionally write `manifest.csv` (fresh `packet-id`, empty reviewer cells) and `INSTRUCTIONS.md`; comment that re-export over a filled dir intentionally mints a new packet-id. Add `readPacketManifest(dir)` (BOM strip + parseCsv + required columns, house-style throws). Add BOM strip to `readReviewedPacket` (`:588-666`) per D6; leave the rest of it untouched. Add `planDualAgreement(rowsA, rowsB)` (D3, including the duplicate-id throw). Add the completeness gate (D5.3, labTable-parameterized). Replace `importReviewedPacket(repoRoot, packetDirectory)` (`:1664-1672`) with the orchestration in D5, accepting and forwarding `options.labTable`. Leave `planTibetanImport`, `executeTibetanImport`, and all Class A/B code untouched. |
| `scripts/tibetan/export-packet.mts` | Require exactly two positional args (`USAGE: npm run tibetan:export -- <packet-dir-a> <packet-dir-b>`), exit 2 otherwise; call `writeTibetanReviewPacket` twice; print both packet-ids and assert they differ; keep the four-count + `All bo cells are empty.` output per dir. |
| `scripts/tibetan/import-reviewed.mts` | Require exactly two positional args, exit 2 otherwise; call the new `importReviewedPacket`; print existing summary + rebaseline checklist + `DISAGREEMENTS` section + `DRIFT` notice. |
| `package.json` | Script names unchanged (`:12-13`). |
| `lib/tibetanImport.test.ts` | Update the one CSV-boundary round-trip test (`:430-495`) to write two packet dirs + filled manifests (distinct ids/reviewers) and pass `labTable: fixtureLabTable()`; add the new test battery (§3). The mutate-a-real-packet idiom (`:335-350`) and all packet-shape tests (`:200-331`) survive untouched — `writeTibetanReviewPacket` and `readReviewedPacket` keep their signatures, and manifest/INSTRUCTIONS are extra files the four-CSV readers ignore. Introduce the missing on-disk packet-pair helper (scout T §3: both existing call sites hand-roll CSVs) — e.g. `writeFilledPacketPair(root, fills, {reviewerA, reviewerB})`, which writes both dirs including filled manifests. |

## 3. Test obligations (regressions that weaken the rule must fail loudly)

House style throughout: tmpdir fixtures, `toMatchObject({written, refused, skipped})`, byte-identity of source files on every refusal, `diagnostics(result)` string matching, re-extract corpus after writes. All fixture-based tests pass `labTable`.

1. **Same directory twice refuses.** Fill one packet; `importReviewedPacket(root, dir, dir)` → throws on equal packet-id, source files byte-identical. (This proves the same-directory shortcut is closed — not that a single reviewer cannot fabricate a pair.) Also: CLI with one arg exits 2.
2. **Copied packet detected.** Fill A; `cp -r` A→B; edit B's reviewer name only → throws (equal packet-id), byte-identical sources.
3. **Self-approval detected.** Two distinct exports, same reviewer name (test casefold/whitespace variants) or same contact → throws.
4. **Disagreement fails closed.** Same row, two well-formed differing `bo` (e.g. tsheg difference) → `{written: 0, refused: 1}`, diagnostics contain `DUAL` and `disagreement`, source byte-identical, disagreement output lists both values.
5. **Agreement writes.** Identical `bo` in both → `written: 1`, `bo: reviewed('…')` present, `curatedBo` length 1 in fixture.
6. **Coverage mismatch refuses.** One filled, one empty → `refused: 1` (`coverage-mismatch`), not skipped.
7. **Both empty skips.** All-empty pair with filled manifests → all `skipped`, no-op; unfilled manifests → throws.
8. **NFC agreement.** Precomposed vs decomposed same text → agrees; written form is NFC.
9. **Context tamper refuses.** Packets differ in a `zh`/context cell → `DUAL` `context-mismatch`.
10. **Row deletion refuses.** Delete one floor row from one packet → throws on id-set mismatch (A ≠ B), nothing imported.
11. **Fabricated row refuses; drift does not.** (a) Add a row with an unknown id to both packets → throws. (b) Add a new `defineText` to the fixture *after* export → import still runs, agreed rows write, missing new id appears in the `DRIFT` notice, no throw.
12. **Manifest schema.** Missing manifest / empty reviewer-name → throws.
13. **Multi-alternative agreement.** JSON arrays with equal content but different spacing agree, and the written source contains the deterministic re-serialization (not either raw cell); a differing element disagrees.
14. **Duplicate id in one packet throws** before any pairing (guards the pre-IDENTITY `Map` last-wins hazard).

Tests 1–3, 10–12, and 14 are the tripwires: any future change that re-admits a one-packet path, drops the manifest checks, lets a partial packet through, or silently last-wins a duplicate id turns them red.

## 4. Inventory-lock / tripwire section — READ BEFORE CODING

Scout T verified empirically: **a new non-localized file with no `defineText` changes no corpus count** — `calls 499 / sourceFiles 15 / curatedBo 0 / names 117 / terms 34 / floor 161` all held. This spec adds no `defineText`, no `UI_COPY`/`CONSENT_COPY`/`DISCLAIMER_TEXTS`/`REFERENCE_LABS` keys, **no rows to `decisions.csv`** (the `toEqual` one-row lock at `tibetanImport.test.ts:302-308` and `:326` is why dual-review metadata lives in a new fifth file, not a decisions row), and **no columns to the four existing sheets**. `manifest.csv` and `INSTRUCTIONS.md` are sidecar files the existing readers ignore — unlocked territory per scout T §4.

Therefore: every exact-count and hash assertion in scout T's table (117, 34, 161, 278, 499, 15, 337, 393, curatedBo 0, the `62915e7c…`/`26b37ac4…` baselines, the direct-bo allowlist of exactly 1) must be **untouched and green** at the end. The only legitimate test edits are those enumerated in §2 (round-trip update) and §3 (new tests). If any pinned number or hash goes red at any point, **STOP AND ASK — do not rebaseline anything, do not adjust a count "to match", do not touch `lib/localizationBaseline.test.ts`, `lib/directBoAudit.test.ts`, `lib/localizedTextCorpus.test.ts`, or any curatedBo assertion.** This repo has been burned twice by silent rebaselines; a red count means the change did something this spec says it must not do.

Also: any parse error in a new file under `lib/` takes down every corpus test (files are TS-parsed even without `defineText`); `.test.ts` files are skipped by the scanner.

## 5. Verification

```
npx vitest run --pool=threads        # machine-load gotcha: forks pool flakes; always --pool=threads
npx tsc --noEmit
npm run build
```

Green looks like: all 97 existing tests pass (one round-trip test updated, zero count/hash edits) plus the ~14 new tests; `tsc` and build clean; `git status` shows no packet directories (packets are never committed). Manual smoke, two steps:
1. `npm run tibetan:export -- /tmp/a /tmp/b` prints two distinct packet-ids and `All bo cells are empty.` twice.
2. `npm run tibetan:import -- /tmp/a /tmp/b` on the **untouched** pair throws the manifest refusal (empty reviewer cells) — expected per D2. Fill both manifests with two distinct dummy identities (bo cells still empty) and re-run: all rows skipped, nothing written.

## 6. Non-goals

- **Semantic correctness checking.** Still human-only; PROTOCOL.md forbids back-translation and multi-model agreement as gates. Agreement of two independent humans is the control; the code only verifies the agreement.
- **Preventing a solo operator from fabricating both packets.** Explicitly out of scope (see §0); covered by git history and PR review.
- The PROTOCOL.md Tier-2 scoring study (0/1/2 scale, ≥90% threshold) — that decides Branch A/B; this spec gates the import path regardless of branch.
- Strengthening `decisions.csv` semantics (the seconds-decision stays advisory; unchanged).
- Covering the 220 unexported definition/`plain` strings (scout E §1 gap) — separate feature.
- Adjudication tooling, reviewer identity cryptography, git hooks, CODEOWNERS, CI import gating.
- Any relaxation of the A/B structural floor.

## 7. Open questions (answer before or during implementation — do not guess)

1. **Coverage-mismatch severity:** spec default refuses a row only one reviewer filled. If the founder anticipates staggered partial submissions row-by-row (not sheet-by-sheet), this will generate refusal noise — confirm the default.
2. **Manifest contact privacy:** reviewer contact info lives only in the un-committed packet dirs, but it will appear in import logs; confirm that's acceptable or restrict the printed summary to names.

## 8. Commit message

```
feat(tibetan): enforce two-reviewer import — paired packets, manifest identity check, fail-closed disagreement
```