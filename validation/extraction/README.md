# MedRepBench extraction benchmark (ready-to-run)

Scores Claude-vision field-level recall (name/value/unit/reference-range/abnormality-flag)
on real de-identified Chinese lab report images — separating OCR error from the
deterministic grounding error. **No images are committed** (MedRepBench is CC BY-NC 4.0:
research/paper use only; keep it out of the product corpus).

## Run
1. Download MedRepBench (arXiv 2508.16674) from HuggingFace.
2. Write one `{id}.json` per image (`{ id, imagePath, gold: [{name,value,unit,referenceRange,abnormalFlag}] }`)
   into a local dir; set `MEDREPBENCH_DIR` to it.
3. `ANTHROPIC_API_KEY=... MEDREPBENCH_DIR=... npx tsx -e "import {loadMedRepBench,runExtractionBenchmark} from './validation/extraction/medrepbench'; import {claudeExtractor} from './validation/extraction/extractor'; runExtractionBenchmark(loadMedRepBench(), claudeExtractor()).then(r=>console.log(r))"`

Best open VLMs score ~77–79% overall field recall on MedRepBench — a proxy for how
much the confirm-the-values gate must catch. The fixture (`fixture/samples.ts`) lets
the scorer + runner run green with no dataset and no key.
