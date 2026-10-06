const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mimeo-test-'));
const { app } = require('../server.js');
const { defaultBoxes, drawMeme } = require('../public/render.js');

let server, base;
test.before(() => new Promise((resolve) => {
  server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
}));
test.after(() => { server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

const png = (w, h) => {
  const c = createCanvas(w, h);
  c.getContext('2d').fillRect(0, 0, w, h);
  return c.toBuffer('image/png');
};

test('defaultBoxes spreads boxes top to bottom', () => {
  const ys = defaultBoxes(3).map((b) => b.y);
  assert.deepEqual(ys, [0.1, 0.5, 0.9]);
});

test('defaultBoxes applies per-template layout and ignores junk', () => {
  const boxes = defaultBoxes(2, [{ x: 0.2, y: 0.3, w: 0.4, size: 0.07 }, null, { x: 0.9 }]);
  assert.deepEqual([boxes[0].x, boxes[0].y, boxes[0].w, boxes[0].size], [0.2, 0.3, 0.4, 0.07]);
  assert.deepEqual([boxes[1].x, boxes[1].y], [0.5, 0.9]);
  assert.equal(boxes.length, 2);
  assert.equal(defaultBoxes(2, 'nope')[0].y, 0.1);
  const colored = defaultBoxes(2, [{ fill: '#000000', stroke: '#ffffff' }]);
  assert.deepEqual([colored[0].fill, colored[0].stroke], ['#000000', '#ffffff']);
  assert.deepEqual([colored[1].fill, colored[1].stroke], ['#ffffff', '#000000']);
});

test('drawMeme returns one rect per box, kept inside the canvas', () => {
  const c = createCanvas(400, 300);
  const boxes = defaultBoxes(2).map((b, i) => ({ ...b, text: 'a fairly long caption that has to wrap and shrink ' + i, x: 1, y: i }));
  const rects = drawMeme(c.getContext('2d'), null, 400, 300, { boxes });
  assert.equal(rects.length, 2);
  for (const r of rects) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 400.001 && r.y + r.h <= 300.001, JSON.stringify(r));
  }
});

test('POST /api/memes stores a PNG and serves it back', async () => {
  const res = await fetch(base + '/api/memes', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png(64, 48) });
  assert.equal(res.status, 201);
  const { id } = await res.json();
  assert.match(id, /^[A-Za-z0-9_-]{8}$/);
  const img = await fetch(`${base}/memes/${id}.png`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${base}/m/${id}`)).status, 200);
});

test('POST /api/memes rejects junk and wrong content types', async () => {
  const junk = await fetch(base + '/api/memes', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: 'not a png' });
  assert.equal(junk.status, 400);
  const wrong = await fetch(base + '/api/memes', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
  assert.equal(wrong.status, 415);
});

test('unknown ids and templates 404', async () => {
  assert.equal((await fetch(base + '/m/zzzzzzzz')).status, 404);
  assert.equal((await fetch(base + '/memes/..%2F..%2Fserver.js')).status, 404);
  assert.equal((await fetch(base + '/api/meme?template=nope')).status, 404);
  assert.equal((await fetch(base + '/api/img/nope')).status, 404);
});
