// UI for Traffic Counter. All detection logic lives in js/detector.js.
(function () {
  'use strict';

  const TC = window.TrafficCounter;
  const $ = id => document.getElementById(id);

  const state = {
    items: [],          // { id, name, url, img, status: 'pending'|'running'|'done'|'error', result, error }
    selectedId: null,
    models: {},         // name -> Promise<model>
    running: false,
    nextId: 1,
  };

  const settings = () => ({
    model: $('modelSelect').value,
    minScore: parseFloat($('scoreInput').value),
    tiles: $('tilesInput').checked,
  });

  // --- Model loading ----------------------------------------------------------

  function setModelStatus(stateName, text) {
    $('modelStatus').dataset.state = stateName;
    $('modelStatusText').textContent = text;
  }

  function getModel(name) {
    if (!state.models[name]) {
      const title = TC.MODELS[name].title;
      setModelStatus('loading', 'Loading ' + title + '…');
      const files = {};
      const onProgress = p => {
        if (p.status !== 'progress' || !p.total) return;
        files[p.file] = p;
        const loaded = Object.values(files).reduce((s, f) => s + f.loaded, 0);
        const total = Object.values(files).reduce((s, f) => s + f.total, 0);
        setModelStatus('loading', 'Downloading model… ' + Math.round(100 * loaded / total) + '%');
      };
      state.models[name] = TC.loadModel(name, onProgress).then(model => {
        setModelStatus('ready', title + ' ready');
        return model;
      }, err => {
        delete state.models[name];
        setModelStatus('error', 'Model failed to load');
        throw err;
      });
    }
    return state.models[name];
  }

  // --- Adding images -------------------------------------------------------------

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read this image.'));
      img.src = url;
    });
  }

  async function addImages(entries) {
    const added = [];
    for (const { name, url } of entries) {
      const item = { id: state.nextId++, name, url, img: null, status: 'pending', result: null, error: null };
      try {
        item.img = await loadImage(url);
      } catch (e) {
        item.status = 'error';
        item.error = e.message;
      }
      state.items.push(item);
      added.push(item);
    }
    if (added.length && !state.selectedId) state.selectedId = added[0].id;
    render();
    processQueue();
  }

  function addFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    addImages(files.map(f => ({ name: f.name, url: URL.createObjectURL(f) })));
  }

  async function loadSamples() {
    const btn = $('loadSamples');
    btn.disabled = true;
    try {
      const names = await (await fetch('samples/index.json')).json();
      const existing = new Set(state.items.map(i => i.name));
      await addImages(names.filter(n => !existing.has(n)).map(n => ({ name: n, url: 'samples/' + n })));
    } catch (e) {
      alert('Could not load the samples. Start the app with serve.ps1 and open http://localhost:8080/.');
    } finally {
      btn.disabled = false;
    }
  }

  // --- Processing ----------------------------------------------------------------------

  async function processQueue() {
    if (state.running) return;
    state.running = true;
    try {
      let item;
      while ((item = state.items.find(i => i.status === 'pending'))) {
        item.status = 'running';
        render();
        try {
          const s = settings();
          const model = await getModel(s.model);
          const t0 = performance.now();
          item.result = await TC.analyze(model, item.img, { minScore: s.minScore, tiles: s.tiles });
          item.result.ms = Math.round(performance.now() - t0);
          item.result.model = model.title;
          item.status = 'done';
        } catch (e) {
          item.status = 'error';
          item.error = e.message || String(e);
          console.error(e);
        }
        render();
      }
    } finally {
      state.running = false;
      render();
    }
  }

  function rerunAll() {
    state.items.forEach(i => {
      if (i.img) { i.status = 'pending'; i.result = null; i.error = null; }
    });
    render();
    processQueue();
  }

  // --- Rendering ------------------------------------------------------------------------

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function statusText(item) {
    if (item.status === 'pending') return 'Queued';
    if (item.status === 'running') return 'Analysing…';
    if (item.status === 'error') return 'Error: ' + item.error;
    return (item.result.ms / 1000).toFixed(1) + ' s';
  }

  function selected() {
    return state.items.find(i => i.id === state.selectedId) || null;
  }

  function render() {
    const has = state.items.length > 0;
    $('emptyState').hidden = has;
    $('workspace').hidden = !has;
    $('rerun').disabled = !has || state.running;
    $('exportCsv').disabled = !state.items.some(i => i.status === 'done');
    if (!has) return;
    renderThumbs();
    renderViewer();
    renderBatch();
  }

  function renderThumbs() {
    $('thumbs').innerHTML = state.items.map(i =>
      '<button class="thumb" type="button" role="option" data-id="' + i.id + '" aria-selected="' + (i.id === state.selectedId) + '" title="' + escapeHtml(i.name) + '">' +
      '<img src="' + i.url + '" alt="">' +
      '<span><span>' + (i.status === 'done' ? 'Vehicles' : statusText(i)) + '</span>' +
      (i.status === 'done' ? '<span class="count">' + i.result.summary.total + '</span>' : '') + '</span></button>'
    ).join('');
  }

  function renderViewer() {
    const item = selected();
    if (!item) return;
    $('viewerTitle').textContent = item.name;

    const canvas = $('canvas');
    const busy = item.status === 'pending' || item.status === 'running';
    $('busy').hidden = !busy;
    $('busyText').textContent = item.status === 'pending' ? 'Queued…' : 'Analysing…';

    const r = item.result;
    $('viewerMeta').textContent = r
      ? r.width + '×' + r.height + ' · ' + r.model + ' · ' + (r.ms / 1000).toFixed(1) + ' s'
      : (item.status === 'error' ? 'Error: ' + item.error : '');

    const summary = r ? r.summary : { total: 0, cars: 0, LMV: 0, HMV: 0, Motorcycle: 0 };
    document.querySelectorAll('#stats .stat-value').forEach(el => {
      el.textContent = r ? summary[el.dataset.key] : '–';
    });

    if (item.img) TC.drawAnnotated(canvas, item.img, r ? r.detections : []);

    const dets = r ? r.detections : [];
    $('detCount').textContent = r ? '(' + dets.length + ')' : '';
    $('detBody').innerHTML = dets.map((d, n) =>
      '<tr><td class="num">' + (n + 1) + '</td><td><span class="tag tag-' + d.category + '">' + d.category + '</span></td>' +
      '<td>' + d.label + '</td><td class="num">' + (d.score * 100).toFixed(0) + '%</td><td>' + escapeHtml(d.note || '') + '</td></tr>'
    ).join('') || '<tr><td colspan="5" class="status">' + (r ? 'No vehicles found at this confidence threshold.' : 'Not analysed yet.') + '</td></tr>';
  }

  function renderBatch() {
    const keys = ['total', 'cars', 'LMV', 'HMV', 'Motorcycle'];
    $('batchBody').innerHTML = state.items.map(i => {
      const s = i.result && i.result.summary;
      return '<tr data-id="' + i.id + '" class="' + (i.id === state.selectedId ? 'selected' : '') + '">' +
        '<td>' + escapeHtml(i.name) + '</td>' +
        keys.map(k => '<td class="num">' + (s ? s[k] : '–') + '</td>').join('') +
        '<td class="status' + (i.status === 'error' ? ' err' : '') + '">' + escapeHtml(statusText(i)) + '</td></tr>';
    }).join('');

    const done = state.items.filter(i => i.status === 'done');
    const totals = {};
    keys.forEach(k => { totals[k] = done.reduce((sum, i) => sum + i.result.summary[k], 0); });
    $('batchFoot').innerHTML = '<tr><td>Total (' + done.length + ' of ' + state.items.length + ' images)</td>' +
      keys.map(k => '<td class="num">' + totals[k] + '</td>').join('') + '<td></td></tr>';
  }

  // --- CSV export ------------------------------------------------------------------------

  function exportCsv() {
    const rows = [['image', 'total_vehicles', 'cars', 'lmv', 'hmv', 'motorcycles']];
    state.items.filter(i => i.status === 'done').forEach(i => {
      const s = i.result.summary;
      rows.push([i.name, s.total, s.cars, s.LMV, s.HMV, s.Motorcycle]);
    });
    const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'traffic-counts.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // --- Events ------------------------------------------------------------------------------

  function select(id) {
    state.selectedId = id;
    render();
  }

  $('fileInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
  $('loadSamples').addEventListener('click', loadSamples);
  $('rerun').addEventListener('click', rerunAll);
  $('exportCsv').addEventListener('click', exportCsv);
  $('scoreInput').addEventListener('input', e => { $('scoreOut').textContent = parseFloat(e.target.value).toFixed(2); });
  $('thumbs').addEventListener('click', e => { const b = e.target.closest('.thumb'); if (b) select(+b.dataset.id); });
  $('batchBody').addEventListener('click', e => { const r = e.target.closest('tr[data-id]'); if (r) select(+r.dataset.id); });

  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('dragging'); }));
  dz.addEventListener('drop', e => addFiles(e.dataTransfer.files));
  // Dropping anywhere else on the page should not navigate away.
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); if (!dz.contains(e.target)) addFiles(e.dataTransfer.files); });

  // Sync the slider with the detector default and preload the default model.
  $('scoreInput').value = TC.DEFAULTS.minScore;
  $('scoreOut').textContent = TC.DEFAULTS.minScore.toFixed(2);
  $('tilesInput').checked = TC.DEFAULTS.tiles;
  $('modelSelect').addEventListener('change', () => getModel(settings().model).catch(() => {}));
  getModel(settings().model).catch(err => console.error(err));
  render();

  // ?samples=1 opens the app with the sample images already loaded (for demos).
  if (new URLSearchParams(location.search).get('samples') === '1') loadSamples();
})();
