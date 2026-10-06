(() => {
  const R = window.MimeoRender;
  const $ = (s) => document.querySelector(s);
  const cv = $('#cv');
  const ctx = cv.getContext('2d');
  const MAX_SIDE = 1600;
  const MAX_BOXES = 8;

  const state = {
    img: null,
    W: cv.width,
    H: cv.height,
    boxes: R.defaultBoxes(2),
    sel: 0,
    rects: [],
    templateId: null,
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---------- drawing ----------

  let raf = 0;
  function draw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      state.rects = R.drawMeme(ctx, state.img, state.W, state.H, { boxes: state.boxes }, { guides: true, selected: state.sel });
    });
  }

  function exportBlob() {
    const c = document.createElement('canvas');
    c.width = state.W;
    c.height = state.H;
    R.drawMeme(c.getContext('2d'), state.img, state.W, state.H, { boxes: state.boxes });
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png'));
  }

  function setImage(img) {
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    state.W = Math.round(img.naturalWidth * k);
    state.H = Math.round(img.naturalHeight * k);
    cv.width = state.W;
    cv.height = state.H;
    state.img = img;
    $('#hint').hidden = true;
    for (const id of ['download', 'copy', 'share']) $('#' + id).disabled = false;
    draw();
  }

  document.fonts.load('40px Anton').then(draw, () => {});

  // ---------- status line ----------

  const statusEl = $('#status');
  function say(msg) { statusEl.textContent = msg; }

  // ---------- text boxes ----------

  const list = $('#boxes');
  const ctl = { size: $('#size'), fill: $('#fill'), stroke: $('#stroke'), upper: $('#upper') };

  function placeholder(i, n) {
    if (n === 2) return i === 0 ? 'Top text' : 'Bottom text';
    return 'Text ' + (i + 1);
  }

  function renderBoxes() {
    list.textContent = '';
    const n = state.boxes.length;
    state.boxes.forEach((b, i) => {
      const li = document.createElement('li');
      const num = document.createElement('span');
      num.className = 'n';
      num.textContent = String(i + 1).padStart(2, '0');

      const input = document.createElement('input');
      input.type = 'text';
      input.value = b.text;
      input.maxLength = 200;
      input.placeholder = placeholder(i, n);
      input.setAttribute('aria-label', 'Text ' + (i + 1));
      input.addEventListener('focus', () => select(i));
      input.addEventListener('input', () => { b.text = input.value; draw(); });

      const del = document.createElement('button');
      del.className = 'del';
      del.type = 'button';
      del.textContent = '×';
      del.disabled = n === 1;
      del.setAttribute('aria-label', 'Remove text ' + (i + 1));
      del.addEventListener('click', () => {
        state.boxes.splice(i, 1);
        state.sel = clamp(state.sel > i ? state.sel - 1 : state.sel, 0, state.boxes.length - 1);
        renderBoxes();
      });

      li.append(num, input, del);
      list.append(li);
    });
    $('#add').disabled = n >= MAX_BOXES;
    select(clamp(state.sel, 0, n - 1));
  }

  function select(i) {
    state.sel = i;
    [...list.children].forEach((li, j) => li.classList.toggle('on', j === i));
    const b = R.defaultBox(state.boxes[i]);
    ctl.size.value = Math.round(b.size * 100);
    ctl.fill.value = b.fill;
    ctl.stroke.value = b.stroke;
    ctl.upper.checked = b.upper;
    draw();
  }

  ctl.size.addEventListener('input', () => { state.boxes[state.sel].size = ctl.size.value / 100; draw(); });
  ctl.fill.addEventListener('input', () => { state.boxes[state.sel].fill = ctl.fill.value; draw(); });
  ctl.stroke.addEventListener('input', () => { state.boxes[state.sel].stroke = ctl.stroke.value; draw(); });
  ctl.upper.addEventListener('change', () => { state.boxes[state.sel].upper = ctl.upper.checked; draw(); });

  $('#add').addEventListener('click', () => {
    if (state.boxes.length >= MAX_BOXES) return;
    state.boxes.push(R.defaultBox({ y: 0.5 }));
    state.sel = state.boxes.length - 1;
    renderBoxes();
    list.children[state.sel].querySelector('input').focus();
  });

  $('#reset').addEventListener('click', () => {
    const t = templates.find((x) => x.id === state.templateId);
    R.defaultBoxes(state.boxes.length, t && t.layout).forEach((d, i) => Object.assign(state.boxes[i], { x: d.x, y: d.y, w: d.w }));
    draw();
  });

  // New box set for a template, keeping whatever the user already typed.
  function boxesFor(count, layout) {
    const old = state.boxes;
    let last = -1;
    old.forEach((b, i) => { if (b.text.trim()) last = i; });
    const fresh = R.defaultBoxes(Math.max(count, last + 1), layout);
    fresh.forEach((b, i) => { if (old[i]) b.text = old[i].text; });
    return fresh;
  }

  // ---------- dragging text on the canvas ----------

  let drag = null;

  function toCanvas(e) {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * state.W) / r.width, y: ((e.clientY - r.top) * state.H) / r.height };
  }

  function hit(p) {
    const pad = (8 * state.W) / 800;
    for (let i = state.rects.length - 1; i >= 0; i--) {
      const r = state.rects[i];
      if (p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad) return i;
    }
    return -1;
  }

  cv.addEventListener('pointerdown', (e) => {
    const p = toCanvas(e);
    const i = hit(p);
    if (i < 0) return;
    const b = state.boxes[i];
    drag = { i, dx: b.x - p.x / state.W, dy: b.y - p.y / state.H };
    cv.setPointerCapture(e.pointerId);
    cv.style.cursor = 'grabbing';
    select(i);
    list.children[i].querySelector('input').blur();
    e.preventDefault();
  });

  cv.addEventListener('pointermove', (e) => {
    const p = toCanvas(e);
    if (!drag) { cv.style.cursor = hit(p) >= 0 ? 'grab' : 'default'; return; }
    const b = state.boxes[drag.i];
    b.x = clamp(p.x / state.W + drag.dx, 0, 1);
    b.y = clamp(p.y / state.H + drag.dy, 0, 1);
    draw();
  });

  const endDrag = () => { drag = null; cv.style.cursor = 'default'; };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  cv.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!move) return;
    const b = state.boxes[state.sel];
    b.x = clamp(b.x + move[0], 0, 1);
    b.y = clamp(b.y + move[1], 0, 1);
    draw();
    e.preventDefault();
  });

  // ---------- templates ----------

  let templates = [];
  let loadToken = 0;
  const tlist = $('#tlist');
  const tstatus = $('#tstatus');

  async function loadTemplate(t) {
    const token = ++loadToken;
    say('Loading ' + t.name + '…');
    const img = new Image();
    img.src = '/api/img/' + encodeURIComponent(t.id);
    try {
      await img.decode();
    } catch {
      if (token === loadToken) say('Could not load that template. Try another or upload your own.');
      return;
    }
    if (token !== loadToken) return; // a newer click won
    state.templateId = t.id;
    state.boxes = boxesFor(t.boxes || 2, t.layout);
    state.sel = 0;
    setImage(img);
    renderBoxes();
    markActive();
    say('');
  }

  function markActive() {
    for (const btn of tlist.querySelectorAll('button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.id === state.templateId));
    }
  }

  function renderTemplates() {
    const frag = document.createDocumentFragment();
    for (const t of templates) {
      const li = document.createElement('li');
      li.dataset.name = t.name.toLowerCase();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.id = t.id;
      btn.setAttribute('aria-pressed', 'false');
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.width = 240;
      img.height = 240;
      img.alt = '';
      img.src = '/api/img/' + encodeURIComponent(t.id) + '?thumb';
      const name = document.createElement('span');
      name.textContent = t.name;
      name.title = t.name;
      btn.append(img, name);
      btn.addEventListener('click', () => loadTemplate(t));
      li.append(btn);
      frag.append(li);
    }
    tlist.replaceChildren(frag);
  }

  $('#tsearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    let shown = 0;
    for (const li of tlist.children) {
      const match = !q || li.dataset.name.includes(q);
      li.hidden = !match;
      if (match) shown++;
    }
    tstatus.textContent = shown ? '' : 'No template matches “' + e.target.value.trim() + '”.';
  });

  async function boot() {
    renderBoxes();
    try {
      const res = await fetch('/api/templates');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      templates = (await res.json()).templates;
    } catch {
      templates = [];
    }
    if (!templates.length) {
      tstatus.textContent = 'Template catalog offline. Upload your own image.';
      return;
    }
    renderTemplates();
    loadTemplate(templates[0]);
  }

  // ---------- own images: file picker, drop, paste ----------

  async function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) { say('That is not an image file.'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      say('Could not read that image.');
      return;
    }
    ++loadToken; // cancel any template still loading
    state.templateId = null;
    setImage(img);
    markActive();
    say('');
  }

  $('#file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });

  const sheet = $('#sheet');
  for (const type of ['dragenter', 'dragover']) {
    sheet.addEventListener(type, (e) => { e.preventDefault(); sheet.classList.add('over'); });
  }
  sheet.addEventListener('dragleave', (e) => { if (!sheet.contains(e.relatedTarget)) sheet.classList.remove('over'); });
  sheet.addEventListener('drop', (e) => {
    e.preventDefault();
    sheet.classList.remove('over');
    loadFile(e.dataTransfer.files[0]);
  });

  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); loadFile(item.getAsFile()); }
  });

  // ---------- output ----------

  $('#download').addEventListener('click', async () => {
    try {
      const blob = await exportBlob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mimeo-' + Date.now() + '.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch { say('Could not export the image.'); }
  });

  $('#copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': exportBlob() })]);
      say('Image copied.');
    } catch { say('Copy not allowed here. Use Download instead.'); }
  });

  $('#share').addEventListener('click', async () => {
    const btn = $('#share');
    btn.disabled = true;
    say('Uploading…');
    try {
      const res = await fetch('/api/memes', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: await exportBlob() });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'HTTP ' + res.status);
      statusEl.textContent = '';
      const a = document.createElement('a');
      a.href = json.page;
      a.textContent = json.page;
      a.target = '_blank';
      a.rel = 'noopener';
      statusEl.append('Link: ', a, ' (anyone with it can view)');
      navigator.clipboard?.writeText(json.page).catch(() => {});
    } catch (e) {
      say('Share failed: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  });

  boot();
})();
