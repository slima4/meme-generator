const express = require('express');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { defaultBoxes, drawMeme } = require('./public/render.js');

const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = process.env.BASE_URL || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MEMES_DIR = path.join(DATA_DIR, 'memes');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const CATALOG_FILE = path.join(CACHE_DIR, 'catalog.json');
const EXTRAS_FILE = path.join(__dirname, 'extra-templates.json');

const CATALOG_URL = 'https://api.imgflip.com/get_memes';
const CATALOG_TTL_MS = 60 * 60 * 1000;
const MAX_UPLOAD = 8 * 1024 * 1024;
const MAX_DIM = 4096;
const THUMB_W = 240;

GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'Anton-Regular.ttf'), 'Anton');

// ---------- helpers ----------

// Run at most `n` async jobs at once; callers get their own result back.
function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

// Share one in-flight promise per key.
const inflight = new Map();
function once(key, fn) {
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
  return inflight.get(key);
}

const exists = (p) => fs.access(p).then(() => true, () => false);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- template catalog ----------

let remote = []; // imgflip top 100
let extras = []; // from extra-templates.json
let catalogAt = 0;

// Extras first, so they are easy to find; an extra wins over a remote entry with the same id.
const allTemplates = () => [...extras, ...remote.filter((t) => !extras.some((e) => e.id === t.id))];

// Optional per-box text placement: [{ x, y, w?, size?, fill?, stroke? }]. Numbers are fractions in
// 0..1, colors are #hex. An invalid layout is dropped whole.
function cleanLayout(layout, id) {
  if (layout === undefined) return undefined;
  const frac = (v) => v === undefined || (typeof v === 'number' && v >= 0 && v <= 1);
  const color = (v) => v === undefined || (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v));
  const ok = Array.isArray(layout) && layout.every((l) => l && typeof l === 'object'
    && ['x', 'y', 'w', 'size'].every((k) => frac(l[k])) && ['fill', 'stroke'].every((k) => color(l[k])));
  if (!ok) {
    console.warn('extra-templates.json: ignoring invalid layout for', id);
    return undefined;
  }
  return layout.map((l) => ({ x: l.x, y: l.y, w: l.w, size: l.size, fill: l.fill, stroke: l.stroke }));
}

async function loadExtras() {
  try {
    const list = JSON.parse(await fs.readFile(EXTRAS_FILE, 'utf8'));
    extras = list.filter((t) => {
      const ok = t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.url === 'string' && /^https:\/\//.test(t.url);
      if (!ok) console.warn('extra-templates.json: skipping invalid entry', JSON.stringify(t));
      return ok;
    }).map((t) => ({ id: t.id, name: t.name, url: t.url, width: t.width, height: t.height, boxes: t.boxes || 2, layout: cleanLayout(t.layout, t.id) }));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('extra-templates.json unreadable:', e.message);
  }
}

async function refreshCatalog() {
  const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('catalog HTTP ' + res.status);
  const json = await res.json();
  if (!json.success) throw new Error('catalog refused');
  remote = json.data.memes.map((m) => ({
    id: String(m.id),
    name: String(m.name),
    url: String(m.url),
    width: m.width,
    height: m.height,
    boxes: m.box_count,
  }));
  catalogAt = Date.now();
  // Disk copy is only a fallback for offline starts; failing to write it is not fatal.
  fs.mkdir(CACHE_DIR, { recursive: true })
    .then(() => fs.writeFile(CATALOG_FILE, JSON.stringify(remote)))
    .catch((e) => console.warn('could not cache catalog:', e.message));
}

async function loadCatalog() {
  await loadExtras();
  try {
    remote = JSON.parse(await fs.readFile(CATALOG_FILE, 'utf8'));
  } catch { /* first run */ }
  try {
    await refreshCatalog();
  } catch (e) {
    console.warn('template catalog unavailable:', e.message, remote.length ? '(using cached copy)' : '(upload-only mode)');
  }
  setInterval(() => refreshCatalog().catch((e) => console.warn('catalog refresh failed:', e.message)), CATALOG_TTL_MS).unref();
}

const findTemplate = (id) => allTemplates().find((t) => t.id === id);

// ---------- template images (fetched by catalog id only, never by caller URL) ----------

const fetchLimit = limiter(6);

async function templateImage(t, thumb) {
  const dir = path.join(CACHE_DIR, thumb ? 'thumb' : 'src');
  const file = path.join(dir, t.id + '.jpg');
  if (await exists(file)) return fs.readFile(file);

  return once(file, () => fetchLimit(async () => {
    if (await exists(file)) return fs.readFile(file);
    const host = new URL(t.url).hostname;
    if (host !== 'imgflip.com' && !host.endsWith('.imgflip.com')) throw new Error('unexpected host ' + host);
    const res = await fetch(t.url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('image HTTP ' + res.status);
    let buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 15 * 1024 * 1024) throw new Error('image too large');

    if (thumb) {
      const img = await loadImage(buf);
      const w = Math.min(THUMB_W, img.width);
      const h = Math.round((img.height * w) / img.width);
      const c = createCanvas(w, h);
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      buf = c.toBuffer('image/jpeg', 80);
    }
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, buf);
    return buf;
  }));
}

// ---------- app ----------

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/fonts', express.static(path.join(__dirname, 'fonts'), { maxAge: '30d' }));

app.get('/api/templates', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ templates: allTemplates(), updated: catalogAt });
});

app.get('/api/img/:id', async (req, res) => {
  const t = findTemplate(req.params.id);
  if (!t) return res.status(404).json({ error: 'unknown template' });
  try {
    const buf = await templateImage(t, req.query.thumb !== undefined);
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' }).send(buf);
  } catch (e) {
    console.warn('template image failed:', t.id, e.message);
    res.status(502).json({ error: 'could not fetch template image' });
  }
});

// GET /api/meme?template=181913649&text=top&text=bottom[&format=jpg]
app.get('/api/meme', async (req, res) => {
  const t = findTemplate(String(req.query.template || ''));
  if (!t) return res.status(404).json({ error: 'unknown template; see /api/templates' });
  const texts = [].concat(req.query.text || []).slice(0, 8).map((s) => String(s).slice(0, 200));
  const boxes = defaultBoxes(Math.max(texts.length, t.boxes || 2), t.layout).map((b, i) => ({ ...b, text: texts[i] || '' }));
  try {
    const img = await loadImage(await templateImage(t, false));
    const c = createCanvas(img.width, img.height);
    drawMeme(c.getContext('2d'), img, img.width, img.height, { boxes });
    const jpg = req.query.format === 'jpg';
    res.set({ 'Content-Type': jpg ? 'image/jpeg' : 'image/png', 'Cache-Control': 'public, max-age=3600' });
    res.send(jpg ? c.toBuffer('image/jpeg', 90) : c.toBuffer('image/png'));
  } catch (e) {
    console.warn('render failed:', e.message);
    res.status(502).json({ error: 'render failed' });
  }
});

// ---------- saved memes (unlisted: reachable only by link) ----------

const hits = new Map(); // ip -> timestamps
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((ts) => now - ts < 10 * 60 * 1000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 30;
}
setInterval(() => { for (const [ip, ts] of hits) if (Date.now() - ts[ts.length - 1] > 600000) hits.delete(ip); }, 600000).unref();

const ID_RE = /^[A-Za-z0-9_-]{8}$/;
const origin = (req) => BASE_URL || `${req.protocol}://${req.get('host')}`;

app.post('/api/memes', express.raw({ type: 'image/png', limit: MAX_UPLOAD }), async (req, res) => {
  if (rateLimited(req.ip)) return res.status(429).json({ error: 'slow down' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(415).json({ error: 'send image/png body' });
  try {
    const img = await loadImage(req.body);
    if (img.width > MAX_DIM || img.height > MAX_DIM) return res.status(413).json({ error: `max ${MAX_DIM}px per side` });
    // Re-encode so only decoded pixels are stored, no trailing bytes or metadata.
    const c = createCanvas(img.width, img.height);
    c.getContext('2d').drawImage(img, 0, 0);
    const id = crypto.randomBytes(6).toString('base64url').slice(0, 8);
    await fs.mkdir(MEMES_DIR, { recursive: true });
    await fs.writeFile(path.join(MEMES_DIR, id + '.png'), c.toBuffer('image/png'));
    res.status(201).json({ id, page: `${origin(req)}/m/${id}`, image: `${origin(req)}/memes/${id}.png` });
  } catch {
    res.status(400).json({ error: 'not a valid PNG' });
  }
});

app.get('/memes/:file', (req, res) => {
  const m = /^([A-Za-z0-9_-]{8})\.png$/.exec(req.params.file);
  if (!m) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(m[1] + '.png', { root: MEMES_DIR }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

app.get('/m/:id', async (req, res) => {
  if (!ID_RE.test(req.params.id) || !(await exists(path.join(MEMES_DIR, req.params.id + '.png')))) {
    return res.status(404).type('text').send('No such meme.');
  }
  const img = `${origin(req)}/memes/${req.params.id}.png`;
  res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Meme · Mimeo</title>
<meta property="og:type" content="website"><meta property="og:title" content="A meme made on Mimeo">
<meta property="og:image" content="${esc(img)}"><meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/share.css"></head>
<body><main><img src="/memes/${req.params.id}.png" alt="Meme">
<p><a href="/">Make your own</a> · <a href="/memes/${req.params.id}.png" download="meme.png">Download</a></p></main></body></html>`);
});

if (require.main === module) {
  loadCatalog().then(() => app.listen(PORT, () => console.log(`Mimeo on http://localhost:${PORT} (${allTemplates().length} templates)`)));
}

module.exports = { app };
