# Mimeo

Meme generator web service with a browser UI.

```
npm install
npm start          # http://localhost:3000   (PORT=… to change)
npm test
```

Needs Node 18+. Template list comes from the public imgflip catalog (100 popular
templates) and is cached on disk; offline, the UI falls back to upload-only.

Extra templates live in `extra-templates.json` (`id`, `name`, `url` on `*.imgflip.com`, `width`, `height`, `boxes`). They are listed before the catalog; restart the server after editing. Currently: "Terminator 2 robots", "Two guys on a bus", "Drake Hotline Bling".

An entry may also carry `layout`, a per-box list of `{ x, y, w, size, fill, stroke }` so `/api/meme` and the UI place captions where that template wants them instead of top/bottom. The numbers are fractions of image width/height (same meaning as in `public/render.js`); `fill` and `stroke` are `#hex` colors. Omitted keys keep the default; a number outside 0..1 or a non-hex color invalidates the whole layout. An extra with the same `id` as a catalog template replaces it, so copy a catalog entry here to give it a layout.

## UI

- Pick a template, or upload / drop / paste your own image (never leaves the browser until you hit **Share link**).
- Type captions, drag them on the canvas (arrow keys nudge the selected one), set size, fill, outline.
- **Download PNG**, **Copy image**, or **Share link** (unlisted page at `/m/<id>`).

## API

| Route | |
|---|---|
| `GET /api/templates` | `{ templates: [{ id, name, width, height, boxes }] }` |
| `GET /api/meme?template=<id>&text=<top>&text=<bottom>[&format=jpg]` | Rendered meme image. Repeat `text` per box, max 8. |
| `GET /api/img/<id>[?thumb]` | Template image (cached). Looked up by catalog id only. |
| `POST /api/memes` | Body: raw `image/png`, max 8 MB / 4096 px. Returns `{ id, page, image }`. 30 per 10 min per IP. |
| `GET /m/<id>`, `GET /memes/<id>.png` | Share page (with OpenGraph tags) and the image. |

Example: `curl -o meme.png 'http://localhost:3000/api/meme?template=181913649&text=old%20way&text=new%20way'`

## Config (env)

| Var | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `DATA_DIR` | `./data` | Saved memes and the template cache. |
| `BASE_URL` | from request | Public origin used in share links / OG tags. |
| `TRUST_PROXY` | off | Express `trust proxy` value; set behind a reverse proxy so rate limiting sees client IPs. |

## Layout

- `public/render.js` — one renderer used by the browser canvas and by the server (`@napi-rs/canvas`), so previews, downloads and `/api/meme` match.
- `server.js` — Express app. `fonts/Anton-Regular.ttf` (OFL) is the caption face.
- Saved memes are unlisted (no public gallery), so nothing needs moderating.

## Known limits

- `/api/meme` places text top/bottom (or evenly spaced for 3+ boxes). The imgflip catalog has no per-template text regions, so side-by-side templates like Drake need dragging in the UI unless you add a `layout` for them in `extra-templates.json`.
- Template images belong to their respective owners; the catalog is fetched from imgflip at runtime and not redistributed here.
