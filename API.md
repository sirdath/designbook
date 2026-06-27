# Design Book — HTTP API

The reference for building a UI on top of Design Book. The server is a plain
`node:http` app (vanilla ESM, no framework) listening on **`http://localhost:4747`**
(`PORT` to change). A UI is just a client of this REST API plus an SSE stream.

```sh
git clone --recurse-submodules https://github.com/sirdath/designbook.git
cd designbook && node server.js          # → http://localhost:4747
```

There's already a reference UI shell in [`ui/`](ui/) served at `/` — read it for a
working example, or build your own against the contract below.

## Conventions

- **Requests**: JSON bodies (`Content-Type: application/json`). Query params on GETs.
- **Responses**: JSON. Errors are `{ "error": "message" }` with a 4xx/5xx status
  (400 bad input · 404 not found · 503 model/auth unavailable · 500 internal).
- **Auth for model calls**: `compose`, `inspect` (facts), `search` etc. are **free**
  (no model, no tokens). `critique`, `refine`, `chat`, `generate*`, `video-critique`
  hit a model — they 503 if no credential is configured. Check `/api/health.auth`.
- **Static assets**: rendered screenshots and videos are served at
  `/book/shots/<file>` (the inspect/render responses return ready-to-use URLs).
- **CORS**: open (`Access-Control-Allow-Origin: *`).
- **Live progress**: subscribe to **`GET /api/events`** (SSE) for render progress,
  chat tokens, and brief updates.

---

## Meta & search (free)

### `GET /api/health`
Liveness + capability probe.
→ `{ ok, vault, snippets, palettes, presets, hasKey, auth: "subscription"|"api-key"|null, baseUrl }`

### `GET /api/meta`
Everything a UI needs to populate pickers.
→ `{ genres[], mobileGenres[], presets[{name,label,aesthetic,palette,fontPair,motion,density,summary}], palettes[{name,mode,group,accent,bg}], aesthetics[], densities[], motions[], fontPairs[], viewports[{name,width,height,dpr,...}], defaultViewports[], settings }`

### `GET /api/search?q=<text>&limit=<n>`
Search the vault snippet index. → `{ hits: [{ path, score, description, global? }] }`

### `GET /api/snippet?path=<vault/path>`
Raw source of one snippet. → `{ path, source }` (404 if not in INDEX).

---

## Compose — deterministic drafts (free, instant)

### `POST /api/compose`
Body: `{ genre (required), preset?, seed?, taste?{palette,aesthetic,motion,density,fontPair}, intent? }`
→ `{ html, theme, coherence: { score, ok, findings[], ... } }`
The core draft: a full page composed from the vault. Free, no tokens.

### `POST /api/variants`
Body: `{ genre (required), seeds?:[0,1,2], overrides? }`
→ `{ variants: [{ seed, html, theme, coherence }] }` — N drafts to choose from.

### `POST /api/coherence`
Body: `{ html }` → the coherence/authenticity report for arbitrary HTML.

---

## Pages — saved designs (CRUD, free)

| Method | Path | Body / Result |
|---|---|---|
| `GET` | `/api/pages` | → `{ pages: [manifest] }` |
| `POST` | `/api/pages` | `{ html, title\|slug, ... }` → `{ manifest }` |
| `GET` | `/api/pages/:slug` | → `{ html, manifest, ... }` |
| `PUT` | `/api/pages/:slug` | `{ ... }` → `{ manifest }` |
| `DELETE` | `/api/pages/:slug` | → `{ ok: true }` |

`:slug` is `[a-z0-9-]+`. Pages persist as plain files under `book/`.

---

## The MOAT — verify a page (render → facts → taste → fix)

### `POST /api/inspect` *(free — headless Chrome, no model)*
Body: `{ html | slug, mode?, viewports?, screenshot?, fullPage?, selector? }`
- `mode`: `layout` (default, fit facts) · `perf` · `diagnose` (full audit: console
  errors, 404s, contrast, a11y, invisible/collapsed content, **layout symmetry**) ·
  `element` (one `selector`) · `mobile` (HIG facts) · `taste` (look-good-as-facts).
- `screenshot:true` returns `reports[].screenshotUrl` (`/book/shots/...`).
→ `{ reports: [{ viewport, score, summary, layout, a11y, ... }], ... }`

### `POST /api/critique` *(model — vision taste score)*
Body: `{ html | slug, label? }` → renders the page, a vision model scores the pixels
against the Awwwards rubric. → `{ score, dimensions, notes, screenshotUrl, ... }`

### `POST /api/refine` *(model — generative pass)*
Body: `{ html | slug, instruction?, critique?, verify?, patch? }`
Applies critique findings (+ optional instruction). `patch` defaults to a safe CSS
overlay; set `patch:false` for a full rewrite. `verify:true` returns a before/after
score delta. → `{ html, ...delta }`

---

## Imagery & generation (model)

- `POST /api/generate` — bespoke generation for a brief.
- `POST /api/generate-image` `{ prompt, ... }` → image asset; `GET /api/generate-image` polls status.
- `POST /api/autofill-imagery` `{ html|slug, ... }` — fill a page's image slots.

---

## Video — SaaS-style product videos (the page pipeline, generalized to Remotion)

The plan is the single source of truth (deterministic JSON of scenes). Render/critique
need the isolated `remotion-studio/` install; they return `{ skipped:true }` if absent.

### `POST /api/video-compose` *(free)*
Body: `{ genre | pageSlug | plan }` — `pageSlug` clones a saved page into the video's
product-showcase scene. → `{ plan, coherence }`

### `POST /api/video-inspect` *(free)* — facts about the plan/render.
### `POST /api/video-critique` *(model)* — vision taste critique of keyframes.
### `POST /api/video-refine` *(model)* — `{ plan, critique?, instruction?, verify? }` → edited plan.
### `POST /api/video-render` — `{ plan | genre | pageSlug }` → `{ ok, slug, url, bytes, durationFrames, dimensions }` (mp4 at `/book/shots/...`). Streams progress on SSE (`{type:'video-render', slug, progress}`).
### `GET /api/video-render` — `{ available }` (is the Remotion install present).

> A structured **`/api/video-diagnose`** (deterministic motion + audio + structure +
> per-scene vision → one scored report) is in active development and will land here.

---

## Export, settings, chat, events

- `GET /api/export.zip` — download a page bundle. `POST /api/export` `{ ... }`, `POST /api/export-pptx`, `POST /api/lottie-check`.
- `GET /api/settings` · `PUT /api/settings` — engine/model config.
- `POST /api/briefs` `{ text, slug?, context? }` — natural-language → routed action
  (smalltalk / taste-only / free draft / edit / queued model work). `GET /api/briefs?status=`.
- `POST /api/chat` — the agent chat loop (tokens stream over SSE).
- `GET /api/events` — **SSE**: `video-render` progress, chat tokens, brief updates. Subscribe once; render a live UI from it.

---

## Suggested UI flows

- **Draft → save → verify**: `POST /api/compose` → preview `html` in an iframe →
  `POST /api/pages` → `POST /api/inspect?mode=diagnose` (show findings incl. symmetry)
  → `POST /api/critique` (taste score) → `POST /api/refine` (apply) → re-inspect.
- **Variant picker**: `POST /api/variants` → grid of iframes → save the chosen seed.
- **Video studio**: `POST /api/video-compose` → edit scene props → `POST /api/video-render`
  (subscribe to SSE for the progress bar) → play the `url`.

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) for internals and the MCP tool surface
(`designbook-mcp/`) if you'd rather drive it from an agent than the HTTP API.
