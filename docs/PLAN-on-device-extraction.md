# PLAN — On-device extraction

**Status:** proposal, rewritten 2026-07-31, updated same day when both open research gaps closed ·
**Author:** Fable 5
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

### 4b. Public Chinese lab-report corpora do exist — and none of them is a test set at our bar

The §11 claim that this was unsearched is now closed. Two public corpora are real and directly on
our task; a third is text-only.

| Corpus | What it is | What it gives us | What it does **not** give us |
|---|---|---|---|
| **MedRepBench** (arXiv 2508.16674) | 1,925 de-identified Chinese medical report images — lab and exam — as photos, screenshots and electronic documents | Item-level labels in **exactly our schema**: name, value, unit, reference range, abnormality flag. A real Chinese distribution for phase 5 ranking. Released on HuggingFace | **Human ground truth.** Labels were produced by parsing OCR text into JSON with DeepSeek-R1 under a constrained schema; humans audited subsets (500 inspected, 200 audited) at **>97% field-level agreement**. ~3% label disagreement is three orders of magnitude above our gate. Also **CC BY-NC 4.0** — non-commercial |
| **Xue et al. 2023**, BMC Med Inform Decis Mak (PMC10629084) | 238 de-identified Chinese lab-report images from 119 paper files, captured by **scanners and smartphones under varying illumination** | The closest public analogue to our capture conditions, with genuine **dual human annotation, Cohen's κ = 0.89**, IOB-tagged text items typed as LabName / LabResult / LabUnit / LabRefRange | **Row binding.** The published annotation is entity typing plus text-item position, not name→value→range grouping; the repo's README documents VOC2007 detection data and does not document a grouping schema. n=238 is also far too small for our gate |
| **MedStruct-S** (arXiv 2605.03103, KSEM 2026) | 3,582 annotated clinical report pages | Stage-4 parsing tests over realistic OCR noise | **Geometry.** It is OCR-derived *text*, not images, so it cannot exercise stages 1–3 at all |

Read the middle column and the right column together, because the right column is the point:
**a corpus that types text items but does not bind them into rows does not solve our binding
problem**, and a corpus whose labels were written by a model cannot sit underneath a 10⁻⁵ gate.

**What this changes.** Phase 5 no longer waits on 50 hand-collected Lhasa photos to start ranking
parsers — MedRepBench is a usable ranking and error-discovery set today, and the Xue smartphone
images are the nearest public proxy for our capture distortion. **What it does not change:** the
held-out test set for §7 must still be generated by us, by hand. No public corpus has label quality
within three orders of magnitude of the bar.

Two operational cautions before planning around either: verify the MedRepBench HuggingFace release
and its NC licence against our intended use, and verify that the Xue Google Drive links still
resolve and whether row pairing is recoverable from the released annotation files. Neither was
confirmed by fetch.

Chinese-language search (`检验报告单 结构化抽取`, `医学检验 OCR 数据集`, and image-dataset variants)
returned nothing beyond the above.

**Caveat on that last sentence.** The corpus research agent died on a mid-response connection error,
so what it had already found survived but its search was not run to completion. The "absence of
evidence is absence of search" caveat is therefore *narrowed*, not retired: three corpora are now
known to exist and are characterised above, but "nothing else exists" remains unproven. Re-run before
relying on the negative.

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

### 5a. Stop calling it UCFE — the field already named it

The metric is sound. It is also **already published**, and we should use the published name.

- UCFE is **generalized risk**: undetected failures over *all* cases. Traub et al., *Overcoming
  Common Flaws in the Evaluation of Selective Classification Systems*, NeurIPS 2024
  (arXiv:2407.01032). Its integral over coverage is **AUGRC**.
- The umbrella field is **selective prediction / selective classification** (Geifman & El-Yaniv,
  NIPS 2017, arXiv:1705.08500). The standard plot is the **risk–coverage curve**.
- The medical-domain name for our failure mode is **silent failure** (Bungert et al., MICCAI 2023,
  arXiv:2307.14729). Document-processing industry calls the pair **silent failure rate** and **STP
  rate**.

Adopt those terms verbatim. Coining "UCFE" costs reviewability and buys nothing.

Two things follow that we got right for the wrong reason, and should now cite rather than argue:

1. **Why not selective risk / AURC.** Traub et al.'s stated motivation is our own instinct: selective
   risk counts errors only among *accepted* cases, so it "puts excessive weight on high-confidence
   failures" and can be gamed by a system that rejects a lot. Generalized risk counts undetected
   failures over all cases. That is the safety-gate metric.
2. **Why a warning is not a detection.** In selective prediction the gating function is binary:
   accept or reject. There is no "predict but flag" state in the formalism — a displayed-with-warning
   row is an *accepted* prediction and, if wrong, counts fully. Our rule is standard semantics, not a
   house rule, and that makes it much harder to argue with.

### 5b. Three corrections to how §5 is measured

**(i) A single number is not a gate — report risk *with* coverage.** "Generalized risk = 0.4%" is
meaningless if the system defers 80% of rows, and a system that suppresses everything scores 0. Gate
on the **(risk, coverage) pair**, or on AUGRC over the whole curve. Given §7 starts at 0%
auto-acceptance, coverage is the number that moves and must be reported beside every risk figure.

**(ii) The threshold needs a finite-sample guarantee, not a point estimate.** The literature's answer
to "set a deferral threshold when a silent error costs far more than a deferral" is one of:

- **SGR** (Geifman & El-Yaniv): binary-search the threshold on held-out data for a (target risk α,
  confidence δ) guarantee. Their CIFAR-10 run: target 0.01, achieved test risk 0.0092, bound 0.0099
  at δ = 0.001.
- **Learn-Then-Test / conformal risk control**: per candidate threshold λ, test H₀: R(λ) > α with
  Hoeffding bounds and Bonferroni over m thresholds; the selected λ* satisfies R(λ*) ≤ α with
  probability ≥ 1−δ, distribution-free and finite-sample valid. Applied to LLM abstention in
  arXiv:2405.01563, and it needs only a small calibration set — feasible for us.

Restate the gate as **"generalized risk ≤ α with confidence 1−δ on n held-out reports"**, and name n.
A bare empirical rate on a small eval set cannot support a shipping decision.

**(iii) Row-level exact match is our safety metric, but report field-level F1 beside it.** Group-level
exact match is published practice — KIEval (arXiv:2503.05488) adds it precisely because entity-level
F1 "provides limited or no assessment for group-level information extraction" — but it is not the
field default, and we should not claim it is. Justify the strictness by clinical cost. Report
field-level F1 alongside for comparability. **Adopt KIEval's Hungarian matching** to align predicted
rows to ground-truth rows before scoring, so the metric does not collapse when a model emits rows in
a different order or count.

Note also what the soft metrics are for: ANLS, TEDS and normalized edit distance (the OmniDocBench
standard, arXiv:2412.07626) all give partial credit and are therefore structurally unusable as safety
gates. That is a defensible, citable reason to depart from them — not an oversight.

### 5c. Confidence: measure AUROC before any threshold depends on it

§3(d) said self-reported confidence cannot carry the escalation design. The literature is harsher
than we were. Verbalized LLM confidence shows **ECE > 0.377** with mass piled in the 90–100% bucket
regardless of accuracy, and GPT-4's verbalized confidence separates correct from incorrect at
**AUROC ≈ 0.63** — barely above chance. Bungert et al.'s verdict across four biomedical tasks is that
**none of the benchmarked confidence scoring functions reliably prevents silent failures**.

So: **AUROC for error detection is the measurement to run**, on our own data, and it must beat 0.5 by
a wide margin before any threshold may depend on it. Until then, confidence is a research artifact,
not a control.

**The four failure modes, tracked separately:**

1. **Cell transcription error** (172→173) — exact-string, per cell.
2. **Binding error** — every cell string correct, wrong pairing. Invisible to metric 1.
3. **Omission** — rows silently dropped. Needs complete enumeration, not key-wise F1.
4. **Spurious emission on non-tables** — hard zero-row gate on the narrative/ECG/MRI/infographic
   corpus.

**And the actual product gate: generalized risk paired with coverage** — undetected critical-field
errors over *all* rows presented, reported beside the fraction auto-accepted. (The first draft of
this section said "selective risk", which is the metric Traub et al. specifically argue against for
exactly our use: it hides errors behind a high deferral rate. Corrected in §5b.)

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

Codex proposed **zero uncaught critical-field errors in ≥350,000 held-out auto-accepted rows**
(rule-of-three ⇒ <10⁻⁵/row) and ≥10,000 pages. Its justification: at 10⁻⁵/row a 30-row report carries
~0.03% risk, about **one affected report in 3,300**, and for users who cannot read the page
independently that is already the weakest defensible target.

Rule-of-three is already the right *shape* — a 95% upper bound, not a point estimate — so state it
that way explicitly: **generalized risk ≤ 10⁻⁵ per auto-accepted row at δ = 0.05, with coverage
reported**, and set the threshold by SGR or Learn-Then-Test rather than by eyeballing a held-out
rate (§5b).

**And note the label noise floor.** Medical-record abstraction by humans is itself reported at
**0.7%–20.8% error** (Sci Rep 2025, s41598-025-28767-z; inter-annotator agreement 92.4–97.3% of
fields, κ 0.54–0.88). Our own hand-transcribed ground truth is not error-free either. A gate set
below ~1% is arguing with the noise floor of its own labels unless every disagreement is adjudicated
— which is another argument for the cross-model-disagreement funnel in §4, and against ever treating
a single transcription pass as truth.

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
| **5** | Rank candidate parsers on **MedRepBench** (1,925 Chinese report images, §4b) first, then on ~50 real Lhasa photos | A winner on a Chinese report distribution, not a leaderboard — and ranking can start before any Lhasa collection |
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
4. **Whether probed confidence carries signal.** Unmeasured for every model in this class. The
   measurement is **AUROC for error detection** (§5c); verbalized confidence gets ≈0.63 on GPT-4 and
   the published verdict on medical silent failures is that no confidence scoring function reliably
   prevents them. Assume no until measured.
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
   refusal for on-device medical document extraction, evaluated on generalized risk at fixed coverage
   rather than character accuracy" is a real contribution — and it is now legible to reviewers,
   because every term in it is the field's own (§5a). The negative results — VLM rewrite rates,
   confidence miscalibration on degraded captures — are worth publishing on their own. MedRepBench
   gives the paper a public comparator for the parsing stage; nothing public exists for the binding
   and refusal stages, which is the gap the paper fills.

---

## 11. Provenance, and both gaps closed

Written by Fable 5. Independent architecture by Codex `gpt-5.6-sol` at xhigh, which supplied the
failure definition, the suppression-vs-flagging distinction, the statistical bar, and the
confirmation-UI finding — all adopted. Research pass over four angles with adversarial verification
of the model recommendations.

**Both gaps recorded on 2026-07-31 have now been researched.**

*Gap 1 — evaluation practice.* Re-run. Result: the metric survives, the name does not. It is
published as **generalized risk** inside **selective prediction**, our warning-is-not-detection rule
is the standard binary-gate semantics, and three things were missing: pairing with coverage, an
(α, δ) finite-sample guarantee via SGR or Learn-Then-Test, and an explicit ban on gating with
self-reported model confidence. All folded into §5a–§5c, §7, §9.

*Gap 2 — the Chinese-language literature.* Searched, in Chinese and English. It was absence of
search, and the search now returns results: **MedRepBench** and the **Xue et al. 2023** smartphone
corpus both exist and are directly on our task. Neither is a test set at our bar. See §4b for
exactly what each does and does not give us.

**What is still genuinely unknown after both passes:**

1. **No published head-to-head of frontier VLMs on lab-panel KIE against human ground truth.** There
   are clinical-text extraction studies — de-identification F1 0.897, SOAP-note generation at 52.9%
   of elements correct, hospital-quality abstraction at 90% agreement / κ 0.82 — but the spread of
   53%–99% across tasks means no number transfers to lab tables. **Our accuracy figures will have no
   external comparator. Say so rather than implying a benchmark exists.**
2. **Whether self-reported VLM confidence is ever usable here.** The literature leans clearly no; no
   lab-report-specific study exists either way. §5c says measure it.
3. **VALID** (Estevez et al., Flatiron Health, JCO CCI, doi 10.1200/CCI-25-00215) — variable-level
   benchmarking against expert abstraction plus internal-consistency and replication checks — is the
   closest thing to a rulebook for validating LLM-extracted medical data. Paywalled; only the
   abstract was obtainable. **Read it in full before finalizing the gate.**
4. **MedRepBench licensing and retrievability**, and whether row pairing is recoverable from the Xue
   release (§4b). Neither confirmed by fetch.
