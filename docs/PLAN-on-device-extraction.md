# PLAN — On-device extraction

**Status:** proposal, rewritten 2026-07-31 · **Author:** Fable 5
**Inputs:** an independent design by Codex `gpt-5.6-sol` (xhigh), and a four-angle research pass that
falsified two load-bearing claims of the first draft.

> **This is a rewrite, and the conclusion changed.** The first draft proposed distilling
> `claude-opus-4-8` into a small vision-language model that emits our full JSON schema on device.
> Research killed that: it is 5–15× too slow on the target hardware, and the model class is
> *measured* to rewrite short numeric strings rather than transcribe them. What replaced it is
> smaller, more boring, feasible today, and more consistent with this project's own architecture.

---

## 1. Verdict

**Do not build an on-device generative VLM that emits the row schema. Build a deterministic
extraction pipeline in which the model does only transcription and our own code does the binding.**

| | First draft | This plan |
|---|---|---|
| Model's job | read the table, emit 6-field JSON per row | transcribe text in a cell |
| Who binds value → analyte | the model's attention | **our deterministic code, from cell geometry** |
| Who decides "this is not a lab table" | the model | **structure detection, by construction** |
| Who guarantees JSON shape | the model | grammar-constrained decoding |
| On-device feasibility | 60–150s/page on mid-range | fast, offline, today |

The principle is the one this project already runs on: **the model does the mechanical part; the
meaning is deterministic.** We apply that to the reference table already. The first draft failed to
apply it to *layout*, and layout is where our known invisible failure lives.

---

## 2. Architecture

```
photo
  └─ 1. structure detection      ruled lines + numeric density + cell geometry
        │                        NO table region  ->  ZERO ROWS, by construction
        └─ 2. cell transcription   OCR per cell. Text in, text out. No interpretation.
              └─ 3. binding        OUR CODE. x-interval clustering + y-tolerance.
                    └─ 4. schema   grammar-constrained JSON assembly
                          └─ 5. render-then-verify  reconstruct the table, diff against the crop
```

**Stage 1 makes refusal structural.** The corpus contains 14 narrative pages, an ECG, MRI text, and a
body-diagram infographic with 32 organ labels and no numbers. Today the frontier model correctly
returns zero rows on all of them — but that is model *judgement*, and judgement can drift. With
structure detection, no ruled table region means no rows **by construction**. There is no generative
head that could hallucinate one.

**Stage 3 is the important one.** The offset-column page — where value/unit/range print one line
lower than the name column — is the failure I have called invisible and unguarded. Under this design
it is **a geometry bug**: testable, cheap, deterministic, and fixable with unit tests rather than
retraining. It also becomes *attributable*: when a row is wrong, we can say which stage produced it.

**Stage 5, render-then-verify**, is the only cheap instrument that catches a binding error, because a
mispaired row has perfect per-cell strings and a visibly wrong reconstruction. It needs no ground
truth, so build it early.

### On the model itself

**Buy before build.** OmniDocBench v1.6 is considered saturated: MinerU2.5-Pro (1.2B) 95.69,
GLM-OCR 95.15, PaddleOCR-VL-1.5 94.87. Distilling Opus into a generic 2B base is months of work that
may land *behind* a free 1B baseline. LoRA-adapting an existing parser is weeks, on ~1k–3k filtered
examples rather than 10k+.

Candidate shortlist, to be ranked on **our** distribution rather than a leaderboard (see §3b):
**PaddleOCR-VL-1.6** (0.96B, Apache-2.0, best published Chinese table TEDS, and the only candidate
evaluated on real physical distortion), **MinerU2.5-Pro** (1.2B), and a **mobile OCR baseline**
(PaddleOCR-mobile / ML Kit) which has a measured 0% rewrite rate and must be in the comparison as the
conservative control.

Keep the **vision tower in FP16**. Every serious OCR quantization recipe excludes the vision encoder
from INT4; our failure mode is vision-side, and no published ablation shows INT4 preserves exact
digits.

---

## 3. Why the obvious approach fails

Recorded so nobody re-proposes it in three months.

**(a) General VLMs rewrite rather than transcribe.** FaithC4 (1,455 pages, 15 systems), rewrite rate
on perturbed words: traditional OCR **0%**, Gemini-2.5-Flash 64.6%, Qwen3.5-4B 29.5%. **Short strings
of 4–6 characters — "172" — are rewritten up to 10% of the time.** A model that substitutes a
plausible digit under glare is our defined total failure, and this is a measured property of the
class, not a tuning problem.

**(b) Leaderboards are measured on clean scans; our input is phone photos, and the ranking inverts.**
MDPBench (HUST, separates digital from photographed): open models drop **17.8%** on photographed
documents. GLM-OCR is near-SOTA on clean scans and **63.7 on photos**. Any shortlist built from
OmniDocBench is built on the wrong distribution.

**(c) Latency, measured.** Snapdragon 8 Elite — the best phone SoC that exists — Qwen3-VL-2B Q4_0:
TTFT ≈4.7s at 640×640, a resolution too low for a dense lab table; ~1000 output tokens ≈24s decode.
**~30s flagship best case at unusable resolution.** Document resolution is ~4× the vision tokens.
Mid-range measures 3–7× slower ⇒ **60–150s/page**. The NPU does not rescue it: on llama.cpp Android,
Hexagon and OpenCL are equal to or slower than CPU. NPU helps prefill; the bottleneck is decode.

**(d) Self-reported confidence cannot carry an escalation design.** Zero published calibration
numbers (ECE, selective risk, AURC) exist for *any* 1B–4B document VLM. Prompted abstention is
outperformed by simple confidence baselines. And the failure is worst exactly where we need it:
models abstain when evidence is **absent** but attempt reconciliation when evidence is **degraded** —
glare, skew, crumple. Confidence must be a *trained or probed* artifact (an LRP-style probe on
intermediate hidden states), never a prompted one.

**(e) Naive synthetic data causes the exact failure we call disqualifying.** Rule-based table
rendering gives limited layout templates, which triggers repetition out of distribution — i.e. row
invention. With capture-aware augmentation (perspective, bends, wrinkles, photometric, camera) the
same corpus gives +8.21 on real photographed pages and cuts repetition/hallucination 8.6 → 4.3. The
load-bearing part of a synthetic budget is **layout diversity and photo-degradation realism**, not
the table renderer.

---

## 4. Ground truth: we have 27 rows, and they are not a test set

`validation/real-corpus/field-lhasa.ts` holds **27 hand-transcribed rows**. Everything else that
looks like a corpus in this repo — the 113-row and 129-row reads — is a record of *what a model
said*. The 2026-07-26 document says so in its own text.

**n=27 cannot distinguish 97% from 99%, and at our bar that distinction is the entire product.**
Spend those rows calibrating instruments, not as a test set.

Three ways to get real ground truth, in cost order:

1. **Cross-model disagreement as an error-finder.** Run Opus + one other frontier model + one open
   parser on the same page. Disagreements are the candidate error set, and only those need human
   adjudication. A published heterogeneous judge rejected **25%** of a 30B teacher's document
   outputs. This is far cheaper than transcribing everything and it targets human effort where it
   pays.
2. **Render-then-verify** (§2 stage 5), which needs no ground truth at all.
3. **Hand transcription** of a held-out set — still necessary, but a smaller one than the first draft
   assumed, because (1) and (2) do the discovery.

**Measure Opus's own error rate before generating any labels from it.** It is the ceiling on any
student, no one has published a teacher-error → student-error propagation constant for structured
extraction, and it is the most important unmeasured number in the project.

---

## 5. Metrics

The first draft proposed a single "silent error rate." That conflates four failure modes with
different causes, fixes and owners. Split it.

**Definition, from Codex, and stricter than my original:**

> **UCFE — uncaught critical-field error**: a wrong value, wrong printed range, or wrong row binding
> that passes the verification gate and is **displayed as final**.
>
> A warning beside a wrong chip does **not** make the error detected. Detected means the result is
> **suppressed**, or mandatory verification occurs before display.

That distinction is this codebase's own hard-won lesson. Feature 2 died because the emergency banner
was non-suppressing by design — only `blocked()` dropped content. A flag is not a control.

**The four failure modes, tracked separately:**

1. **Cell transcription error** (172→173) — exact-string, per cell.
2. **Binding error** — every cell string correct, wrong pairing. Invisible to metric 1.
3. **Omission** — rows silently dropped. Needs complete enumeration, not key-wise F1.
4. **Spurious emission on non-tables** — hard zero-row gate on the narrative/ECG/MRI/infographic
   corpus.

**And the actual product gate: selective risk at our review-coverage budget** — error rate among
auto-accepted rows, at a fixed percentage routed to confirmation.

**Stress suites** (from Codex, adopted wholesale): reproduce the frozen camera-path pages without
training on them; hold out entire hospitals and layouts; run the real PWA resize path (1600px max
edge, JPEG q0.85); **counterfactual patching** — alter one digit in one cell and exactly one field
must change; **translation tests** — shift a value column vertically with names fixed; crop, glare,
tilt, compression; and empty-cell tests proving the model does not fill in a likely value.

---

## 6. Product prerequisite — the confirmation screen does not currently work for this

Codex found this and I verified it:

```
components/ConfirmValues.tsx:27
  useState<Record<number, { value: string; unit: string }>>
```

The confirmation screen edits **value and unit only**. Not `printedRange`, not the analyte name, not
row association. `RowManifest.tsx` shows no range and no image crop.

So the control the whole calibration design leans on cannot verify:

- **the printed range** — and the chip is arithmetic on value *against* range, so a misread range is
  exactly as harmful as a misread value;
- **row association** — the layout-offset failure;
- **anything against the page**, since there is no crop; the user is checking against memory of a
  document they may not be able to read.

**Before any on-device extraction ships**, uncertain rows need a highlighted source crop and
verification of **name–value–range together**. Until then, "detectable error" is not practically
recoverable, and no amount of model work fixes that.

---

## 7. The bar

Codex proposed **zero UCFE in ≥350,000 held-out auto-accepted rows** (rule-of-three ⇒ <10⁻⁵/row) and
≥10,000 pages. Its justification: at 10⁻⁵/row a 30-row report carries ~0.03% risk, about **one
affected report in 3,300**, and for users who cannot read the page independently that is already the
weakest defensible target.

I accept the reasoning and note what it implies: **that corpus may cost more than years of cloud
OCR.** That is not a reason to weaken the bar. It is the honest argument against auto-acceptance, and
it points at the answer:

**Ship with no auto-acceptance at first.** Every row confirmed, with a crop. Coverage earns its way
up only as measured selective risk allows. That inverts the usual order — start at 0% auto-accept and
climb — and it is the only version where the statistics can ever be satisfied.

Non-negotiable regardless of coverage: **zero fabricated rows** on the narrative and infographic
pages. That is the OCR-only invariant expressed as a test.

---

## 8. Phasing, with a kill gate

| Phase | Work | Gate |
|---|---|---|
| **0** | **Latency spike on three real Lhasa-market handsets.** One crumpled real report, three resolutions, wall-clock per page. | **HARD KILL GATE.** One day. Nobody has published a single VLM latency figure on any Snapdragon 6/7 or Dimensity 7000/8000. If it is minutes, the generative path is dead and we go deterministic-only. |
| **1** | Measure **Opus's own error rate** via cross-model disagreement + adjudication | The distillation ceiling, and the first honest accuracy number this project has |
| **2** | Render-then-verify harness | Binding errors become detectable without ground truth |
| **3** | Fix the confirmation UI: range, row association, source crop | §6 satisfied |
| **4** | Structure detection + deterministic binding + mobile OCR baseline | Zero-row gate passes; binding accuracy measured on the offset page |
| **5** | Rank candidate parsers on ~50 real Lhasa photos | A winner on **our** distribution, not a leaderboard |
| **6** | On-device integration, 0% auto-accept, coverage climbs on evidence | §7 |

**Phases 1–3 are worth doing even if no model is ever shipped.** They convert this project's accuracy
claims from self-graded to measured and close a real hole in a screen we already ship.

---

## 9. What only a prototype can settle

Ranked by how much they would change this plan:

1. **Latency on real target hardware.** Unpublished for every mid-range chip. One day. Settles
   feasibility outright.
2. **Model ranking on our distribution** — no published benchmark measures either of our two hardest
   requirements (binding, refusal).
3. **Opus's error rate on our corpus.** Sets the ceiling.
4. **Whether probed confidence carries signal.** Unmeasured for every model in this class.
5. **Whether INT4 preserves exact digits.** No published ablation exists. A quantization costing 1%
   on OCRBench could still turn 172 into 173.
6. **Whether grammar-constrained decoding costs accuracy on Chinese OCR.** Literature is split.
7. **Whether our synthetic tables match Lhasa photos.** The one paper claiming transfer never
   measured it and conceded the point.

---

## 10. Open questions for the owner

1. **Fund the one-day latency spike first?** *Recommend: yes, and gate everything on it.* It is the
   cheapest experiment on the list and it can kill or confirm the whole direction.
2. **Deterministic pipeline, or keep pursuing the generative VLM?** *Recommend: deterministic.* It is
   feasible today, has a 0% rewrite rate, fails visibly, and matches the project's existing split
   between mechanical extraction and deterministic meaning.
3. **Do we accept "no auto-acceptance at launch"?** *Recommend: yes.* It is the only path where the
   statistical bar is reachable, and it makes the privacy win available immediately rather than after
   an unaffordable corpus.
4. **Is this a publication?** *Recommend: yes.* "Deterministic geometric binding with structural
   refusal for on-device medical document extraction, evaluated on uncaught critical-field error
   rather than character accuracy" is a real contribution, and the negative results — VLM rewrite
   rates, confidence miscalibration on degraded captures — are worth publishing on their own.

---

## 11. Provenance and a known gap

Written by Fable 5. Independent architecture by Codex `gpt-5.6-sol` at xhigh, which supplied the UCFE
definition, the suppression-vs-flagging distinction, the statistical bar, and the confirmation-UI
finding — all adopted. Research pass over four angles with adversarial verification of the model
recommendations.

**One research angle failed** (`eval-practice`, connection error mid-response). So claim G of the
first draft — that silent error rate is the right shipping gate — is **unverified against the
literature**. It was corrected on Codex's reasoning rather than on published evaluation practice, and
the standard terminology (selective prediction, risk-coverage curves) has not been checked. Re-run
before treating §5 as settled.

**Also not adequately searched: the Chinese-language literature.** The research hit a rate limit
before returning Chinese results. Re-run `检验报告单 结构化抽取` and `医学检验 OCR 数据集` before
concluding that no Chinese medical-report corpus or benchmark exists. Absence of evidence here is
genuinely absence of search.
