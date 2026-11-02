# Traffic Counter: Checklist

Goal: a browser-based (HTML/CSS/JS) tool that takes traffic images as input, counts cars,
and sorts every detected vehicle into **LMV**, **HMV** or **Motorcycle**, using only
pretrained models and existing libraries. Nothing is trained.

## 1. Setup and model choice
- [x] Pick a pretrained detector that runs in the browser: TensorFlow.js + COCO-SSD (COCO classes `car`, `truck`, `bus`, `motorcycle`)
- [x] *Added after testing:* DETR ResNet-50 via Transformers.js as the default (76% vs 19–46% count accuracy for COCO-SSD)
- [x] Load libraries from a pinned CDN version (no build step, no npm)
- [x] Add a zero-dependency local static server (`serve.ps1`), because browsers block canvas pixel reads on `file://`

## 2. Detection pipeline (`js/detector.js`)
- [x] Load the model once (`mobilenet_v2` base for better accuracy than the default lite model)
- [x] Run detection on the full image
- [x] Optional tiled pass (overlapping 2x2 tiles) for small or distant vehicles. Off by default, because testing showed it adds false positives with DETR
- [x] Merge full-image and tile detections with cross-class non-max suppression
- [x] *Added after testing:* remove "group boxes" drawn around clusters of vehicles
- [x] Filter by a user-adjustable confidence threshold

## 3. Classification rules
- [x] `car` -> LMV
- [x] `bus` -> HMV
- [x] `truck` -> HMV, except small trucks (pickups/vans) relative to cars **at the same depth** -> LMV
- [x] `motorcycle` -> Motorcycle
- [x] Ignore non-vehicle classes (people, bicycles, traffic lights, ...)
- [x] Keep the rules as pure functions so they can be unit tested

## 4. User interface (`index.html`, `css/style.css`, `js/app.js`)
- [x] Upload via file picker and drag-and-drop; multiple images at once
- [x] Built-in sample gallery from the `samples/` folder (also `?samples=1`)
- [x] Draw solid-outline bounding boxes with solid label tags (no translucent fills or highlights)
- [x] Summary tiles: total vehicles, cars, LMV, HMV, motorcycles
- [x] Per-detection table (class, COCO label, confidence)
- [x] Settings: detector, confidence threshold, tiled pass on/off, re-run
- [x] Batch results table across all loaded images + CSV export
- [x] Clean, flat design; light and dark; responsive down to phone width; loading and error states

## 5. Test data
- [x] Collect 18 varied, freely licensed traffic images in `samples/` (highways, city streets, buses, trucks, motorcycles, dense jams, night, fog)
- [x] Record hand-counted expected values per image in `tests/expected.json`

## 6. Testing
- [x] Unit tests for classification, IoU, NMS, group boxes, conversion (`tests/unit.js`): 36/36 pass
- [x] End-to-end run of the full pipeline on every sample image in headless Chrome
- [x] Compare detected counts with expected counts; report per-image and overall error
- [x] Visually inspect annotated output and UI screenshots
- [x] Tune defaults (model, threshold, tiling, truck rule) based on results, then re-run
- [x] One-command test runner (`tests/run-tests.ps1`)

## 7. Documentation
- [x] README with how to run, how it works, class mapping, and known limitations
- [x] TEST_REPORT.md with measured results
