# Phase 0 — on-device latency spike

**One day. Hard kill gate for the entire on-device direction.**
Uses none of this project's code. It is a question about hardware, not about us.

---

## What this decides

Whether a small vision model can read a lab-report photo on a phone people in Lhasa actually own,
fast enough that a person would wait for it.

If the answer is minutes, the generative on-device path is dead and we go deterministic-only
(mobile OCR + our own geometric binding, which is already built and tested). Either result is
useful. **The point is to find out cheaply, before anyone builds a roadmap on a guess.**

The guess currently in the plan is 60–150s per page on mid-range hardware, extrapolated from
flagship figures. Nobody has published a VLM latency figure for **any** Snapdragon 6/7 or Dimensity
7000/8000 chip. That absence is the whole reason this exists.

---

## Pre-commit the threshold BEFORE you measure

Write the number down first, so the result cannot be rationalised afterwards. Proposed, adjust if you
disagree — but decide now, not after seeing the data:

| Median time per page, mid-range handset | Verdict |
|---|---|
| under 10s | Viable. Proceed to phase 5. |
| 10–30s | Viable only with a "leave it working" flow, not an interactive one. Re-scope before continuing. |
| 30–60s | Effectively dead for our users. Deterministic-only. |
| over 60s | Dead. Stop. |

Judge on the **third consecutive run**, not the first. Phones throttle when warm, and a real user
photographs several pages in a row.

---

## 1. Hardware — three phones

The critical requirement: **not flagships.** A Snapdragon 8-series result tells us nothing about the
device an elderly patient's grandson is holding.

- **Two mid-range Android**: Snapdragon 6-series or 7-series, or Dimensity 7000/8000-series. Redmi,
  Realme, Honor and vivo mid-tiers are the realistic shapes. 8GB RAM if possible; note the RAM,
  because memory is the second binding constraint after speed.
- **One iPhone**, any recent model. Worth including because iOS has native Tibetan rendering and one
  (weakly sourced) report claims a large share of TAR users are on iPhone. If that is true, iOS
  performance matters more than Android for our actual users, and this is the cheapest way to start
  checking.

Borrowed phones are fine. Record the exact model and chipset for each.

---

## 2. Software

You need an app that runs a **vision** model (not text-only) locally from a GGUF file. That is the
narrower requirement — many on-device LLM apps handle text only and will not load a vision model.

Look for an app that explicitly supports multimodal / mmproj / image input. Names change and I would
not trust my list to be current; search the store for on-device LLM runners and check the multimodal
claim before downloading a model.

**If no app on the phone supports vision models**, that is itself a finding worth recording — it
means on-device vision is not merely slow but impractical to ship today, which is a stronger result
than a latency number.

---

## 3. Model

A small OCR-specialist, quantized, in GGUF:

- First choice **PaddleOCR-VL** (~0.96B) — smallest, strongest published Chinese table performance,
  and the only candidate evaluated on real physical distortion.
- Fallback **Qwen3.5-2B** or any 2B-class vision model, if the first will not load.

Take **Q4_0 or Q4_K_M**. Quantization below Q8 buys no speed (measured within 10% of each other), so
if you have the option and the storage, prefer the higher quality.

**Practical warning:** the model is likely 1–3 GB. Download it over wifi before you travel, not in
the field. Check free storage first.

---

## 4. Test image

**One real lab-report page**, photographed as a user actually would — handheld, ordinary indoor
light, slight tilt, page not perfectly flat. Do not use a flat clean scan; that is not the input.

Prepare the same photo at three sizes: **max edge 640px, 1024px, 1600px**. 1600 is what our app
sends today. 640 is what current on-device benchmarks use — and is almost certainly too coarse to
read 8pt Chinese analyte names, which is itself part of what we are testing.

---

## 5. Protocol

For each phone × each resolution:

1. Start with the phone cool and plugged out.
2. Load the image, prompt: `Read every row of this table. Output name, value, unit and reference range for each row.`
3. **Run three times in a row without pausing.**
4. Record for each run:
   - **time to first output** (seconds)
   - **total time until it stops** (seconds)
   - **did it finish, or did it crash / run out of memory / get killed?**
   - **is the phone hot?**
5. Note whether the output looks like it read the actual numbers, or is fluent nonsense. This is not
   an accuracy measurement, but a model that produces confident invented rows at any speed has
   already failed.

18 runs total. Two to three hours including setup.

---

## 6. Recording

| phone | chipset | RAM | resolution | run | first output (s) | total (s) | finished? | hot? |
|---|---|---|---|---|---|---|---|---|
| | | | 640 | 1 | | | | |
| | | | 640 | 2 | | | | |
| | | | 640 | 3 | | | | |
| | | | 1024 | 1 | | | | |
| … | | | | | | | | |

Send the table back and I will fold it into the plan. If a phone cannot run it at all — will not
load, out of memory, app crashes — that row is a result, not a failed attempt. Write down what
happened.

---

## 7. What could make this measurement wrong

- **Testing only on a flagship.** The most likely way to get a misleadingly good number.
- **Measuring only the first run.** Thermal throttling means run three is the honest one.
- **Using a clean scan.** Real input is a handheld photo of a page that is not flat.
- **Only measuring 640px.** Fast at a resolution that cannot read the digits is not a useful result.
- **Not recording failures.** "It didn't work" is data, and it is the data most likely to be lost.
