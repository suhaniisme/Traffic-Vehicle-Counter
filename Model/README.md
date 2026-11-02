# Traffic Counter

A browser app that takes traffic photos, counts the vehicles and cars in them, and sorts every
vehicle into **LMV** (light motor vehicle), **HMV** (heavy motor vehicle) or **Motorcycle**.

It uses only pretrained, off-the-shelf object detectors. Nothing is trained.

| Detector | Library | Notes |
|---|---|---|
| DETR ResNet-50 (default) | [Transformers.js](https://huggingface.co/docs/transformers.js) 3.0.2, model `Xenova/detr-resnet-50` (8-bit) | More accurate. About 40 MB, downloaded once and cached by the browser |
| COCO-SSD MobileNet v2 | [TensorFlow.js](https://www.tensorflow.org/js) 4.22 + `@tensorflow-models/coco-ssd` 2.2.3 | Faster, weaker on trucks and dense traffic |

Both models are trained on COCO, which already has `car`, `truck`, `bus` and `motorcycle` classes.

## Running it

Browsers block reading canvas pixels on `file://` pages, so serve the folder over HTTP. A
zero-install PowerShell server is included:

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1          # http://localhost:8080/
```

Any static server works too (`python -m http.server`, `npx serve`, VS Code Live Server).

Then:

1. Drop traffic photos onto the page, or click **Load the 18 sample images**
   (`http://localhost:8080/?samples=1` does this automatically).
2. Each image is analysed in turn. Click a thumbnail or table row to see its boxes and counts.
3. Change the detector, the confidence threshold or the tiled pass, then click **Re-run on all images**.
4. **Export CSV** downloads the per-image counts.

An internet connection is needed the first time, to fetch the libraries and model weights from
the CDN and Hugging Face. Images never leave the browser.

## How it works

```
image -> detector (full image [+ 2x2 overlapping tiles])
      -> keep car / truck / bus / motorcycle above threshold
      -> drop "group boxes" (one box drawn around a cluster of vehicles)
      -> merge duplicates (cross-class NMS, tile fragments)
      -> map to LMV / HMV / Motorcycle
      -> count + draw
```

All logic is in [js/detector.js](js/detector.js) (pure functions, unit-tested). The UI is in [js/app.js](js/app.js).
Both models run in Web Workers ([js/detr-worker.js](js/detr-worker.js), [js/ssd-worker.js](js/ssd-worker.js)),
so the page stays responsive during the seconds of inference per image.

### Class mapping

| COCO label | Category | Rule |
|---|---|---|
| `car` | LMV | Counted as a car as well |
| `bus` | HMV | |
| `truck` | HMV | A truck no bigger than 1.8× the cars **at the same distance** is a pickup or van, so LMV. Distance is approximated by the box's bottom edge, so a far-away lorry is not compared with a near-camera car |
| `motorcycle` | Motorcycle | Includes scooters |
| anything else | not counted | People, bicycles, traffic lights and so on |

### Options

- **Confidence threshold:** detections below it are discarded. Lower values find more vehicles but produce more false positives.
- **Tiled pass:** also runs the detector on four overlapping crops, then merges the results. Helps with small, distant vehicles. About 5× slower.

## Tests

```powershell
powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1               # unit + end-to-end on all samples
powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1 -Suite unit   # unit tests only (seconds)
powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1 -Model ssd -Tiles 1 -Tag ssd-tiles
```

The runner starts `serve.ps1`, opens [tests/test.html](tests/test.html) in headless Chrome or Edge,
and prints per-image expected and detected counts plus aggregate error. Annotated images and a JSON
report are written to `tests/output/`. You can also open `http://localhost:8080/tests/test.html`
in a normal browser.

- [tests/unit.js](tests/unit.js): unit tests for IoU, filtering, merging, group boxes, classification, tiling and summaries.
- [tests/expected.json](tests/expected.json): hand-counted ground truth for every sample image.
- [samples/](samples/): 18 freely licensed Wikimedia Commons photos. Credits are in [samples/CREDITS.md](samples/CREDITS.md).

See [TEST_REPORT.md](TEST_REPORT.md) for the measured results.

## Known limitations

- **Auto-rickshaws, e-rickshaws and tempos are not COCO classes.** They are usually detected as `car` (correctly LMV) or missed.
- **Very dense or distant traffic is undercounted.** Heavy fog and long jams with vehicles only a few pixels tall are the hardest cases. The tiled pass helps somewhat.
- **Partly hidden vehicles** (a motorcycle behind its rider, a car behind a bus) may be missed or merged.
- Counts are per image. There is no tracking across video frames.
