// MedRepBench-style extraction sample (validation-rigor cycle). Five fields,
// matching MedRepBench's schema/metric (arXiv 2508.16674): item name, measured
// value, unit, reference range, abnormality flag. Images are never committed.
export interface ExtractedField {
  name: string;
  value: string;
  unit: string;
  referenceRange: string;
  abnormalFlag: string; // '', 'H', 'L', or dataset-specific
}

export interface ExtractionSample {
  id: string;
  imagePath: string; // absolute/relative path into MEDREPBENCH_DIR; not committed
  gold: ExtractedField[];
}
