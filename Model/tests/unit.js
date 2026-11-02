// Unit tests for the pure logic in js/detector.js.
// Runs in the browser via tests/test.html (no Node required).
(function () {
  const results = [];

  function test(name, fn) {
    try {
      fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e.message });
    }
  }

  function eq(actual, expected, msg) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'expected ' + b + ', got ' + a);
  }

  function near(actual, expected, tol, msg) {
    if (Math.abs(actual - expected) > tol) throw new Error((msg ? msg + ': ' : '') + 'expected ~' + expected + ', got ' + actual);
  }

  function det(label, bbox, score) {
    return { label, bbox, score: score == null ? 0.9 : score };
  }

  window.runUnitTests = function () {
    const TC = window.TrafficCounter;
    results.length = 0;
    if (!TC) {
      results.push({ name: 'TrafficCounter module loaded', pass: false, error: 'window.TrafficCounter is undefined' });
      return results;
    }

    // --- IoU ---------------------------------------------------------------
    test('iou: identical boxes = 1', () => eq(TC.iou([0, 0, 10, 10], [0, 0, 10, 10]), 1));
    test('iou: disjoint boxes = 0', () => eq(TC.iou([0, 0, 10, 10], [20, 20, 5, 5]), 0));
    test('iou: half-shifted boxes = 1/3', () => near(TC.iou([0, 0, 10, 10], [5, 0, 10, 10]), 1 / 3, 1e-9));
    test('iou: zero-area box = 0', () => eq(TC.iou([0, 0, 0, 0], [0, 0, 10, 10]), 0));

    // --- COCO label -> category ------------------------------------------------
    test('category: car -> LMV', () => eq(TC.toCategory('car'), 'LMV'));
    test('category: bus -> HMV', () => eq(TC.toCategory('bus'), 'HMV'));
    test('category: truck -> HMV', () => eq(TC.toCategory('truck'), 'HMV'));
    test('category: motorcycle -> Motorcycle', () => eq(TC.toCategory('motorcycle'), 'Motorcycle'));
    test('category: person -> null', () => eq(TC.toCategory('person'), null));
    test('category: bicycle -> null (not motorised)', () => eq(TC.toCategory('bicycle'), null));

    // --- Raw COCO-SSD output ------------------------------------------------------
    test('fromModel: converts COCO-SSD {class} predictions to {label} detections', () => {
      const out = TC.fromModel([{ bbox: [1, 2, 3, 4], class: 'car', score: 0.7 }], 'tile');
      eq(out, [{ label: 'car', bbox: [1, 2, 3, 4], score: 0.7, source: 'tile' }]);
    });

    test('fromDetr: converts Transformers.js {box} predictions to {bbox} detections', () => {
      const out = TC.fromDetr([{ label: 'bus', score: 0.9, box: { xmin: 10, ymin: 20, xmax: 110, ymax: 70 } }], 'full');
      eq(out, [{ label: 'bus', bbox: [10, 20, 100, 50], score: 0.9, source: 'full' }]);
    });

    // --- Filtering ------------------------------------------------------------
    test('filterVehicles drops non-vehicles and low scores', () => {
      const out = TC.filterVehicles([
        det('car', [0, 0, 10, 10], 0.8),
        det('person', [0, 0, 10, 10], 0.99),
        det('truck', [0, 0, 10, 10], 0.2),
        det('bus', [0, 0, 10, 10], 0.5),
      ], 0.4);
      eq(out.map(d => d.label), ['car', 'bus']);
    });

    // --- Merging (NMS) ----------------------------------------------------------
    test('merge: overlapping duplicates keep the higher score', () => {
      const out = TC.mergeDetections([
        det('car', [0, 0, 100, 50], 0.6),
        det('car', [5, 2, 100, 50], 0.9),
      ]);
      eq(out.length, 1);
      eq(out[0].score, 0.9);
    });
    test('merge: same vehicle seen as car and truck counts once', () => {
      const out = TC.mergeDetections([
        det('truck', [0, 0, 100, 60], 0.55),
        det('car', [3, 3, 98, 58], 0.7),
      ]);
      eq(out.length, 1);
      eq(out[0].label, 'car');
    });
    test('merge: separate vehicles are all kept', () => {
      const out = TC.mergeDetections([
        det('car', [0, 0, 50, 30]),
        det('car', [60, 0, 50, 30]),
        det('motorcycle', [120, 0, 20, 30]),
      ]);
      eq(out.length, 3);
    });
    test('merge: tile fragment inside a larger same-class box is dropped', () => {
      const out = TC.mergeDetections([
        det('truck', [0, 0, 200, 100], 0.8),
        Object.assign(det('truck', [100, 10, 90, 80], 0.85), { source: 'tile' }),
      ]);
      eq(out.length, 1);
      eq(out[0].bbox, [0, 0, 200, 100]);
    });
    test('merge: nested boxes from the full image are both kept (car behind car)', () => {
      const out = TC.mergeDetections([
        Object.assign(det('car', [0, 0, 200, 120], 0.8), { source: 'full' }),
        Object.assign(det('car', [120, 10, 70, 50], 0.7), { source: 'full' }),
      ]);
      eq(out.length, 2);
    });
    test('merge: small tile box inside a much bigger box is a real vehicle, kept', () => {
      const out = TC.mergeDetections([
        det('car', [0, 0, 1000, 400], 0.6),
        Object.assign(det('car', [300, 100, 60, 40], 0.8), { source: 'tile' }),
      ]);
      eq(out.length, 2);
    });
    test('removeGroupBoxes: box enclosing 3+ other vehicle centres is dropped', () => {
      const out = TC.removeGroupBoxes([
        det('car', [0, 0, 1000, 400], 0.6),
        det('car', [100, 100, 50, 30]),
        det('truck', [300, 100, 80, 60]),
        det('car', [600, 200, 50, 30]),
      ]);
      eq(out.length, 3);
      if (out.some(d => d.bbox[2] === 1000)) throw new Error('group box kept');
    });
    test('removeGroupBoxes: bus with motorcycles in front is kept', () => {
      const out = TC.removeGroupBoxes([
        det('bus', [0, 0, 400, 300], 0.9),
        det('motorcycle', [50, 150, 40, 80]),
        det('motorcycle', [150, 150, 40, 80]),
        det('motorcycle', [250, 150, 40, 80]),
      ]);
      eq(out.length, 4);
    });
    test('removeGroupBoxes: bus overlapping two cars is kept', () => {
      const out = TC.removeGroupBoxes([
        det('bus', [0, 0, 400, 300], 0.9),
        det('car', [300, 200, 150, 90]),
        det('car', [20, 250, 150, 90]),
      ]);
      eq(out.length, 3);
    });
    test('removeGroupBoxes: bus with cars crossing its edges is kept (real Jakarta case)', () => {
      const out = TC.removeGroupBoxes([
        det('bus', [42, 301, 1055, 503], 0.978),
        det('car', [552, 631, 595, 260], 0.998),
        det('car', [-13, 398, 207, 246], 0.992),
        det('car', [34, 594, 371, 243], 0.804),
      ]);
      eq(out.length, 4);
    });
    test('removeGroupBoxes: motorcycle box around a cluster of motorcycles is dropped', () => {
      const out = TC.removeGroupBoxes([
        det('motorcycle', [900, 230, 260, 150], 0.53),
        det('motorcycle', [910, 240, 100, 90]),
        det('motorcycle', [1040, 280, 110, 90]),
      ]);
      eq(out.length, 2);
      if (out.some(d => d.bbox[2] === 260)) throw new Error('group box kept');
    });
    test('merge: motorcycle in front of a bus is kept', () => {
      const out = TC.mergeDetections([
        det('bus', [0, 0, 300, 200], 0.9),
        det('motorcycle', [100, 100, 40, 80], 0.7),
      ]);
      eq(out.length, 2);
    });
    test('merge: does not mutate its input', () => {
      const input = [det('car', [0, 0, 10, 10], 0.5), det('car', [0, 0, 10, 10], 0.9)];
      TC.mergeDetections(input);
      eq(input.length, 2);
      eq(input[0].score, 0.5);
    });

    // --- Classification ---------------------------------------------------------
    test('classify: assigns categories', () => {
      const out = TC.classify([
        det('car', [0, 0, 40, 30]),
        det('bus', [100, 0, 200, 120]),
        det('motorcycle', [400, 0, 15, 30]),
      ]);
      eq(out.map(d => d.category), ['LMV', 'HMV', 'Motorcycle']);
    });
    test('classify: small truck (pickup/van) relative to cars -> LMV', () => {
      const out = TC.classify([
        det('car', [0, 0, 40, 30]),
        det('car', [50, 0, 40, 30]),
        det('truck', [100, 0, 45, 32]),
      ]);
      eq(out[2].category, 'LMV');
    });
    test('classify: large truck relative to cars -> HMV', () => {
      const out = TC.classify([
        det('car', [0, 0, 40, 30]),
        det('truck', [100, 0, 120, 80]),
      ]);
      eq(out[1].category, 'HMV');
    });
    test('classify: distant truck is compared with cars at the same distance, not near-camera cars', () => {
      // Near-camera car is huge; the far truck is small in pixels but much
      // bigger than the far car next to it -> still HMV.
      const out = TC.classify([
        det('car', [700, 480, 570, 360]),
        det('car', [450, 300, 43, 25]),
        det('truck', [600, 275, 53, 69]),
      ]);
      eq(out[2].category, 'HMV');
    });
    test('classify: truck with no car at a similar distance -> HMV', () => {
      const out = TC.classify([
        det('car', [700, 480, 570, 360]),
        det('truck', [600, 275, 53, 40]),
      ]);
      eq(out[1].category, 'HMV');
    });
    test('classify: truck with no cars for reference -> HMV', () => {
      const out = TC.classify([det('truck', [0, 0, 40, 30])]);
      eq(out[0].category, 'HMV');
    });

    // --- Summary ----------------------------------------------------------------
    test('summarize: counts per category and cars', () => {
      const s = TC.summarize([
        { label: 'car', category: 'LMV' },
        { label: 'car', category: 'LMV' },
        { label: 'truck', category: 'LMV' },
        { label: 'bus', category: 'HMV' },
        { label: 'motorcycle', category: 'Motorcycle' },
      ]);
      eq(s, { total: 5, cars: 2, LMV: 3, HMV: 1, Motorcycle: 1 });
    });
    test('summarize: empty list is all zeros', () => {
      eq(TC.summarize([]), { total: 0, cars: 0, LMV: 0, HMV: 0, Motorcycle: 0 });
    });

    // --- Tiling -----------------------------------------------------------------
    test('tileRects: 2x2 grid gives 4 in-bounds overlapping tiles', () => {
      const rects = TC.tileRects(1000, 600, 2, 0.2);
      eq(rects.length, 4);
      rects.forEach(r => {
        if (r.x < 0 || r.y < 0 || r.x + r.w > 1000 + 1e-9 || r.y + r.h > 600 + 1e-9) throw new Error('out of bounds: ' + JSON.stringify(r));
      });
      if (rects[0].x + rects[0].w <= rects[1].x) throw new Error('tiles do not overlap horizontally');
      const maxX = Math.max(...rects.map(r => r.x + r.w)), maxY = Math.max(...rects.map(r => r.y + r.h));
      near(maxX, 1000, 1e-9, 'covers width');
      near(maxY, 600, 1e-9, 'covers height');
    });
    test('offsetDetections maps tile coords back to image coords', () => {
      const out = TC.offsetDetections([det('car', [10, 20, 30, 40])], { x: 100, y: 50 }, 2);
      eq(out[0].bbox, [105, 60, 15, 20]);
    });

    return results;
  };
})();
