# SCOPE — Prescription / Medication-Sheet Feature

**Status:** proposal for owner decision · 2026-07-29
**Governing invariant:** the LLM is OCR-only; meaning is deterministic from a curated table; never assert what cannot be verified against the printed page.

---

## 1. VERDICT FIRST

**Split verdict. One half is a permanent no. The other half is "not yet — one week of measurement first."**

### NO, permanently: the medication *explainer*

Do not build "photograph your medicine, we tell you what it is / what it's for / what to watch for." Four independent blockers, any one of which is sufficient:

1. **The page does not contain the meaning.** This is the structural break from labs, and it is not a detail. A lab report prints its own reference range — the page is self-sufficient, which is exactly what makes "never assert what cannot be verified against the printed page" tractable, and what makes the confirm-the-values ritual meaningful. A drug row prints a name, a strength, and a count. Indication, class, contraindications, side effects are **not on the page**. Every word of them would be an assertion sourced from our table and verified against *nothing the user can see*. The verification ritual that grounds the lab feature has no analogue here.
2. **A quarter of the corpus has no verifiable plain-language meaning at all.** 中成药 is ~25% of outpatient prescriptions at a Beijing tertiary hospital (22,778/90,228) and ~1 item per prescription in Sichuan primary care. Its authoritative "what it is" field is 功能主治 in TCM terms (活血化瘀, 清热解毒). There is no Western pharmacological class to map to. Worse: >70% of ~57,000 中成药 approvals print 尚不明确 in at least one of 禁忌/不良反应/注意事项 — the label is *literally empty* for the fields that drive a user to open the app. Rendering that silence to an elderly Tibetan reader will be read as reassurance. That is the truth-blind advice guard in a new costume.
3. **Lhasa specifically is uncurable from national sources.** TAR enforces 103 民族药 + 287 藏药饮片 + **1,399 医疗机构制剂**. Hospital-compounded preparations are named under provincial review only (处方管理办法 第十七条) and appear in no NMPA or NHSA database. That single list outnumbers the entire national essential-medicines list. And per the verified finding [[refusing-to-alias-does-not-bound-the-chip]], "it stays unrecognised" is not a control — an unrecognised row still renders something.
4. **It is commoditised, and the one measured study found no safety benefit.** 蚂蚁阿福 ships exactly this wedge (photograph the box → 讲用法) at ~100M registered / ~29M MAU, 55% tier-3-and-below; Baidu's AI用药助手 is free on WeChat; Alipay traceability-scan does curated simplified labels on 9,000+ SKUs. Meanwhile the closest direct precedent to *our* version — 刘嫚 et al., 中国药房 2025;36(12):1515-1519, a Tibetan-language medication service with fixed human-reviewed strings over 400+ drugs — moved good adherence 7.0% → 31.0% (P<0.001) but moved ADR incidence **not at all** (3.6% vs 3.1%, n.s.). Building a worse 阿福 to achieve an unmeasured safety benefit is not a plan.

### NOT YET, then YES: the printed-instruction *transcription card*

There is a real, narrow, invariant-compliant feature underneath: **quote the fields that are actually printed, in the reader's language, and gloss only the closed clinical vocabulary that the state has already standardised.** Drug name verbatim. 规格 verbatim. 用量 verbatim. 用法 (route) glossed from a national code table. Frequency glossed from a curated table. 临床诊断 echoed verbatim as a page-level field. Nothing else.

This survives where the explainer dies, and the narrowing pays for itself three times over:

- **It makes 中成药 and 藏药制剂 shippable.** A 中成药 row prints 名称/规格/用量/用法 in exactly the same columns as a Western row. The hazard was never transcribing it — it was *explaining* it. Dropping the meaning layer recovers ~25% of the corpus for free.
- **It designs out the strength-mismatch hazard.** 一品两规 means the same generic legitimately appears at two strengths per institution, so a name→strength lookup is a silent high-harm failure. We never look up a strength; we quote the one on the page. The hazard cannot occur.
- **It bounds the OCR-collision damage.** 甲巯咪唑/甲硝唑 is a one-character slip to a real, different drug — the lookup *succeeds* and renders confident correct-looking text. Under transcription-only, the worst case is a wrong name rendering, not a wrong clinical claim. **The meaning layer is precisely what converts an OCR slip into a clinical assertion.**

And it targets the one documented harm in exactly our population: 错误口服外用药 — swallowing a topical — named by the 中国药房 authors as an observed consequence of Mandarin-only counselling, and the single most common misinformation category in Douyin drug videos (7 of 14 errors found in 138 videos, 98.6% posted by doctors). Route is a closed 26-value national code set (WS/T 364.12-2023 表2 CV06.00.102). This is a fixable harm with a curatable vocabulary.

### The gate before any code

**Do not write a line until 200–300 real artifacts are photographed in Lhasa.** Three desk-research unknowns each independently decide the architecture, and all three are answerable in one week:

1. **Which document does the patient actually hold?** 处方管理办法 第五十条 requires the *dispensing institution* to retain the prescription (1/2/3 years by class); 第二十八条 has the pharmacy filing the printed copy at dispensing; trade reporting says most hospitals never print one at the physician's desk. The artifact in hand is far more often a 药袋标签, a pink 出院带药 copy, or a 费用清单. Building the schema around 处方 risks a feature with no input.
2. **Does the bag label print 规格 at all?** 第三十三条 requires the drug bag to carry only 患者姓名、药品名称、用法、用量. **No 规格.** If that holds in practice, then on the most common artifact our atomic-pair rule (below) means we render *nothing actionable* — which may kill the feature. This is measurable in an afternoon and it is the highest-leverage fact in the whole document.
3. **What fraction of rows is 藏药/院内制剂?** Unknown, plausibly much higher than Beijing's 25% 中成药 share. It sets curation volume and it sets how often the name table misses.

Also worth measuring in the same pass: the coverage curve of verbatim 用法用量 strings, and whether the quantity field is handwritten. There is **no published Chinese corpus study of 用法用量 strings** — audit papers count defects, never vocabulary — so the size of the tail is currently unmeasured, and the "a few dozen patterns cover nearly everything" assumption is unsupported.

---

## 2. THE DIAGNOSIS LINE

### What the research established

**Established and verified:**
- 临床诊断 is an enumerated field of the 前记 that the national 处方标准 (附件1) requires every prescription form to carry, alongside institution, fee category, name/sex/age, chart number, department/ward/bed, and date. *(Verified against gov.cn and moj.gov.cn copies.)*
- 第六条（十）: 「除特殊情况外，应当注明临床诊断。」 Mandatory **with an express exception**. 第六条（一） additionally requires it be legible, complete, and consistent with the medical record. *(Verified; 处方管理办法 is 卫生部令第53号, in force since 2007-05-01, unamended, confirmed not repealed by the 2023 and 2026 cleanup decisions.)*
- 附件1 defines *contents*, not layout. 第五条 splits authority: the national ministry fixes 处方标准; each province fixes 处方格式; each institution prints to that. Expect per-province, per-hospital layout variation over a fixed field vocabulary.

**Failed verification — do not build on it:** the claim that the 特殊情况 exception is an *official* privacy/harm interpretation covering psychiatric/HIV/oncology/reproductive prescriptions. The source is a county health bureau's repost of a non-binding 处方点评 training checklist (台儿庄区卫健局, 2021), not an NHC instrument; it names **no** disease categories — those were the researcher's inference; and 第二十一条 in fact requires *more* diagnosis documentation for outpatient cancer-pain narcotics (a level-2+ hospital 诊断证明 plus 知情同意书). Documented practice for privacy-sensitive diagnoses is more often a coded or non-specific entry than a blank.

**Practically:** the printed diagnosis frequently under-specifies. Audits report doctors writing one of several conditions for multimorbid elderly patients, and placeholders such as 待查 / 体检取药 / 妇科检查. Missing-or-incomplete diagnosis is item 10 of the national 不规范处方 audit list — its existence as a category means it occurs at material rates. (A 2012 single-hospital study reported 诊断书写不清 21.05% / 不规范 9.36%; order-of-magnitude only, not a design constant.)

### The line

> **We may quote a printed string and say where on the page it was printed. We may not connect two printed strings to each other, and we may not assert that a printed string is true of the person holding the page.**

The diagnosis is a **page-level header field**, not a per-row field. With a 5-drug cap (第六条（七）) and multimorbid elderly patients, one printed diagnosis routinely covers several conditions. Pairing it with a drug row is an inference that will be wrong on exactly our target population.

Render the diagnosis in a **physically separated page-level block above the drug rows**, in reported-speech register, never adjacent to or interleaved with a row.

### Allowed strings

```
"你的单子上，「临床诊断」这一栏印的是：2型糖尿病"
"Your sheet prints, in the field labelled 临床诊断: 2型糖尿病"

"这一行印的药名是：二甲双胍片"
"「规格」这一栏印的是：0.5g/片"
"「用量」这一栏印的是：每次1片"
"「用法」这一栏印的是：口服。口服的意思是从嘴里吞下去。
   （用药途径依据 WS/T 364.12-2023 表2）"

"这张单子上印了3种药。"              ← counting rows on the page; arithmetic, like the chip
"「临床诊断」这一栏是空的。"          ← state it; do not prompt a re-photograph
"「规格」这一栏我们没有读到。"        ← and therefore we do not render 用量 at all
```

### Forbidden strings

```
"二甲双胍是治疗2型糖尿病的药。"
    → pairs a row with the header field. Inference. The header may belong to a different
      condition entirely.

"这个药是降血糖的。"
    → drug meaning. Not on the page. No page-side counterpart can corroborate it.

"每次10mg"   (page prints 规格 5mg/片 + 用量 每次2片)
    → COMPUTED. 附件1 lists 规格 and 用法用量 as separate columns; oral solids are counted in
      片/丸/粒/袋 (第七条). The mg figure exists nowhere on the page. This is the single
      easiest way to ship a 10x display through a strength-vs-count parse error.

"一日三次就是每8小时吃一次。"
    → adds an interval the page does not print. NCC MERP separately argues interval framing
      harms patient understanding and recommends time-of-day phrasing instead.

"饭前服 = 饭前半小时服用。"
    → the gloss itself is contested: 半小时 (China Economic Net) vs 10~30分钟 (南京市中西医结合医院)
      vs 30分钟 (Zhejiang Univ 2nd Hospital). Whatever we print becomes OUR assertion.
      Render qualitatively ("before eating") or cite the specific source in-product.

"你有糖尿病。"
    → asserts the printed string is true of this person. We quote; we do not diagnose.

"共7天的量。"   (page prints 数量 but no 天数)
    → computed. 第十九条 caps ordinary prescriptions at 7 days, but the day-count is only
      safe to echo when printed.

"这两种药可以一起吃。"           → interaction. A classification about the combination.
"记得按时吃，别漏服。"            → advice. Same class as the quarantined 410 feature.
```

---

## 3. SCOPE

### In

| | |
|---|---|
| **Documents** | 药袋标签 · 出院带药单 (pink patient copy) · 门诊/住院费用清单 drug lines · 电子处方 screenshot · paper 处方 when actually held. **Final list set by the field measurement, not by this document.** |
| **Fields** | 药品名称 (verbatim) · 规格 · 数量 · 每次用量 · 频次 · 用法/route · 天数 · page-level 临床诊断 · page date |
| **Curated vocab A** | Route — 26 values, WS/T 364.12-2023 表2 CV06.00.102 |
| **Curated vocab B** | Frequency + timing + dose units — national table where one exists, empirical where it does not |
| **Drug names** | Recognition **for rendering only** (see §4). No definitions. |
| **Languages** | zh / en / fixed reviewed Tibetan strings, same two-person rule as the existing string set |
| **Register** | Reported speech throughout: 「印的是：每次1片」, never 「每次吃1片」 |

### Out — and why

**Drug meaning of any kind.** Indication, class, "what it's for", side effects, contraindications, storage. §1 blocker 1. Not a v2 item; a permanent non-goal.

**中药饮片 (TCM decoction) sheets — detect and decline.** Structurally a different document: must be on its own sheet (第六条（七）), ordered 君臣佐使, with per-herb preparation footnotes bracketed at the herb's upper right (先煎/后下/包煎/烊化/冲服/另煎), and a **prose** 用法用量 sentence appended after the 剂 count — 国家中医药管理局's own worked example is 「每日1剂，水煎400ml，分早晚两次空腹温服」. That is generative, not a closed vocabulary. A row-wise parser will produce structurally wrong output. Detection is cheap and deterministic: 剂 as a unit + per-herb parentheticals. Decline, don't degrade.

**Computed anything.** mg per dose, total daily dose, days of supply, unit conversion. §2.

**Interaction, duplication, appropriateness, "is this dose right for you".** Every incumbent advertises interaction checking; the pull will be strong. Any interaction claim is a classification about the combination. Same class as the quarantined feature — and the guard is already known to be truth-blind, so a guard will not save it.

**Reminders, adherence nudges, dose scheduling.** A different product (吃药管家 already ships it) and it converts a quoted transcription into a standing instruction we own.

**Latin frequency-code expansion for qd / qod / qid / q1d.** ISMP lists Q.D./QD/q.d./qd as error-prone — "mistaken as q.i.d., especially if the period after the q or the tail of a handwritten q is misunderstood as the letter i"; NCC MERP documents actual mis-administration at QID rather than daily, and lists Q.O.D. as misread as *both*. This is a 4x overdose class. Note: I could **not** establish that Chinese patient-safety governance names qd/qid as a hazard — T/CHAS 10-4-5-2019 addresses LASA at the drug-name level only. Do not cite this as a Chinese standard.

**Handwritten numerics in the quantity field.** Kunming, Aug 2021: a pharmacist hand-wrote 每次1粒 on a dispensing bag; the mother read 7粒 and dosed a 4-year-old at 7 capsules three times daily. Promethazine overdose, gastric lavage twice, two days inpatient. The pharmacist's explanation was that the stroke of the 1 curved. Handwritten digits in the quantity field are the highest-harm, lowest-OCR-reliability combination on the page.

**Retaining any image or telemetry from these pages.** A 处方 carries name, age, department, prescriber, chart number, and the diagnosis in plaintext. 麻醉药品/第一类精神药品 prescriptions additionally print the **patient's national ID number** and the proxy collector's name and ID. And colour cannot classify: 第二类精神药品 uses white paper identical to an ordinary prescription, distinguished only by the corner mark 精二. Assume every page is ID-bearing.

---

## 4. DATA MODEL

**Two tables, and the smaller one is not the important one.** Dosage vocabulary is curated **separately** from drug names, and it carries the safety weight.

### Table A — `MedicationEntry`: a name-*rendering* table, not a meaning table

```ts
interface MedicationEntry {
  key: string;                    // stable id, e.g. 'metformin'
  name: LocalizedText;            // reviewed en/zh/bo — the RENDERING, not a description
  aliases: string[];              // 通用名 + 曾用名 + brand (EN and ZH) + pinyin
  category: 'western' | 'zhongchengyao' | 'institutional-preparation';
  source: string;                 // NRDL 2025 / NEML / provincial list; '' means unsourced
  // NO `definition`. NO `plain`. NO `interpretation`. NO `refLow`/`refHigh`.
}
```

**What is different from `ReferenceEntry`, and why:**

- **There is no `definition` field, and its absence is deliberate — omitted, not nullable.** `ReferenceEntry.definition` is safe because it is direction-neutral *and* the page prints its own range, so the verdict comes from the page and the definition cannot compose into a patient-specific claim (the B1 constraint, enforced by `b1VerdictLeakage.test.ts`). A drug definition has no page-side counterpart. Nothing on the page can corroborate or contradict it. Leaving the field nullable invites someone to fill it.
- **There is no `interpretation: 'ours' | 'report-only'` axis.** Every entry is name-only; there is no band to assert or withhold. And note the honest consequence, stated plainly: for labs, `report-only` was a *useful* honest default because the page still carried a range and the chip still worked. For a drug, "we assert nothing, only what the page prints" *is the entire feature* — which is exactly why the meaning layer had to go rather than be made optional.
- **The key is name-only, not name+form+strength.** The 一品两规 hazard (same generic, two legitimate strengths, wrong one attached) cannot occur because we never attach a strength. We quote 规格 from the page.
- **`highStakes` becomes vestigial — every row is high-stakes.** On a lab report a misread produces a wrong number with no behavioural consequence, so routing a subset to confirmation was proportionate. A dosing row produces an action. **The confirmation screen is the default for every row, not a routed subset.**

**通用名 / 商品名 aliasing.** 第十七条 requires the approved 通用名, with narrow exceptions (NCE patent names, compound-preparation names, provincially-approved in-house preparation names, and a ministry 习惯名称 list). Two caveats the verification surfaced and that must be carried: (a) **that 习惯名 list was apparently never actually published** — published pharmacist commentary complains about its absence and recommends hospitals define local lists instead, so it is an open, locally-populated set, not a bound; (b) 第十七条 binds *prescriptions*, and the artifact in hand is more often a **药袋 or box, where the brand name is present** (legally subordinated — cannot share a line with the generic, max half the per-character area — but present, and often more visually salient to a Mandarin-weak reader than the small-print generic).

So aliases must carry generic + 曾用名 + brands in both scripts. The existing `RAW_DRUGS` shape in `data/medical-lexicon.ts` already has exactly this (`generic` / `zh` / `pinyin` / `brandsEn`, 21 entries) — reuse it. 对乙酰氨基酚 / 扑热息痛 is the canonical 曾用名 case, and it is a *bounded* mechanism, not open synonymy: roughly one generic + zero-or-one former name + INN + brands per Western drug.

**Matching must be exact after normalization, with no substring and no fuzzy match** — the posture already documented on `SENSITIVE_ANALYTE_INDEX`. 氨氯地平 is a proper substring of 氨氯地平阿托伐他汀钙片.

### Table B — `DosageTerm`: the closed vocabulary, and the load-bearing table

```ts
interface DosageTerm {
  printed: string;                // THE KEY: the exact printed string. Never a Latin code.
  kind: 'route' | 'frequency' | 'timing' | 'dose-unit';
  name: LocalizedText;            // reviewed en/zh/bo
  definition: LocalizedText;      // qualitative, direction-neutral, no interval assertion
  standard: string;               // WS/T 364.12-2023 表2 | 表48 | 处方管理办法 第七条 | '' = empirical
  renderPolicy: 'render' | 'confirm-then-render' | 'refuse-show-crop';
}
```

**Key on the printed string, never on the national code.** Two hard reasons:
- The national route table **collapses 静脉注射 (IV push) and 静脉滴注 (IV drip) into one code, 404** — clinically different administrations, one code. A table keyed on the code cannot distinguish them; a table keyed on the printed string can.
- **Third-party code↔Chinese mappings are actively wrong in shipped documentation today.** Tencent Cloud's AI clinical-assistant API reference documents `FreqCode: "qid"` paired with `FreqName: "一日三次"` (qid is four times daily) and `UsageCode: "iv"` paired with `UsageName: "肌肉注射"` (iv is intravenous). Both medically incorrect, both live in vendor docs.

**The hole you must not import.** WS/T 364.12-2023 表48 CV06.00.228 (the frequency code table, **new in the 2023 revision**) contains 01 bid, 09 qd, 10 qid, 11 qod, 12 qw, 13 st, 04–08 q12h/q1h/q3h/q6h/q8h, 02 biw, 03 Hs, 99 其他 — and **tid is absent.** So is qn, prn, ac, pc, q4h, q2h, tiw. 一日三次 is the most common dosing frequency in Chinese practice and the single most-discussed one in patient-education material, and it has **no national code** — every hospital HIS improvises it. If you build the table by importing the national code set, it will have a silent hole precisely where traffic concentrates, and the "unrecognised" fallback will fire most often on the most common instruction. Curate 一日三次 empirically with its own provenance (第六条（四） expressly permits 中文/英文/拉丁文/缩写体 for 用法, banning only 遵医嘱/自用-class vagueness).

Also absent from every code table: **ranges and fractions** — 一次1~2片, 一次半片, 一日3~4次, 滴1~2滴. Real labels print these. A closed-set lookup misses them, and a range rendered into a second language invites the reader to take the top of it every time. Curate them as their own `kind`, and render a range as a range with both endpoints, never as a single number.

### 规格 vs 每次用量 — the atomic-pair rule

These are two separately-sourced printed strings. They render as **two separately labelled quotations, never multiplied, never juxtaposed in a way that reads as one number.**

> **If 规格 is not legibly read from the page, we do not render 用量 as a quantity at all.** The pair renders atomically or not at all.

The count is not the dose. Two documented cases:
- **Hangzhou, Jan 2026** (浙江省立同德医院, via 中新网/红星新闻): an AI gave dosing as 粒数 rather than 克; the patient's imported valaciclovir was 3x the strength of the common domestic product; he took 8 capsules, 3x the standard dose, and developed acute drug-induced kidney injury with creatinine 800 μmol/L against a normal ceiling of 110 and his own baseline of ~80. **This is the most on-point precedent that exists for this feature. The harm came from rendering a count without the strength.**
- **Beijing Daily field report:** an elderly cardiovascular patient's previous prescription was 25mg/片 at 一次一片; the new box was 50mg/片 and the correct instruction became 一次半片. He could not resolve it from the insert. 一次一片 is not self-interpreting without 规格.

The same atomicity applies to **route + frequency + quantity as one unit.** If we render 口服 confidently while refusing the frequency, the user reads a complete-looking instruction with the dangerous half silently missing. This is the exact structural class of the verified finding [[refusing-to-alias-does-not-bound-the-chip]] — a control believed to be in force that never bound the user-visible output. Any test for this must assert on the **rendered output**, not on the lookup.

---

## 5. HARM MODEL, AND WHAT GUARDS FOLLOW

The framing change from labs: **on a lab report a misread produces a wrong number the user can compare against the page. On a prescription, a misread 用量 produces an action.** The lab chip is arithmetic on two printed numbers with no behavioural consequence. A dosing row has one. OCR-only does not bound the damage here the way it does for labs.

| # | Failure mode | Guard |
|---|---|---|
| 1 | **Strength-vs-count parse → 10x or 1000x dose.** Reading 规格 as the dose, or 0.25g as 0.25mg. | Never compute; render 规格/用量 as separate labelled quotations; atomic-pair rule. **No arithmetic guard exists** — unlike R13's plausibility bounds, there is no printed range to bound a dose against and no per-drug plausible band without a meaning layer we have refused to build. Refusal-to-compute plus mandatory confirmation is the entire defence. State this to the owner plainly. |
| 2 | **Handwritten digit misread (1→7).** Kunming, promethazine, two lavages. | Refuse to render a handwritten numeric in the quantity field; show the image crop at large size instead. **New capability — v0 has no handwriting detector.** Real build cost; budget it. |
| 3 | **qd ↔ qid glyph confusion → 4x dose.** | `renderPolicy: 'refuse-show-crop'` for qd/qod/qid/q1d. **Note explicitly: the OCR-only invariant does NOT protect here.** The model is doing exactly the visual discrimination documented to fail, and *both* readings are valid table keys — so a wrong lookup succeeds and produces a confident, well-formed, wrong plain-language sentence. This is the single place where the invariant most conspicuously fails to bound harm. |
| 4 | **Drug-name one-character OCR slip → confident text about a real, different drug** (甲巯咪唑/甲硝唑; 优甲乐 vs 甲巯咪唑). | Exact-match-after-normalization, no substring, no fuzzy. Damage is bounded to a wrong *name rendering* only because there is no meaning layer — this is the payoff of §1's permanent no, and it evaporates the moment anyone adds a `definition` field. |
| 5 | **Diagnosis paired with a drug row.** | Physical layout separation (page-level block above the rows) **plus** a leakage test in the register of `b1VerdictLeakage.test.ts` that fails if diagnosis text can reach a row's rendered output. Layout alone is not a control. |
| 6 | **Partial render reads as complete** (route shown, frequency refused). | Atomic unit: route + frequency + quantity succeed or fail together. Test asserts on rendered output. |
| 7 | **We faithfully render an erroneous printed instruction.** ~4.42% of 12,235 audited outpatient e-prescriptions were unreasonable (143 不规范 / 398 用药不适宜), including chronic-disease drugs — amlodipine for hypertension, gliclazide for diabetes — written 必要时 when they require continuous dosing. | **No guard exists, and one cannot exist under the invariant.** Detecting the error would require clinical judgement we have refused. We would be adding our authority to a prescriber's error, in a language the reader cannot cross-check — a class labs never had, because a printed lab number is self-evidently just a number. Mitigation is register only: quote, never instruct. 「印的是：必要时服用」 not 「需要时才吃」. Plus a standing, always-visible "ask the pharmacist to confirm this" frame. Flag to the owner as an accepted residual risk, not a solved one. |
| 8 | **PII exposure at a new severity.** Name/age/dept/prescriber/chart number/diagnosis in plaintext; national ID and proxy ID on 麻/精一 pages. | Make the existing on-device redaction (`lib/redact.ts`) **mandatory** for this document class, not user-optional as it is today. No image retention, no crash-log capture of the image, no telemetry round-trip. |
| 9 | **Sensitive diagnosis disclosed on a shared phone.** | **No guard exists.** The `SENSITIVE_ANALYTE_NAMES` posture does not transfer — a diagnosis is free text, not an enumerable name, and the verified finding says name-based refusal doesn't bind the output anyway. Recommendation: diagnosis echo is **opt-in per report** (tap to reveal), not rendered by default. |
| 10 | **中药饮片 sheet parsed as a row table.** | Deterministic detect-and-decline on 剂-as-unit + per-herb parentheticals (先煎/后下/包煎/烊化/冲服/另煎). Refuse; do not degrade. |
| 11 | **顿服 inversion — the frequency trap that runs backwards.** 顿服 means the whole day's dose at once; Chinese readers routinely parse 顿 as "meal" (每顿饭), turning 1 dose/day into 3. Multiple hospital and state-media explainers exist specifically to correct it, which is itself evidence of prevalence. A Mandarin-weak or Tibetan reader is *more* exposed, because the misreading is character-level and the correct reading is idiomatic. | Curate 顿服 as a `DosageTerm` with an explicit gloss. This is one of the few places where the curated table adds real safety value rather than merely avoiding harm. Note that the hypothesised 一日三次/一次三片 transposition is **not** the documented Chinese harm — the documented ones are 顿服, 一日三次≠一日三餐, handwritten digits, and count-without-strength. Design against the documented shapes. |

---

## 6. WHAT WE MUST NEVER DO

In the register of the existing table comments. Each is an invariant with a reason and an enforcing test.

**Never compute a dose.** 附件1 prints 规格 and 用法用量 as separate columns and 第七条 counts oral solids in 片/丸/粒/袋. A 5mg tablet at 每次2片 never prints "10mg" anywhere on the page. Any mg-per-dose figure is a computation, not a read — it violates the invariant and it is the easiest path to shipping a 10x overdose display. *Test: no code path multiplies a parsed 规格 by a parsed 用量.*

**Never pair a drug row with the page-level 临床诊断.** The diagnosis is a header field for the whole page. With a 5-drug cap and multimorbid elderly patients, audits show one diagnosis written for several conditions, and placeholders like 待查 in the field. "This drug treats [printed diagnosis]" is an inference that will be wrong on exactly our population. *Test: diagnosis text cannot reach a row's rendered output.*

**Never assert what a drug is for, what it does, or what to watch for.** It is not on the page. There is no page-side counterpart to verify it against. The `definition` field is omitted from `MedicationEntry`, not left nullable, so that no one can quietly fill it.

**Never check interactions, duplications, or appropriateness.** An interaction claim is a classification about the combination — same class as the quarantined 410 feature, and the post-mortem already established that a lexical/structural guard does not bound medical truth.

**Never answer "is this right for me / is this dose right / should I take this".** That is the licensed act. The regulator has already drawn its line at AI touching prescription content: 互联网诊疗监管细则 第二十一条, 「严禁使用人工智能等自动生成处方」. That rule is about generation, not reading — but it sets the temperature, and any surface where our output sits adjacent to prescription content needs a printed-on-screen boundary between transcription and instruction.

**Never substitute for the pharmacist.** 第三十三条 puts the usage explanation on the pharmacist: write the bag or affix the label with 姓名/药品名称/用法/用量, and deliver a spoken 用药交待 covering 用法、用量、注意事项. The counselling step is legally required and spoken. We transcribe what was written down. We do not replace what was said.

**Never expand a Latin frequency code we cannot visually disambiguate.** See §5.3.

**Never render an instruction in the imperative.** Quote it, attributed to the page. 「印的是：每次1片」, never 「每次吃1片」. This is the register that keeps us out of the instruction business and it is the only mitigation available for failure mode 7.

**Never prompt the user to re-photograph a blank 临床诊断 field.** It is lawfully omissible under 除特殊情况外 and it is frequently a placeholder. A UI that says "diagnosis not detected, please re-photograph" pushes users to surface information that may have been deliberately withheld. State the field is blank; move on.

**Never claim this feature improves medication safety.** The one study that measured both — 中国药房 2025;36(12) — moved adherence 7.0%→31.0% and moved ADR incidence not at all (3.6% vs 3.1%, n.s.). The defensible claim is comprehension and adherence. Claiming safety would be an unverified assertion about our own product: the same class of error the feature exists to avoid.

---

## 7. SIZE

### Table B (`DosageTerm`) — small, bounded, and it is the one that matters

| Component | Count | Source |
|---|---:|---|
| Route values | 26 | WS/T 364.12-2023 表2 CV06.00.102 (8 top-level + 5 injection + 12 local + 699) |
| National frequency codes | 14 | WS/T 364.12-2023 表48 CV06.00.228 |
| Frequency terms absent from the national table | ~15 | empirical: tid, 一日三次, qn, prn, ac, pc, q4h, tiw, ranges, halves |
| Timing qualifiers | ~10 | 饭前/饭后/睡前/空腹/顿服/温服/凉服… |
| Dose units | ~12 | 处方管理办法 第七条 (片/丸/粒/袋/支/瓶/盒/剂 + g/mg/μg/ng/L/ml/IU/U) — plus 滴 and 喷, which are *not* in the regulated list but appear on real labels |
| **Total** | **~80–120 terms** | |

Roughly two-thirds the alias-curation effort of the existing 174-analyte table, and materially easier: the terms are short, national-standard-backed for about half, and the definitions are qualitative. **Both WS/T tables are 推荐性 (recommended industry standards), not mandatory — vendors are free to print other strings.** So the empirical tail matters and must come from the field photographs.

### Table A (`MedicationEntry`) — the research does not support a Lhasa estimate

What it *does* support, for Western drugs:

- Sichuan stratified random survey, 370 primary facilities (2018): **mean 227.94 varieties stocked** per facility; **Tibetan/Yi autonomous-prefecture township hospitals only 131.96** (vs 263.97 elsewhere, P<0.0001) — the closest published analogue to Lhasa primary care.
- Tianjin: a **537-item** municipal community formulary (325 西药 + 212 中成药) accounted for **99.13%** of drug-use instances across 7,240 prescriptions; generic-name usage 100%.
- Tertiary ceiling 1,500 品规 ÷ ~2.2 (一品两规 divisor) ≈ **600–900 generic names**.

Working figures: **~250–350 names** for a primary-care-heavy corpus; **~600–800** for a Lhasa tertiary outpatient clinic. NRDL 2025's 3,253 (1,446 西药 + 1,335 中成药 incl. 95 民族药 + 472 谈判) is the safe superset for any Chinese outpatient setting.

**Three caveats that make these numbers softer than they look:**

1. **No published cumulative-coverage curve exists.** Chinese prescription-analysis literature reports DDD rankings within a therapeutic class, never whole-formulary concentration. Any "top N covers X%" figure is derived from formulary size, not measured. **I will not state a coverage percentage for this feature**, and neither should the owner in any funder-facing material.
2. **Tibet's supplementary lists are not in the count and are not curable from national sources.** 103 民族药 + 287 藏药饮片 + **1,399 医疗机构制剂**. Their 藏药 share of a real Lhasa outpatient prescription is unknown and plausibly much higher than Beijing's 25% 中成药 figure. Under transcription-only these are *transcribable* (§1) — but they are not *nameable* in our table, so they hit the fallback path, and the fallback path must be audited live before shipping.
3. **The NEML baseline shifts in five weeks.** The 2018 edition (417 + 268 = 685) is in force only until 2026-08-31; the 2026 edition (国卫药政发〔2026〕17号, 476 + 318 = **794**) takes effect 2026-09-01. Make the edition a dated, swappable field, not a hardcoded constant. Separately: **NEML is the wrong v1 scope** — measured NEML share of actually-prescribed varieties was 53.10% (Tianjin) and 59% (2019 national primary-care sample), against 90/80/60 policy targets. Shipping the 685 (or 794) would leave roughly half of a real prescription unnamed.

### What must be measured before committing

One week, 200–300 photographs, Lhasa:

1. Document type held (处方 / 药袋 / 出院带药 pink copy / 费用清单 / phone screenshot) — decides the OCR target.
2. **Whether the bag label prints 规格** — decides whether the atomic-pair rule leaves anything to render on the most common artifact. Potentially feature-killing.
3. Distinct drug names + frequency → the real coverage curve for Table A.
4. Verbatim 用法用量 strings → the real coverage curve for Table B, and the size of the tail.
5. 西药 / 中成药 / 藏药 / 院内制剂 mix.
6. Printed vs handwritten for the quantity field → sizes the handwriting-detector build.

No amount of further desk research substitutes. Six of the researcher's own "could not establish" items resolve in that single afternoon.

### Curation cost shape

PDF extraction plus human review — the same cost structure as the 174 analytes, but with two differences: the dosage table is *smaller* and mostly transcription, while the name table is 2–5x the row count and, for the 藏药 fraction, has no source document to extract from at all. NRDL and NEML are PDFs; NHSA's 医保药品分类与代码 database publishes updates as PDFs and gates maintenance behind login; NMPA's 数据查询 is a per-record JS app with no bulk export. **No clean structured feed exists.** Whether a live bulk download of the 国家药品编码本位码 dataset still exists is unresolved — worth 20 minutes with a browser before assuming either way.

---

## 8. OPEN QUESTIONS — OWNER DECISION REQUIRED

**Q1. Do we fund the one-week Lhasa measurement before any engineering?**
*Recommend: yes, and gate all engineering on it.* Three architecture-deciding unknowns, six of the researcher's own gaps, one potentially feature-killing fact (Q6), all answerable in an afternoon of photographs. Building the schema from desk research risks a feature whose input document does not exist.

**Q2. Is "explain the medication" a permanent non-goal, or a deferred v2?**
*Recommend: permanent.* Write it into the codebase as an invariant with the reason, not into a roadmap. §1 blockers 1–3 are structural, not maturity-limited; blocker 4 says the market already covers it. A "v2" label will pull the `definition` field back within two quarters.

**Q3. Is 临床诊断 echoed by default, or tap-to-reveal?**
*Recommend: tap-to-reveal.* No guard exists for shared-phone disclosure of a free-text diagnosis, the analyte-name suppression posture doesn't transfer, and the verified finding says name-based refusal doesn't bind rendered output anyway. Default-off costs one tap and removes an unguarded harm class.

**Q4. Refuse Latin frequency codes outright, or confirm-then-render?**
*Recommend: refuse-and-show-crop for qd / qod / qid / q1d specifically; confirm-then-render for the rest (bid, tid, po, prn, q8h…).* The four named codes are the documented 4x-overdose glyph family. Blanket refusal of all Latin would be over-broad — 第六条（四） makes Latin lawful and it will be common.

**Q5. Handwritten quantity: refuse, or confirm-then-render?**
*Recommend: refuse and show the crop at large size.* The Kunming case is exactly this artifact class, and a confirmation screen asking a Mandarin-weak elderly reader to verify a handwritten Chinese digit is not a control — it is the failure restated as a UI.

**Q6. If the field study shows bag labels do not print 规格 — what then?**
*Recommend: pre-commit the answer now, before the data arrives, so the result cannot be rationalised.* Proposed commitment: render 用量 as a quoted printed string with an explicit "your sheet does not print the strength — ask the pharmacist" line, and never as a quantity to act on. **Owner should decide in advance whether that degraded version is still worth shipping**, because if the answer is no, the field study is a go/no-go and not a design input.

**Q7. Tibetan drug-name renderings: commission them, or refuse and show the printed Chinese?**
*Recommend: refuse and show the printed Chinese at large size for v1*, with an explicit "this name is not available in Tibetan" line. Names are the highest-consequence strings to get wrong and the two-person rule is expensive. Harvestable prior art exists for the *vocabulary* (NSW Health's Tibetan "Safe Use of Medicines" sheet, freely published; the 中国药房 2025 platform's 400+ drug guidance, Tibetan-physician-reviewed) but neither is a name list and both need review before use.

**Q8. Do we obtain a regulatory read before any Lhasa deployment?**
*Recommend: yes, before code.* Every serious incumbent obtained an official data relationship (阿福 with the NMPA information centre — though note that partnership is **vendor-asserted and unconfirmed on the regulator's side**; Baidu framed against the NMPA reform). A foreign-built app rendering Chinese prescription instructions into a minority language, with no MAH, no regulator relationship, and no pharmacist of record, is in a materially worse position than the lab feature, and minority-language content review in TAR is a separate axis with nothing to do with medicine. Also unresolved: **no TAR provincial 处方格式 implementation rules were located.** Since 第五条 sets format provincially, that document exists and we do not have it — worth a direct request to the TAR 卫健委 rather than another web search.

**Q9. What outcome do we commit to measuring?**
*Recommend: comprehension and adherence only; explicitly disclaim safety.* Pre-register it before the first funder conversation. The one study that measured both found adherence up 4x and ADRs unchanged. Drift toward "this makes medication safer" is the same class of unverified self-assertion that the invariant exists to prevent.

**Q10. Does the "drug rows render at all if the name is unrecognised" fallback get audited live before shipping?**
*Recommend: yes, mandatory, and treat it as a release gate.* This is the direct lesson of [[refusing-to-alias-does-not-bound-the-chip]]: the 1,399 藏药制剂 guarantee a high unrecognised-row rate, and the last time we assumed a refusal bound the output, it did not. Run real unrecognised names through the shipped pipeline and read what the user actually sees — do not reason about it from the lookup code.
---

## 9. Provenance and a known gap in this document

Researched and written 2026-07-29 by a five-angle parallel sweep with independent verification of
every fact marked `established`. Motivated by a field interview the same week in which a patient
described the care journey and named 处方翻译和用药解释 as an unmet need.

**One research angle failed and this document is incomplete because of it.** The
`harm-and-regulation` agent died on a mid-response connection error. Two questions it was asked were
therefore never answered from primary sources, and the regulatory material that survives here is
incidental pickup from the other four angles rather than a deliberate review:

1. **Is patient medication counselling (用药指导) a licensed act reserved to 执业药师 under
   《药品管理法》 and 《执业药师职业资格制度规定》?** Unanswered. If it is, that is a blocker of the same
   class as the four in §1 and it would change the verdict from "not yet" to something harder.
2. **Does an app that renders what a drug label says constitute device software or the practice of
   pharmacy in the US diaspora market?** Unanswered. The lab feature's non-device posture was reasoned
   from the FDA Clinical Decision Support guidance and the Cures Act exclusions; nobody has checked
   whether that reasoning transfers to medication content, and it should not be assumed to.

Also never obtained: any evidence on whether *translated* medication instructions measurably improve
comprehension. That was asked for deliberately, because a null result would argue against building
this at all. Its absence is not evidence of a positive.

Q8 already recommends a regulatory read before code. These two gaps are the specific content of it.
