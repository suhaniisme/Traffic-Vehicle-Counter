# Prompt: presentation on the Traffic Counter project

Create a slide presentation for a final-year college project in **Image and Video Processing (IVP)**.
The audience is a faculty evaluator and classmates. They know the basics of image processing and
machine learning, but they haven't seen this project. The presenter will talk for about
**10–12 minutes** and then give a live demo.

Use only the facts below. Do not invent numbers, features, datasets or results. If a slide needs
something that isn't here, leave a clearly marked placeholder such as `[ADD: team names]`.

---

## Deliverable

- **12–15 slides**, 16:9, with speaker notes on every slide (3–5 sentences each, written to be spoken aloud).
- **Clean, flat design:** solid colours, plenty of white space, one idea per slide. No translucent overlays, glows, gradients-behind-text or semi-transparent highlight boxes.
- **Consistent class colours** wherever LMV, HMV and Motorcycle appear:
  - LMV `#1d4ed8` (blue)
  - HMV `#c2410c` (orange)
  - Motorcycle `#15803d` (green)
- Prefer diagrams, tables and charts over bullet lists. No slide should have more than about 30 words of on-slide text.
- Where a slide calls for a project image, use the attached file named in brackets, for example `[final__trucks-russia.png]`. If it isn't attached, leave a labelled placeholder box.

---

## Project facts

### Title and one-line summary
**Traffic Counter:** a browser app that takes traffic photos, counts the vehicles and cars in them,
and classifies every vehicle as **LMV** (light motor vehicle), **HMV** (heavy motor vehicle) or
**Motorcycle**, using only pretrained models. Nothing is trained.

### Problem and motivation
- Manual traffic counting is slow and error-prone. Traffic surveys, signal planning and toll and road-capacity studies need counts broken down by vehicle class.
- LMV and HMV are the vehicle categories used in Indian motor-vehicle regulation, so a class-wise count is more useful than a single total.
- Constraint set for the project: **no model training**. Use readily available pretrained models and libraries.

### What the app does
- Upload one or many traffic images by drag-and-drop or file picker, or load 18 built-in samples.
- For each image it draws coloured bounding boxes, labelled by class, and shows five counts: total vehicles, cars, LMV, HMV and motorcycles.
- A per-detection table lists each vehicle's class, the model's original label, its confidence, and a note (for example "small truck (pickup/van)").
- A batch table covers all images, with totals and **CSV export**.
- Settings: choice of detector, confidence threshold, and an optional "tiled pass" for distant vehicles.
- Runs entirely in the browser. Images never leave the computer. It works on desktop and phone widths, in light and dark mode.

### Technology
- Plain HTML, CSS and JavaScript. No build step, no backend. A small PowerShell static server (`serve.ps1`) is included.
- **Default detector: DETR ResNet-50** (Facebook's DEtection TRansformer), run through **Transformers.js 3.0.2** on ONNX Runtime WebAssembly, using the 8-bit quantised model `Xenova/detr-resnet-50` (~40 MB, cached after the first load).
- **Alternative detector: COCO-SSD MobileNet v2** (TensorFlow.js 4.22). Faster, much less accurate.
- Both are pretrained on the **COCO** dataset, which already includes `car`, `truck`, `bus` and `motorcycle`.
- Both models run in **Web Workers**, so the page stays responsive during inference.

### Processing pipeline (good candidate for a flow diagram)
1. Draw the image to a canvas at its natural resolution.
2. Run the detector to get boxes with a COCO label and a confidence score.
3. Keep only `car`, `truck`, `bus` and `motorcycle` above the confidence threshold (default 0.40).
4. **Remove "group boxes":** a box that fully encloses (≥90% overlap) 3 or more smaller cars/trucks/buses, or 2 or more motorcycles, is a box drawn around a cluster, not a vehicle.
5. **Merge duplicates** with cross-class non-maximum suppression (IoU > 0.5). The same vehicle seen as both "car" and "truck" counts once.
6. **Classify** into LMV, HMV or Motorcycle (rules below).
7. Count, draw the annotated image, and update the tables.

### Classification rules (good candidate for a table slide)
| COCO label | Class | Rule |
|---|---|---|
| car | LMV | Also counted as a "car" |
| bus | HMV | |
| truck | HMV, or LMV | COCO's "truck" includes pickups and vans. A truck smaller than 1.8× the median area of cars **at the same distance** is a pickup or van, so LMV |
| motorcycle | Motorcycle | Includes scooters |
| anything else | not counted | People, bicycles, traffic lights and so on |

"At the same distance" is approximated by a box's bottom edge, since vehicles further away sit
higher in the image and look smaller. This **perspective-aware rule** was added after testing showed
a distant bus being compared with a car right next to the camera and wrongly labelled LMV.

### Test data and method
- **18 real traffic photographs** from Wikimedia Commons, freely licensed, with credits recorded. They cover highway jams (Malaysia, UK M62, Czech D1), Indian city traffic (Bangalore, Delhi, Hyderabad, Pune), Jakarta, Bangkok, truck-heavy highways (India, Russia), heavy fog, a blurred night scene, and one long-exposure night photo with **no vehicles** (a false-positive check).
- Every image was **hand-counted** per class to create the ground truth. Five very dense scenes are marked as only accurate to about ±15%.
- **36 automated unit tests** cover the geometry, merging and classification logic. All 36 pass.
- An automated end-to-end test runs the full pipeline on all 18 images in headless Chrome and compares detected counts with the hand counts.
- **Metric:** count accuracy = 1 − Σ|detected − expected| / Σ expected (over total vehicles), plus mean absolute error (MAE) per class.

### Results: comparison of configurations (good candidate for a bar chart)
| Detector | Tiled pass | Count accuracy | Total MAE | HMV MAE | Seconds / image |
|---|---|---|---|---|---|
| **DETR ResNet-50 (chosen)** | off | **76.2%** | **5.11** | **0.72** | ~5 |
| DETR ResNet-50 | on | 53.6% | 9.94 | 2.00 | ~34 |
| COCO-SSD MobileNet v2 | on | 45.6% | 11.67 | 1.94 | ~7 |
| COCO-SSD MobileNet v2 | off | 18.9% | 17.39 | 2.67 | ~1.4 |

Confidence-threshold sweep for DETR: 0.30 → 76.2%, 0.40 → 76.2%, 0.60 → 74.6%. The default is 0.40.

### Results: chosen configuration, totals across 18 images (expected vs detected)
| | Total | Cars | LMV | HMV | Motorcycle |
|---|---|---|---|---|---|
| Expected | 386 | 239 | 276 | 60 | 50 |
| Detected | 338 | 238 | 245 | 53 | 40 |

### Results: highlights per image (expected / detected total)
- **Strong:** Russia trucks 6/6 (HMV 4/4), Mathura Road Delhi 17/18, urban India 15/16, Bangalore 20/21 (motorcycles 7/7), UK M62 jam 38/35 (HMV 16/15).
- **Weak:** Bangkok dense traffic 53/34, Delhi jam 70/44, heavy fog 37/23.
- **False positives:** 1 on the no-vehicle night photo.

### What testing found and fixed (good "engineering process" slide)
1. Every image first returned 0 vehicles. COCO-SSD names its field `class`, not `label`. Fixed and covered by a test.
2. COCO-SSD drew one giant box around a whole traffic jam, which wiped out the real detections inside it. Added group-box removal.
3. A distant bus was classified LMV. Added the perspective-aware truck rule.
4. COCO-SSD missed most trucks and trailers. Switched the default to DETR, and accuracy went from 46.5% to 76.2%.
5. A real bus was deleted as a "group box" because cars overlapped it. The rule now requires members to be ≥90% enclosed.
6. Tiling (running the model on image crops) made DETR worse: crops with no context turned blur into "cars". It is now off by default.
7. In a real browser the page froze for about 4 s per image. A new automated responsiveness test measured the stall. Moving inference into Web Workers cut it to 80 ms.

### Limitations (be honest; evaluators value this)
- **Very dense, distant or foggy traffic is undercounted** by about 35–40%, because far vehicles are only a few pixels tall.
- **Auto-rickshaws, e-rickshaws and tempos are not COCO classes.** They are often missed or detected as cars.
- **Long or articulated vehicles are sometimes split into two boxes.** For example, a cement mixer is counted as cab + drum, giving 2 HMV.
- **Clustered motorcycles are over-counted, and motorcycles hidden behind riders are under-counted.**
- **Still images only:** there is no tracking across video frames.

### Possible future work (present as ideas, not done)
- Add a model with auto-rickshaw and two-wheeler classes, such as one trained on an Indian traffic dataset (the IDD dataset).
- Video input with object tracking, to count vehicles crossing a line.
- Optionally fine-tune on local traffic, which would relax the "no training" constraint.
- Use WebGPU for faster in-browser inference.

---

## Suggested slide outline (adapt if a better flow is obvious)
1. **Title:** Traffic Counter, plus subtitle, `[ADD: names, roll numbers, course, guide, date]`.
2. **Problem:** why class-wise counts matter; manual counting is slow.
3. **Objectives and constraints:** count vehicles, count cars, classify LMV/HMV/Motorcycle, no training, runs in a browser.
4. **Approach overview:** pretrained COCO detectors plus rule-based classification. Use a simple diagram.
5. **Pipeline:** a flow diagram of the 7 steps.
6. **Classification rules:** the table, plus a mini illustration of the perspective-aware truck rule (a near car vs a far truck).
7. **Tech stack:** DETR via Transformers.js, COCO-SSD via TensorFlow.js, Web Workers, plain HTML/CSS/JS.
8. **App screenshot:** `[ui-results-light.png]`, annotated with callouts to the upload area, count tiles, boxes and batch table.
9. **Dataset and evaluation method:** 18 images, hand-counted ground truth, metrics, automated tests.
10. **Model comparison:** bar chart of count accuracy for the four configurations.
11. **Results:** the expected vs detected totals table, and 2–3 annotated examples: `[final__trucks-russia.png]`, `[final__bus-firetruck-jakarta.png]`, `[final__highway-jam-m62.png]`.
12. **What testing taught us:** the bugs found and fixed. Show it as a short timeline or table.
13. **Limitations:** one failure example `[final__fog-delhi.png]` or `[final__jam-delhi.png]` beside the list.
14. **Future work.**
15. **Demo and Q&A:** "Live demo" plus how it runs (`serve.ps1`, then open `http://localhost:8080`).

## Images to attach with this prompt
From the project folder `tests/output/`:
`ui-results-light.png`, `ui-mobile-dark.png`, `final__trucks-russia.png`, `final__bus-firetruck-jakarta.png`,
`final__highway-jam-m62.png`, `final__urban-india.png`, `final__fog-delhi.png`, `final__jam-delhi.png`.

Image credit line for the final slide: "Sample photographs: Wikimedia Commons contributors, used under
their respective free licences (see samples/CREDITS.md)."
