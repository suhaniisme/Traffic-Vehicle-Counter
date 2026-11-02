// Test driver: runs unit tests, then (optionally) the full detection
// pipeline on every sample image and compares against tests/expected.json.
//
// Query parameters:
//   suite=unit|all     which suites to run (default: all)
//   model=detr|ssd     which pretrained detector to use (default: detector default)
//   tiles=0|1          tiled pass on/off (default: detector default)
//   score=0.xx         confidence threshold (default: detector default)
//   only=a,b           run only images whose file name contains one of these
//   tag=name           suffix for output files (default: "default")
//   save=1             POST results + annotated images to serve.ps1 (/__save)
(function () {
  const params = new URLSearchParams(location.search);
  const suite = params.get('suite') || 'all';
  const save = params.get('save') === '1';
  const tag = params.get('tag') || 'default';
  const statusEl = document.getElementById('status');

  async function post(name, body) {
    if (!save) return;
    await fetch('/__save?name=' + encodeURIComponent(name), { method: 'POST', body });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function renderUnit(results) {
    const failed = results.filter(r => !r.pass);
    document.getElementById('unit').innerHTML =
      '<h2>Unit tests: ' + (results.length - failed.length) + '/' + results.length + ' passed</h2><ul>' +
      results.map(r => '<li class="' + (r.pass ? 'pass' : 'fail') + '">' + (r.pass ? 'PASS ' : 'FAIL ') +
        escapeHtml(r.name) + (r.error ? ' — ' + escapeHtml(r.error) : '') + '</li>').join('') + '</ul>';
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('could not load ' + src));
      img.src = src;
    });
  }

  async function runE2E() {
    const TC = window.TrafficCounter;
    const expected = await (await fetch('expected.json', { cache: 'no-store' })).json();
    const opts = {};
    if (params.has('tiles')) opts.tiles = params.get('tiles') === '1';
    if (params.has('score')) opts.minScore = parseFloat(params.get('score'));

    statusEl.textContent = 'Loading model…';
    const t0 = performance.now();
    const model = await TC.loadModel(params.get('model') || undefined);
    const loadMs = Math.round(performance.now() - t0);

    // Responsiveness: the page must keep handling events while a model runs.
    // A 50 ms timer records the longest stall of the main thread during one analysis.
    statusEl.textContent = 'Measuring main-thread responsiveness…';
    const probeImg = await loadImage('../samples/' + Object.keys(expected.images)[0]);
    let last = performance.now(), maxStall = 0;
    const timer = setInterval(() => { const now = performance.now(); maxStall = Math.max(maxStall, now - last); last = now; }, 50);
    await TC.analyze(model, probeImg, opts);
    clearInterval(timer);
    // A block that lasts until the end never lets the timer fire, so count the trailing gap too.
    maxStall = Math.max(maxStall, performance.now() - last);
    const responsiveness = { maxStallMs: Math.round(maxStall), limitMs: 500, pass: maxStall < 500 };

    const rows = [];
    const keys = ['total', 'cars', 'LMV', 'HMV', 'Motorcycle'];
    const only = params.get('only') ? params.get('only').split(',') : null;
    for (const [file, exp] of Object.entries(expected.images)) {
      if (only && !only.some(o => file.includes(o))) continue;
      statusEl.textContent = 'Analysing ' + file + '…';
      const img = await loadImage('../samples/' + file);
      const t = performance.now();
      const result = await TC.analyze(model, img, opts);
      const ms = Math.round(performance.now() - t);
      const got = result.summary;
      const err = {};
      keys.forEach(k => { err[k] = got[k] - exp[k]; });
      const brief = d => ({ label: d.label, category: d.category, score: +d.score.toFixed(3), bbox: d.bbox.map(v => Math.round(v)), source: d.source });
      rows.push({ file, expected: exp, got, err, ms, detections: result.detections.map(brief), raw: result.raw.map(brief) });

      const canvas = document.createElement('canvas');
      TC.drawAnnotated(canvas, img, result.detections);
      await post(tag + '__' + file.replace(/\.\w+$/, '') + '.png', canvas.toDataURL('image/png'));
    }

    // Aggregate metrics: mean absolute error and overall count accuracy.
    const agg = {};
    keys.forEach(k => {
      const sumExp = rows.reduce((s, r) => s + r.expected[k], 0);
      const sumAbs = rows.reduce((s, r) => s + Math.abs(r.err[k]), 0);
      agg[k] = { mae: +(sumAbs / rows.length).toFixed(2), expectedTotal: sumExp, detectedTotal: rows.reduce((s, r) => s + r.got[k], 0) };
    });
    const totalExp = rows.reduce((s, r) => s + r.expected.total, 0);
    const totalAbs = rows.reduce((s, r) => s + Math.abs(r.err.total), 0);
    agg.countAccuracy = +(1 - totalAbs / totalExp).toFixed(3);
    agg.avgMs = Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length);
    agg.modelLoadMs = loadMs;
    agg.backend = (model.name === 'ssd' ? 'tfjs' : 'onnx-wasm') + ' in worker';
    agg.model = model.name;
    agg.options = opts;

    document.getElementById('e2e').innerHTML =
      '<h2>End-to-end (' + rows.length + ' images, backend ' + agg.backend + ')</h2><table><tr><th>Image</th>' +
      keys.map(k => '<th>' + k + ' exp/got</th>').join('') + '<th>ms</th></tr>' +
      rows.map(r => '<tr><td>' + r.file + '</td>' + keys.map(k => '<td>' + r.expected[k] + ' / ' + r.got[k] + '</td>').join('') + '<td>' + r.ms + '</td></tr>').join('') +
      '</table><pre>' + escapeHtml(JSON.stringify(agg, null, 2)) + '</pre>';
    return { rows, aggregate: agg, responsiveness };
  }

  async function main() {
    const report = { tag, unit: null, e2e: null, error: null };
    try {
      report.unit = window.runUnitTests();
      renderUnit(report.unit);
      if (suite === 'all') report.e2e = await runE2E();
      statusEl.textContent = 'Done.';
    } catch (e) {
      report.error = e.message + '\n' + (e.stack || '');
      statusEl.textContent = 'Error: ' + e.message;
    }
    await post(tag + '__results.json', JSON.stringify(report, null, 2));
  }

  window.addEventListener('load', main);
})();
