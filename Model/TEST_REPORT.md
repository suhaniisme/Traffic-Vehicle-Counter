# Test Report

Date: 2026-10-27. Environment: Windows 11, headless Chrome (WebGL via SwiftShader, CPU only).
Reproduce with `powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1`.

## Unit tests

**36 / 36 passing** ([tests/unit.js](tests/unit.js)). They cover IoU, COCO-SSD and DETR output
conversion, vehicle filtering, cross-class duplicate merging, tile-fragment removal, group-box
removal (including a real Jakarta bus that an earlier rule wrongly dropped), perspective-aware
truck classification, summaries and tiling geometry.

## End-to-end: 18 sample images

Ground truth is hand-counted ([tests/expected.json](tests/expected.json)). Five dense scenes are
marked as only accurate to about ±15%. *Count accuracy* = 1 − Σ|detected − expected| / Σ expected,
over total vehicles.

### Configurations compared

| Detector | Tiles | Threshold | Count accuracy | Total MAE | HMV MAE | Moto MAE | s / image |
|---|---|---|---|---|---|---|---|
| **DETR ResNet-50 (default)** | off | 0.40 | **76.2%** | **5.11** | **0.72** | 1.11 | 6.3 |
| DETR ResNet-50 | off | 0.30 | 76.2% | 5.11 | 0.67 | 1.17 | 6.3 |
| DETR ResNet-50 | off | 0.60 | 74.6% | 5.44 | 0.89 | 0.94 | 6.2 |
| DETR ResNet-50 | on | 0.40 | 53.6% | 9.94 | 2.00 | 1.78 | 34.4 |
| COCO-SSD MobileNet v2 | on | 0.40 | 45.6% | 11.67 | 1.94 | 2.17 | 6.9 |
| COCO-SSD MobileNet v2 | off | 0.40 | 18.9% | 17.39 | 2.67 | 2.50 | 1.4 |

Raw per-image results for each configuration are in `tests/output/<tag>__results.json`.

### Default configuration, per image (expected / detected)

| Image | Total | Cars | LMV | HMV | Moto |
|---|---|---|---|---|---|
| highway-jam-malaysia | 32 / 28 | 28 / 28 | 30 / 28 | 1 / 0 | 1 / 0 |
| highway-jam-m62 | 38 / 35 | 20 / 18 | 22 / 20 | 16 / 15 | 0 / 0 |
| highway-jam-d1 | 16 / 20 | 9 / 15 | 10 / 15 | 6 / 5 | 0 / 0 |
| city-bangalore | 20 / 21 | 6 / 10 | 11 / 10 | 2 / 4 | 7 / 7 |
| city-delhi-motion (night, blur) | 7 / 8 | 5 / 8 | 6 / 8 | 0 / 0 | 1 / 0 |
| motorcycles-hyderabad | 17 / 13 | 3 / 2 | 7 / 2 | 0 / 0 | 10 / 11 |
| mixed-pune | 11 / 16 | 3 / 10 | 4 / 10 | 4 / 3 | 3 / 3 |
| bus-firetruck-jakarta | 18 / 21 | 5 / 4 | 7 / 6 | 2 / 2 | 9 / 13 |
| city-bangkok (dense) | 53 / 34 | 48 / 32 | 50 / 32 | 2 / 1 | 1 / 1 |
| city-traffic (no vehicles) | 0 / 1 | 0 / 1 | 0 / 1 | 0 / 0 | 0 / 0 |
| jam-delhi (dense) | 70 / 44 | 43 / 37 | 55 / 39 | 5 / 3 | 10 / 2 |
| congestion-mathura-rd | 17 / 18 | 11 / 14 | 11 / 14 | 5 / 4 | 1 / 0 |
| trucks-freight-highway | 7 / 9 | 0 / 2 | 0 / 2 | 5 / 5 | 2 / 2 |
| trucks-rajasthan | 8 / 10 | 2 / 3 | 2 / 3 | 5 / 6 | 1 / 1 |
| trucks-russia | 6 / 6 | 2 / 2 | 2 / 2 | 4 / 4 | 0 / 0 |
| fog-delhi (heavy fog) | 37 / 23 | 27 / 23 | 32 / 23 | 2 / 0 | 3 / 0 |
| urban-india | 15 / 16 | 13 / 14 | 13 / 15 | 1 / 1 | 1 / 0 |
| bus-us1-belair | 14 / 15 | 14 / 15 | 14 / 15 | 0 / 0 | 0 / 0 |
| **Sum** | **386 / 338** | **239 / 238** | **276 / 245** | **60 / 53** | **50 / 40** |

Annotated outputs are in `tests/output/final__*.png`.

## What the testing changed

| Finding | Evidence | Fix |
|---|---|---|
| Every image returned 0 vehicles | First end-to-end run | COCO-SSD names the field `class`, not `label`. Added `fromModel()` with a test |
| Dense scenes lost most vehicles | M62 annotated image: one "car" box around the whole jam | Added `removeGroupBoxes()`. A box only removes tile fragments that are at least 25% of its size |
| A distant bus was labelled LMV | D1: a 53×69 px "truck" was compared with a near-camera car | Trucks are compared only with cars at a similar depth (bottom edge) |
| COCO-SSD misses trucks and trailers | D1 HMV 0/6, M62 HMV 1/16 | Switched the default to DETR ResNet-50 (Transformers.js). Accuracy went from 46.5% to 76.2% |
| A real bus was removed as a "group box" | Jakarta: three overlapping cars had their centres inside the bus box | The group-box rule now needs members ≥90% inside it. Also applied to motorcycle clusters |
| Tiling hurts DETR | 53.6% vs 76.2%: crops with no context turn blur into "cars" | Tiles off by default and kept as an option. They still help COCO-SSD |
| Page became unresponsive in a real browser | New responsiveness probe: the main thread stalled 3,979 ms per image with DETR and 1,232 ms with COCO-SSD | Both models moved into Web Workers. Worst stall is now 80 ms (DETR) and 215 ms (SSD), against a 500 ms limit. Accuracy is unchanged |
| Bel Air ground truth was too low | DETR found real parked cars the hand count missed | Expected count corrected from 9 to 14 |

## UI checks

- Desktop light mode, 1400 px, all 18 samples analysed: `tests/output/ui-results-light.png`
- Dark mode, empty state: `tests/output/ui-empty.png`
- Phone width (390 px), dark mode: `tests/output/ui-mobile-dark.png`. No horizontal page scroll (`scrollWidth` = `clientWidth` = 390)

## Known weaknesses (seen in the data)

- **Very dense or foggy scenes are undercounted** (Bangkok −36%, Delhi jam −37%, fog −38%). DETR returns at most 100 objects, and far vehicles are only a few pixels tall.
- **Auto-rickshaws are not a COCO class.** In Hyderabad 5 visible autos were missed (LMV 7 / 2).
- **Articulated or multi-part vehicles are sometimes split into two boxes** (the Pune cement mixer counts as 2 HMV, Jakarta's fire truck as HMV + LMV).
- **Motorcycles in clusters are over-counted** (Jakarta 13 vs 9). Motorcycles hidden behind riders in dense Indian traffic are under-counted (Delhi jam 2 vs 10).
- **One false positive on a long-exposure night shot** that has no vehicles, only light trails.
