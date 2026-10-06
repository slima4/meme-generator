/*
 * Shared meme renderer. Loaded by the browser (window.MimeoRender) and by the
 * server (require). Takes any Canvas 2D context, so preview, export and the
 * /api/meme endpoint all produce the same pixels.
 *
 * spec = { boxes: [{ text, x, y, w, size, fill, stroke, upper }] }
 *   x, y  center of the text block, as fractions of image width / height
 *   w     max line width, fraction of image width
 *   size  starting font size, fraction of image width (shrinks to fit)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MimeoRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const FONT_FAMILY = 'Anton, Impact, "Arial Narrow", sans-serif';
  const MIN_PX = 10;
  const MAX_BLOCK_H = 0.45; // fraction of image height one box may fill

  function defaultBox(over) {
    return Object.assign(
      { text: '', x: 0.5, y: 0.5, w: 0.92, size: 0.1, fill: '#ffffff', stroke: '#000000', upper: true },
      over
    );
  }

  // Top/bottom for two boxes, evenly spaced columns of rows for more.
  // layout (optional) is a per-template list of { x, y, w, size, fill, stroke } overrides, by box index.
  function defaultBoxes(count, layout) {
    const n = Math.max(1, Math.min(8, count | 0 || 2));
    const boxes = n === 1
      ? [defaultBox({ y: 0.1 })]
      : Array.from({ length: n }, (_, i) => defaultBox({ y: 0.1 + (0.8 * i) / (n - 1) }));
    if (Array.isArray(layout)) {
      layout.forEach((l, i) => {
        if (!boxes[i] || !l) return;
        for (const k of ['x', 'y', 'w', 'size']) if (typeof l[k] === 'number') boxes[i][k] = l[k];
        for (const k of ['fill', 'stroke']) if (typeof l[k] === 'string') boxes[i][k] = l[k];
      });
    }
    return boxes;
  }

  function wrap(ctx, text, maxW) {
    const lines = [];
    for (const para of text.split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(''); continue; }
      let line = words[0];
      for (let i = 1; i < words.length; i++) {
        const next = line + ' ' + words[i];
        if (ctx.measureText(next).width <= maxW) line = next;
        else { lines.push(line); line = words[i]; }
      }
      lines.push(line);
    }
    return lines;
  }

  function fit(ctx, text, startPx, maxW, maxH) {
    let px = Math.max(MIN_PX, Math.round(startPx));
    for (;;) {
      ctx.font = px + 'px ' + FONT_FAMILY;
      const lines = wrap(ctx, text, maxW);
      const lh = px * 1.08;
      const widest = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
      if ((widest <= maxW && lines.length * lh <= maxH) || px <= MIN_PX) return { px, lines, lh, widest };
      px = Math.max(MIN_PX, Math.floor(px * 0.94));
    }
  }

  /**
   * Draws img (or a flat fill if img is null) and all text boxes.
   * Returns one { x, y, w, h } rect (canvas px) per box, for hit testing.
   * opts.selected + opts.guides draw a dashed outline around one box; leave
   * them off for export.
   */
  function drawMeme(ctx, img, W, H, spec, opts) {
    opts = opts || {};
    ctx.clearRect(0, 0, W, H);
    if (img) ctx.drawImage(img, 0, 0, W, H);
    else { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    const rects = [];
    (spec.boxes || []).forEach((b) => {
      b = defaultBox(b);
      const raw = String(b.text || '');
      const text = b.upper ? raw.toUpperCase() : raw;
      const maxW = b.w * W;
      const empty = !text.trim();
      const f = fit(ctx, empty ? 'X' : text, b.size * W, maxW, H * MAX_BLOCK_H);
      const stroke = f.px * 0.09;
      const bw = (empty ? maxW * 0.6 : f.widest) + stroke * 2;
      const bh = (empty ? f.lh : f.lines.length * f.lh) + stroke;
      const cx = Math.min(Math.max(b.x * W, bw / 2), W - bw / 2);
      const cy = Math.min(Math.max(b.y * H, bh / 2), H - bh / 2);
      rects.push({ x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh });
      if (empty) return;

      ctx.font = f.px + 'px ' + FONT_FAMILY;
      ctx.lineWidth = stroke * 2;
      ctx.strokeStyle = b.stroke;
      ctx.fillStyle = b.fill;
      const top = cy - (f.lines.length * f.lh) / 2;
      f.lines.forEach((line, li) => {
        const ly = top + f.lh * (li + 0.5);
        if (b.stroke && b.stroke !== 'none') ctx.strokeText(line, cx, ly);
        ctx.fillText(line, cx, ly);
      });
    });

    const sel = opts.guides ? rects[opts.selected] : null;
    if (sel) {
      const unit = Math.max(1, W / 800);
      ctx.save();
      ctx.lineWidth = 2 * unit;
      ctx.setLineDash([6 * unit, 4 * unit]);
      ctx.strokeStyle = '#e6007e';
      ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      ctx.restore();
    }
    return rects;
  }

  return { FONT_FAMILY, defaultBox, defaultBoxes, drawMeme };
});
