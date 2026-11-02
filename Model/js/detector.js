// Vehicle detection and classification on top of the pretrained COCO-SSD
// model (TensorFlow.js). Nothing here is trained: COCO-SSD already knows
// "car", "truck", "bus" and "motorcycle"; this module maps those labels to
// LMV / HMV / Motorcycle, merges overlapping boxes and draws the result.
//
// Exposed as window.TrafficCounter so the app and the tests share one copy.
(function (global) {
  'use strict';

  // Resolve the worker next to this file, whichever page loads it.
  const SCRIPT_URL = document.currentScript ? document.currentScript.src : location.href;

  const CATEGORY_BY_LABEL = {
    car: 'LMV',
    truck: 'HMV',
    bus: 'HMV',
    motorcycle: 'Motorcycle',
  };

  const CATEGORIES = ['LMV', 'HMV', 'Motorcycle'];

  const COLORS = {
    LMV: '#1d4ed8',
    HMV: '#c2410c',
    Motorcycle: '#15803d',
  };

  const DEFAULTS = {
    minScore: 0.4,          // confidence threshold
    tiles: false,           // extra pass over overlapping tiles (off: crops cause false positives)
    tileGrid: 2,            // tiles per side
    tileOverlap: 0.2,       // fraction of a tile shared with its neighbour
    iouThreshold: 0.5,      // boxes overlapping more than this are one vehicle
    containThreshold: 0.8,  // a tile box this much inside a bigger box is a fragment...
    fragmentMinRatio: 0.25, // ...if it is also at least this fraction of the bigger box's area
    groupMinMembers: 3,     // a box fully enclosing this many smaller cars/trucks/buses is a group box
    groupMinMotorcycles: 2, // ...or this many smaller motorcycles
    smallTruckRatio: 1.8,   // truck smaller than this x median car area -> LMV (pickup/van)
    maxBoxes: 100,
  };

  // --- Geometry (bbox = [x, y, width, height]) ------------------------------

  function area(b) {
    return Math.max(0, b[2]) * Math.max(0, b[3]);
  }

  function intersection(a, b) {
    const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function iou(a, b) {
    const inter = intersection(a, b);
    const union = area(a) + area(b) - inter;
    return union > 0 ? inter / union : 0;
  }

  // --- Labels and filtering --------------------------------------------------

  function toCategory(label) {
    return CATEGORY_BY_LABEL[label] || null;
  }

  // COCO-SSD names the class "class"; everything here uses "label".
  function fromModel(predictions, source) {
    return predictions.map(p => ({ label: p.class, bbox: p.bbox, score: p.score, source }));
  }

  // Transformers.js gives corner coordinates; convert to [x, y, w, h].
  function fromDetr(predictions, source) {
    return predictions.map(p => ({
      label: p.label,
      bbox: [p.box.xmin, p.box.ymin, p.box.xmax - p.box.xmin, p.box.ymax - p.box.ymin],
      score: p.score,
      source,
    }));
  }

  function filterVehicles(dets, minScore) {
    return dets.filter(d => toCategory(d.label) && d.score >= minScore);
  }

  // Cars, trucks and buses get confused with each other; motorcycles do not.
  function isFourWheeler(label) {
    return label !== 'motorcycle';
  }

  // Merge detections from the full image and from tiles:
  //  1. greedy non-max suppression across classes (the same vehicle seen as
  //     both "car" and "truck" must be counted once);
  //  2. drop tile boxes that sit mostly inside a larger box, since a tile can
  //     only see part of a vehicle that crosses its edge.
  function mergeDetections(dets, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    const sorted = dets.slice().sort((a, b) => b.score - a.score);

    const kept = [];
    for (const d of sorted) {
      if (!kept.some(k => iou(k.bbox, d.bbox) > o.iouThreshold)) kept.push(d);
    }

    return kept.filter(d => {
      if (d.source !== 'tile') return true;
      const a = area(d.bbox);
      return !kept.some(k => k !== d &&
        area(k.bbox) > a &&
        a >= o.fragmentMinRatio * area(k.bbox) &&
        isFourWheeler(k.label) === isFourWheeler(d.label) &&
        intersection(k.bbox, d.bbox) / a > o.containThreshold);
    });
  }

  // Detectors sometimes put one big box around a whole cluster of traffic.
  // A box that fully encloses several smaller vehicles of the same kind is
  // such a group box, not a vehicle. Vehicles that merely overlap it (cars
  // in front of a bus seen from above) do not count as enclosed.
  function removeGroupBoxes(dets, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    return dets.filter(d => {
      const a = area(d.bbox);
      const kind = isFourWheeler(d.label);
      const members = dets.filter(m => m !== d && isFourWheeler(m.label) === kind && area(m.bbox) < a &&
        intersection(d.bbox, m.bbox) >= 0.9 * area(m.bbox));
      return members.length < (kind ? o.groupMinMembers : o.groupMinMotorcycles);
    });
  }

  // --- Classification ------------------------------------------------------------

  function median(values) {
    if (!values.length) return 0;
    const s = values.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // COCO's "truck" covers pickups and vans as well as lorries. A truck no
  // bigger than a typical car at the same distance is treated as LMV.
  // Distance is approximated by where the box meets the road (its bottom
  // edge): cars further away sit higher in the image and look smaller.
  function classify(dets, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    const cars = dets.filter(d => d.label === 'car');
    const bottom = b => b[1] + b[3];
    return dets.map(d => {
      let category = toCategory(d.label);
      let note = '';
      const carArea = d.label === 'truck'
        ? median(cars.filter(c => Math.abs(bottom(c.bbox) - bottom(d.bbox)) <= d.bbox[3]).map(c => area(c.bbox)))
        : 0;
      if (carArea > 0 && area(d.bbox) < o.smallTruckRatio * carArea) {
        category = 'LMV';
        note = 'small truck (pickup/van)';
      }
      return Object.assign({}, d, { category, note });
    });
  }

  function summarize(dets) {
    const s = { total: dets.length, cars: 0, LMV: 0, HMV: 0, Motorcycle: 0 };
    dets.forEach(d => {
      if (d.label === 'car') s.cars++;
      if (d.category in s) s[d.category]++;
    });
    return s;
  }

  // --- Tiling ----------------------------------------------------------------------

  function tileRects(width, height, grid, overlap) {
    const tw = width / (grid - (grid - 1) * overlap);
    const th = height / (grid - (grid - 1) * overlap);
    const rects = [];
    for (let row = 0; row < grid; row++) {
      for (let col = 0; col < grid; col++) {
        rects.push({ x: col * tw * (1 - overlap), y: row * th * (1 - overlap), w: tw, h: th });
      }
    }
    return rects;
  }

  function offsetDetections(dets, rect, scale) {
    return dets.map(d => Object.assign({}, d, {
      bbox: [rect.x + d.bbox[0] / scale, rect.y + d.bbox[1] / scale, d.bbox[2] / scale, d.bbox[3] / scale],
    }));
  }

  // --- Model ---------------------------------------------------------------------------

  // Two interchangeable pretrained COCO detectors, wrapped behind the same
  // detect(canvas, minScore) -> [{label, bbox, score}] interface:
  //   detr: DETR ResNet-50 via Transformers.js (more accurate, slower)
  //   ssd:  COCO-SSD MobileNet v2 via TensorFlow.js (fast)
  // Both run in a Web Worker: inference is seconds of solid work and would
  // otherwise freeze the page.
  const MODELS = {
    detr: {
      title: 'DETR ResNet-50 (accurate)',
      async load(onProgress) {
        const call = await startWorker('detr-worker.js', 'module', onProgress);
        return {
          async detect(canvas, minScore) {
            const image = pixels(canvas);
            return fromDetr(await call({ type: 'detect', image, minScore }, [image.data.buffer]));
          },
        };
      },
    },
    ssd: {
      title: 'COCO-SSD MobileNet v2 (fast)',
      async load(onProgress) {
        const call = await startWorker('ssd-worker.js', 'classic', onProgress);
        return {
          async detect(canvas, minScore) {
            const image = pixels(canvas);
            return fromModel(await call({ type: 'detect', image, minScore, maxBoxes: DEFAULTS.maxBoxes }, [image.data.buffer]));
          },
        };
      },
    },
  };

  function pixels(canvas) {
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  }

  // Start a model worker, wait for its model to load, and return a
  // call(message, transfer) -> Promise function for requests to it.
  async function startWorker(file, type, onProgress) {
    const worker = new Worker(new URL(file, SCRIPT_URL), { type });
    const pending = new Map();
    let nextId = 1;
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { if (onProgress) onProgress(data.progress); return; }
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.type === 'error') p.reject(new Error(data.message));
      else p.resolve(data.value);
    };
    worker.onerror = e => {
      pending.forEach(p => p.reject(new Error(e.message || 'Model worker failed to start (check your internet connection).')));
      pending.clear();
    };
    const call = (msg, transfer) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage(Object.assign({ id }, msg), transfer || []);
    });
    await call({ type: 'load' });
    return call;
  }

  async function loadModel(name, onProgress) {
    const key = name || 'detr';
    if (!MODELS[key]) throw new Error('Unknown model: ' + key);
    const model = await MODELS[key].load(onProgress);
    return Object.assign(model, { name: key, title: MODELS[key].title });
  }

  // Copy the source into a canvas at its natural size so detection does not
  // depend on how big the <img> happens to be rendered on screen.
  function toCanvas(source, rect) {
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    const r = rect || { x: 0, y: 0, w, h };
    const c = document.createElement('canvas');
    c.width = Math.round(r.w);
    c.height = Math.round(r.h);
    c.getContext('2d').drawImage(source, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    return c;
  }

  async function analyze(model, source, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    const full = toCanvas(source);
    const tag = source => d => Object.assign(d, { source });
    const raw = (await model.detect(full, o.minScore)).map(tag('full'));

    if (o.tiles) {
      for (const rect of tileRects(full.width, full.height, o.tileGrid, o.tileOverlap)) {
        const found = (await model.detect(toCanvas(full, rect), o.minScore)).map(tag('tile'));
        raw.push(...offsetDetections(found, rect, 1));
      }
    }

    const vehicles = removeGroupBoxes(filterVehicles(raw, o.minScore), o);
    const detections = classify(mergeDetections(vehicles, o), o);
    return { detections, raw, summary: summarize(detections), width: full.width, height: full.height };
  }

  // --- Drawing ---------------------------------------------------------------------------

  // Solid outlines and solid label tags only (no translucent fills).
  function drawAnnotated(canvas, source, dets) {
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, w, h);

    const line = Math.max(2, Math.round(Math.max(w, h) / 400));
    const font = Math.max(12, Math.round(Math.max(w, h) / 70));
    ctx.font = '600 ' + font + 'px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textBaseline = 'top';

    dets.forEach((d, i) => {
      const [x, y, bw, bh] = d.bbox;
      const color = COLORS[d.category] || '#111827';
      ctx.lineWidth = line;
      ctx.strokeStyle = color;
      ctx.strokeRect(x, y, bw, bh);

      const text = (i + 1) + ' ' + d.category;
      const pad = Math.round(font * 0.3);
      const tw = ctx.measureText(text).width + pad * 2;
      const th = font + pad * 2;
      const ty = y - th >= 0 ? y - th : y;
      ctx.fillStyle = color;
      ctx.fillRect(x - line / 2, ty, tw, th);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, x - line / 2 + pad, ty + pad);
    });
  }

  global.TrafficCounter = {
    CATEGORIES,
    COLORS,
    DEFAULTS,
    MODELS,
    iou,
    toCategory,
    fromModel,
    fromDetr,
    filterVehicles,
    mergeDetections,
    removeGroupBoxes,
    classify,
    summarize,
    tileRects,
    offsetDetections,
    loadModel,
    analyze,
    drawAnnotated,
  };
})(window);
