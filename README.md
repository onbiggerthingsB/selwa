# Health Translator

A phone-camera web app for people holding a Chinese hospital lab report they cannot read.

Photograph the report. Each row comes back explained in plain language: what the analyte is, and
where the printed value sits against the range printed on the same page. It does not diagnose, does
not advise, and does not tell you whether a result is good or bad.

The users are elderly Tibetans and Mandarin-weak readers in Lhasa, plus a US Mandarin-diaspora
beachhead. Fieldwork found the pressing need was not translation in general but one specific thing:
understanding the Chinese report already in your hand.

**Student research project. Not a commercial product, not publicly deployed, not a medical device.**

## The invariant

> The LLM is OCR-only. Meaning is deterministic from a curated table.
> Never assert what cannot be verified against the printed page.

The vision model transcribes the printed analyte, value, unit and reference range. It never supplies
a range, classifies a value, diagnoses, or translates a clinical claim. Everything that assigns
meaning is deterministic TypeScript over a curated table.

```
extract (Claude, OCR only)
  → reference lookup      175 analytes (data/reference-labs.ts)
  → unit check
  → classification        internal, never presented as our verdict
  → safety guard          R1-R18, plus cross-row checks
  → confirm-the-values gate
  → templated summary
```

**The status chip is table-independent.** "Below / within / above your report's range" is arithmetic
on the printed value against the printed range, so it renders even for rows the table cannot name.
Two consequences the codebase takes seriously: declining to curate an analyte does not stop a user
seeing a position for it, and `chipWrong === 0` is necessary but not sufficient. Both were
established by measurement rather than argument (`validation/camera-path/`).

Of the 175 entries, 100 carry a curated reference band and 75 are **report-only**: they assert no
band and classify purely from what the page prints. Report-only is the honest default wherever an
interval depends on the instrument, the assay, or the population.

PHI stays on the device. The image transits the server only to reach Claude and is never persisted;
the kept record lives in the browser's IndexedDB.

## What it deliberately will not do

**No advice.** A free-text health-advice feature was built, measured, and quarantined behind an
unconditional 410. Run against real inputs, the shipped guard produced a starvation-level eating
plan, a false "this is not cancer" reassurance, and advice to exercise through crushing chest pain,
with the safety banner failing to suppress any of it. The guard enforces lexical and structural
floors; it cannot tell correct advice from confidently wrong advice. See
[app/api/advice/route.ts](app/api/advice/route.ts) and
[docs/CODEX-SPEC-quarantine-feature2.md](docs/CODEX-SPEC-quarantine-feature2.md).

**No generated Tibetan.** `curatedBo === 0` is an enforced test: zero model-generated Tibetan strings
ship, and every `bo` string falls back to Chinese. Machine Tibetan cannot currently be verified, so
Tibetan arrives as a fixed set of human-reviewed strings or not at all.

**No live speech interpretation.** Real-time interpretation of a consultation is the thing users ask
for most and the thing least safely done. Our position is not that nobody needs it, but that nobody
can currently do it verifiably, us included. What replaced it is the companion reader: a younger
Mandarin-speaking relative reads the explained report aloud to an elder.

**No targets presented as results.** A 健康建议 page prints lines like 总胆固醇保持在：2.8~5.2
mmol/L. Those are goals, not measurements, and they use analyte names the table recognises. The
extraction prompt refuses advice, recommendation and summary sections for that reason.

## Tibetan: the two-person rule

Tibetan copy is a fixed, human-reviewed string set. Nothing is generated at runtime.

Two reviewers work the same 512-row packet independently. The importer rejects duplicate packet ids,
matching identities, and any row where the two disagree. **It never picks a winner** — disagreements
go back to the reviewers. Anything a reviewer is unsure of is left blank, and blank means not
published.

```bash
npm run tibetan:export -- <packet-dir-a> <packet-dir-b>
```

The first two submissions arrived 2026-08-01 and **agreed on 1 name out of 174**. That turned out to
be systematic rather than careless: one reviewer coins descriptive Tibetan, the other transliterates
the international term, and each described the other's work as correct. What it taught us is in
[validation/tibetan/first-submissions-2026-08-01.md](validation/tibetan/first-submissions-2026-08-01.md);
the rule itself is in [docs/SPEC-tibetan-two-person-rule.md](docs/SPEC-tibetan-two-person-rule.md).

## Running it

Node 20+. The home page and the whole test suite run without credentials.

```bash
npm install
cp .env.local.example .env.local
npm test
npm run dev
```

Report extraction and notes translation fail closed without `ANTHROPIC_API_KEY`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and a 32-or-more-character
`RATE_LIMIT_IP_HASH_SECRET`. See [docs/RUNNING.md](docs/RUNNING.md) for Upstash provisioning,
configurable limits, and deployment checks.

`npm run dev:pwa` runs the dev server with the service worker (Serwist needs webpack).
`npm run build` generates `public/sw.js`.

The suite is 1210 tests. It needs the threads pool; the forks pool fails under machine load:

```bash
npx vitest run --pool=threads
```

## Validation

Numbers here are labelled by how they were obtained, because the distinction has mattered
repeatedly.

- [validation/camera-path/](validation/camera-path/) — the only record of what the vision model
  actually read off a photograph. Includes a run with hand-transcribed ground truth (23 of 25 values
  correct, both errors reproducible across three runs) and a 31-page 健康体检报告 scored for
  self-consistency.
- [validation/real-corpus/](validation/real-corpus/) — the deterministic middle against
  hand-transcribed rows, gated at zero confidently-wrong rows.
- [validation/tibetan/](validation/tibetan/) — what the first human Tibetan submissions measured.

Two limits worth knowing before quoting anything:

**Ground truth is 27 rows.** [validation/real-corpus/field-lhasa.ts](validation/real-corpus/field-lhasa.ts)
is the only hand-transcribed data in the project. Everything else that looks like a corpus is a
record of what a model said. Five of those 27 names are disputed and were resolved in the model's
favour without the basis being recorded.

**Recognition figures measure the table, not correctness.** 96.9% on a real 31-page Lhasa health
check means the table could name the rows, not that the rows were read right. Recognition on the
camera path started at 3.8% once it was measured against real camera output instead of hand-cleaned
names, which is why that distinction now gets stated everywhere.

## Documents

| | |
|---|---|
| [docs/DESIGN.md](docs/DESIGN.md) | architecture, the guard, validation plan, risks |
| [docs/VALIDATION-METHODOLOGY.md](docs/VALIDATION-METHODOLOGY.md) | what each number means and does not mean |
| [docs/PLAN-on-device-extraction.md](docs/PLAN-on-device-extraction.md) | deterministic on-device pipeline; the generative version was researched and rejected |
| [docs/SCOPE-prescription-feature.md](docs/SCOPE-prescription-feature.md) | prescriptions: split verdict, mostly no |
| [docs/V1-EXPANSION.md](docs/V1-EXPANSION.md) | the brief that scoped v1 on top of the v0 safety core |
| [docs/field/](docs/field/) | runnable field protocols: reviewer recruitment, term comprehension, latency spike, mainland reachability |

## Open

The largest gaps are not code.

- **Nobody has measured whether a Mandarin-weak reader understands the output.** Every number here
  measures whether the pipeline is correct, not whether anyone can read the result.
  [docs/field/TEST-term-comprehension.md](docs/field/TEST-term-comprehension.md) is the protocol. It
  takes an afternoon and has not been run.
- Two Tibetan reviewers are mid-reconciliation. All 174 definitions still have one opinion.
- Privacy policy, WA MHMDA consumer-health-data policy, processor terms and a breach runbook are
  outstanding.
- One page in the real corpus prints its value column about a line below its name column. Whether
  production extraction mispairs those rows is untested, and a mispairing would reproduce
  identically across runs, so self-consistency cannot see it.
