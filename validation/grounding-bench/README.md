# MIMIC-IV grounding validator (interface + stub; execution deferred)

Validates the deterministic low/normal/high classification + unit handling against
real reference ranges and abnormal flags, with NO image dependence — cleanly
separating grounding error from OCR error.

**Blocked on external access:** PhysioNet Credentialed Health Data License + CITI
training + a signed DUA (weeks of lead time). Start that now; it is the long pole.
When credentialed: export `hosp/labevents` + `hosp/d_labitems`, map rows to
`LabObservation` (see `mimicAdapter.ts`), set `MIMIC_DIR`, and run `groundingRecall`.
The scorer + synthetic fixture run green today.
