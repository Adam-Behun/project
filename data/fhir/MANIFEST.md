# Persona bundles

These are unmodified Synthea FHIR R4 bundles. Nothing in them is hand-written,
and nothing was edited after generation. The record counts the app shows are
the counts of resources in these files, read at runtime by `src/fhir/parse.ts`.

## How they were generated

```
java -jar synthea-with-dependencies.jar \
  -p 400 -s 20270101 -a 25-64 \
  --exporter.fhir.export true \
  --exporter.hospital.fhir.export false \
  --exporter.practitioner.fhir.export false \
  --exporter.years_of_history 5 \
  Texas Houston
```

Reproduce with `npm run personas -- --jar /path/to/synthea-with-dependencies.jar`.
The seed is fixed, so the same population and the same patients come out again.

## Why these four

Synthea produces random patients, so you cannot ask it for a particular
clinical story. `scripts/generate-personas.ts` generates a population of
400 adults aged 25-64 in Houston, classifies each patient by the
condition categories in `src/fhir/codes.ts`, and keeps the best match for each
profile the demo needs. 402 living patients were classified.

| File | Patient | Resources | Size | Candidates matched |
|---|---|---|---|---|
| `healthy.json` | Mitchell Keebler, 27 male | 120 | 445 KB | 10 |
| `pregnancy.json` | Julissa Howe, 29 female | 381 | 1550 KB | 1 |
| `transplant.json` | Erica Homenick, 57 female | 924 | 2968 KB | 2 |
| `cancer.json` | Gennie Corkery, 51 female | 573 | 1726 KB | 2 |

## Substitutions against the prototype personas

- **`healthy.json`** (Healthy adult, little recent care) stands in for the prototype's *Marco, 27, healthy, no visits in the past 12 months*.
  Synthea gave us Mitchell Keebler, 27 male, Houston, TX 77027.
  Active condition categories: other, social.
- **`pregnancy.json`** (Expecting a baby) stands in for the prototype's *Elvira, 34, expecting a baby in late January*.
  Synthea gave us Julissa Howe, 29 female, Houston, TX 77089.
  Active condition categories: other, pregnancy, social.
- **`transplant.json`** (Kidney transplant and type 2 diabetes on insulin) stands in for the prototype's *Bernarda, 60, kidney transplant and type 2 diabetes on insulin*.
  Synthea gave us Erica Homenick, 57 female, Houston, TX 77094.
  Active condition categories: acute_minor, anemia, chronic_pain, diabetes, heart_disease, hyperlipidemia, hypertension, kidney_disease, obesity, prediabetes, social, transplant.
- **`cancer.json`** (Cancer, now in follow-up care) stands in for the prototype's *Freda, 40, breast cancer, now in follow-up care*.
  Synthea gave us Gennie Corkery, 51 female, Houston, TX 77041.
  Active condition categories: acute_minor, anemia, cancer, obesity, other, prediabetes, reproductive, social.

## Checksums

- `healthy.json`  `sha256:0de143b26a5655237d1d55036cbfe062d4318f1fa89a725ba8809ccc56323994`
- `pregnancy.json`  `sha256:94e487adf83a925c9f095f1c4b3b4b9430249c7e6ea097056954cf93ce7544f9`
- `transplant.json`  `sha256:389ce9779e28ea7ba9fea23c1d6006768eb077c5680cdf002fef881d1d606168`
- `cancer.json`  `sha256:1786c61b2a72bc13e3d735fb8078bd682d43fbebf90b555f7f6ad69a67a2a82b`
