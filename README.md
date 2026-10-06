# Mimeo

Meme generator web service with a browser UI.

## Quick start

Needs Node 18+.

```
git clone https://github.com/slima4/meme-generator.git
cd meme-generator
npm install
npm start          # http://localhost:3000   (PORT=4000 npm start to change)
```

Open http://localhost:3000. `npm test` runs the tests.

The template list comes from the public imgflip catalog (100 popular templates) and is cached on disk. Offline, the UI falls back to upload-only.

## Making a meme

**In the browser**

1. Pick a template from the list, or upload / drop / paste your own image. Your own image never leaves the browser until you hit **Share link**.
2. Type a caption into each text box. **+ Add text** adds more boxes (max 8).
3. Drag a caption on the canvas to move it. Arrow keys nudge the selected one, Shift+arrow moves further. Set size, fill color and outline per caption. **Reset positions** puts the captions back at the template's default spots.
4. Finish with **Download PNG**, **Copy image**, or **Share link** (an unlisted page at `/m/<id>`).

**From the command line or a script**

Find a template id, then render. The server must be running.

```
# list ids and names (jq is optional, it only pretty-prints)
curl -s http://localhost:3000/api/templates | jq -r '.templates[] | "\(.id)  \(.name)"'

# render: one text= per caption box, in box order
curl -o meme.png 'http://localhost:3000/api/meme?template=181913649&text=old%20way&text=new%20way'

# let curl do the URL encoding (handles spaces, &, ?, quotes)
curl -G -o meme.png http://localhost:3000/api/meme \
  --data-urlencode 'template=354700819' \
  --data-urlencode 'text=what I see' \
  --data-urlencode 'text=what you see'
```

Add `&format=jpg` for a JPEG. Captions are capped at 200 characters each.

### Template caption positions

By default `/api/meme` puts the first caption at the top and the second at the bottom. Templates in `extra-templates.json` can place each caption where that template wants it, in the API and in the UI:

| Template | id | Caption 1 | Caption 2 |
|---|---|---|---|
| Two guys on a bus | `354700819` | over the sad guy (left) | over the happy guy (right) |
| Drake Hotline Bling | `181913649` | right of Drake rejecting (top) | right of Drake approving (bottom) |
| Drake Blank | `91998305` | same as above | same as above |
| Terminator 2 robots | `40547567` | top | bottom |

Long captions wrap and shrink to fit the box, so keep them short.

### Adding or tuning a template

Extra templates live in `extra-templates.json`: `id`, `name`, `url` on `*.imgflip.com`, `width`, `height`, `boxes`. They are listed before the catalog. Restart the server after editing.

An entry may also carry `layout`, a per-box list of `{ x, y, w, size, fill, stroke }`:

```json
"layout": [
  { "x": 0.75, "y": 0.25, "w": 0.44, "size": 0.07, "fill": "#000000", "stroke": "#ffffff" },
  { "x": 0.75, "y": 0.75, "w": 0.44, "size": 0.07, "fill": "#000000", "stroke": "#ffffff" }
]
```

- `x`, `y`: center of the caption, as a fraction of image width / height.
- `w`: max line width, fraction of image width. `size`: starting font size, fraction of image width (shrinks to fit).
- `fill`, `stroke`: `#hex` colors.
- Omitted keys keep the default. A number outside 0..1 or a non-hex color invalidates the whole layout, and the server logs a warning.
- An extra with the same `id` as a catalog template replaces it. To give a catalog template a layout, copy its entry (id, name, url, size) from `/api/templates` and add `layout`.

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

- `/api/meme` places text top/bottom (or evenly spaced for 3+ boxes) unless the template has a `layout`. The imgflip catalog has no per-template text regions, so other side-by-side templates need dragging in the UI until you add a `layout` for them in `extra-templates.json`.
- Template images belong to their respective owners; the catalog is fetched from imgflip at runtime and not redistributed here.
