# Design Book — Architecture (the contract)

A local-first "Claude Design, but better" workbench built on the frontendmaxxing
vault. Every build decision serves two goals: **token efficiency** (everything
deterministic is free and instant; the model is engaged only for bespoke work)
and **agent ergonomics** (an AI engine gets structured facts — never pixels or
blind HTML dumps — through one tool surface shared by both engines).

## Platforms — web and mobile are first-class peers

A project has a **`platform: 'web' | 'mobile'`** (in its manifest). The whole
stack branches on it, but the *spine is shared*: one book, one MCP tool surface,
one facts-lab, one image-gen, the same dual engines and save-gate. Only the
**compose model**, the **structural primitives**, and the **lab checks** differ.

| | web | mobile |
| --- | --- | --- |
| Output shape | ONE scrolling page of stacked sections | a FLOW of discrete app screens |
| Primitives | `structure/structure.css` `.s-*` shells | `structure/app-shell.css` `.scr-*` screen shells (device frame, status bar, nav, safe areas, tab bar, FAB, sheet, list rows) |
| Compose | `GENRE_SEQUENCES` → sections | `MOBILE_FLOWS` → ordered screens, each a `.scr` in a device frame |
| Components | `components/`, `blocks/`, … | `mobile/` (`app-*` screens + `ios-*` chrome) inside `.scr-*` shells |
| Canvas/lab default | desktop 1440, scaled | iPhone flow board — screens side-by-side in phone frames |
| Lab facts | overflow, tap≥44, tiny-text, contrast | the above **+ HIG**: safe-area respect (content clear of notch/home-indicator), thumb-reach (primary action in bottom third), tab-bar/nav conventions, no hover-only affordances |
| Export | single HTML / ZIP of files | the screen-flow HTML/CSS spec + design-tokens file + handoff doc (Phase-2: runnable Expo/React-Native via react-native-web) |

**What transfers unchanged:** the taste layer (palette/font/motion tokens — the
*tokens* are platform-agnostic; mobile adds its own density/tap-size scale), the
book/manifest/revisions model, `book_view`/`book_generate_image`/`book_save_asset`,
the save-gate + doom-loop guard, the briefs/agent loop.

**Tier framing (owner decision):** ship native-quality mobile *UI design* (Tier
2 — screen flows as a visual spec a dev implements) to perfection; keep the
architecture extensible so *runnable* native (Tier 3, via Expo / react-native-web
so headless Chrome stays the renderer and the facts-lab keeps working) drops in
as a later phase. Do NOT pursue raw SwiftUI/Compose needing simulators.

```
designbook/
  ARCHITECTURE.md      ← this contract (agents: read before touching anything)
  package.json         ← type:module; zero-dep core; @anthropic-ai/claude-agent-sdk optional
  server.js            ← node:http app server (API + SSE + static)  [CORE]
  lib/vault.js         ← bridge into frontendmaxxing pure helpers   [CORE]
  lib/book.js          ← pages/briefs/settings store (plain files)  [CORE]
  lib/inspect.js       ← viewport lab: headless multi-display facts [CORE]
  engines/sdk.js       ← SDK engine (lazy-loaded, optional dep)
  designbook-mcp/      ← MCP server exposing the book to Claude Code (stdio→HTTP)
    server.js
    package.json
  ui/                  ← vanilla static app (dogfoods the vault's taste layer)
    index.html  app.js  app.css
  book/                ← THE USER'S DATA (gitignorable, portable, plain files)
    book.json          ← collection meta
    briefs.json        ← work queue
    settings.json      ← engine prefs (never the API key; key comes from env)
    pages/<slug>/      ← index.html + manifest.json + revisions/<n>.html
    shots/             ← inspect screenshots (only when explicitly requested)
```

## Layered design — "deterministic core, model shell"

- **Layer 0 (free, instant, no model):** compose drafts, variant matrices,
  taste re-theming, palette/preset metadata, coherence scoring, viewport
  inspection, page CRUD. Implemented in-process by importing frontendmaxxing's
  exported pure helpers (`composePage`, `checkCoherence`, `buildSearchIndex`,
  `parsePalettes`, …) from `<vault>/mcp-server/server.js`. No MCP round-trips.
- **Layer 1 (model, optional):** bespoke copy/sections/components. Reached via
  ONE tool surface (the designbook MCP tools) used by BOTH engines:
  - **Engine "mcp" (Claude Code / subscription):** the user's own Claude Code
    session connects to `designbook-mcp`; it claims queued briefs, drafts via
    `book_compose`, checks across devices via `book_inspect`, saves via
    `book_save_page`.
  - **Engine "sdk" (API credits):** `engines/sdk.js` runs the Agent SDK with
    `mcpServers: { designbook: … }` — the SDK agent uses the SAME tools. Engine
    parity is a hard invariant: any new capability = a new MCP tool + (maybe) a
    UI affordance, never an engine-specific path.

## Vault resolution

`FRONTENDMAXXING_PATH` env var, else `../frontendmaxxing` relative to
designbook/. Fail fast with a clear message if `INDEX.md` is missing.

## HTTP API (server.js, default port 4747)

All endpoints JSON unless noted. Errors: `{ error: string }` + 4xx/5xx.

| Method/Path | In → Out |
| --- | --- |
| GET `/api/health` | → `{ ok, vault, snippets, palettes, presets }` |
| GET `/api/meta` | → `{ genres[], presets[], palettes[], aesthetics[], densities[], motions[], fontPairs[], viewports[] }` |
| POST `/api/compose` | `{ genre, preset?, palette?, aesthetic?, density?, motion?, fontPair?, seed? }` → `{ html, theme, sections[], warnings[], coherence:{score,counts} }` |
| POST `/api/variants` | `{ genre, preset?, overrides?, seeds:[int] }` → `{ variants:[{ seed, html, theme, coherence }] }` |
| POST `/api/coherence` | `{ html }` → `{ score, ok, counts, warnings[] }` |
| GET `/api/search?q=&limit=` | → `{ hits:[{ path, score, description, global? }] }` |
| GET `/api/snippet?path=` | → `{ path, source }` |
| GET `/api/pages` | → `{ pages:[manifest] }` |
| GET `/api/pages/<slug>` | → `{ manifest, html }` |
| POST `/api/pages` | `{ slug?, title, html, manifest? }` → `{ manifest }` (slugify title if no slug; writes revision) |
| PUT `/api/pages/<slug>` | `{ title?, html?, manifest? }` → `{ manifest }` (bumps revision, archives prior html) |
| DELETE `/api/pages/<slug>` | → `{ ok }` |
| GET `/api/briefs` | → `{ briefs:[] }` |
| POST `/api/briefs` | `{ text, engine?, pageSlug? }` → `{ brief }` (status `queued`) |
| PUT `/api/briefs/<id>` | `{ status?, summary?, pageSlug? }` → `{ brief }` |
| POST `/api/generate` | `{ briefId }` → runs the SDK engine on a queued brief → `{ brief }` (or `{ error }` if SDK unavailable) |
| POST `/api/inspect` | `{ slug? \| html?, viewports?:[name], screenshot?:bool }` → `{ reports:[ViewportReport] }` |
| GET `/api/events` | SSE: `data: { type: 'pages'\|'briefs', … }` on every store change |
| GET `/` | ui/ static |
| GET `/vault/*` | frontendmaxxing static (CSS/JS assets for previews + UI) |
| GET `/book/*` | book static (saved pages, shots) |

**Preview base rule:** composed/saved HTML keeps vault-relative hrefs
(`structure/structure.css`). Anything served for browser preview gets
`<base href="/vault/">` injected after `<head>`; anything rendered headlessly
gets `<base href="file://<vault>/">`. Helper: `injectBase(html, href)` in
lib/vault.js. Never rewrite individual links.

## Viewport lab (lib/inspect.js) — the screenshot killer

Named viewports: `iphone-se 375×667`, `iphone-15 393×852`, `iphone-15-max
430×932`, `ipad 820×1180`, `ipad-landscape 1180×820`, `laptop 1366×768`,
`desktop 1440×900`, `desktop-xl 1920×1080`. Default set:
`['iphone-15','ipad','desktop']`.

Per viewport, render in headless Chrome (`--headless=new --window-size=W,H
--virtual-time-budget=4000 --dump-dom`, depth-capped rAF override) with an
injected probe that serializes JSON into `<pre id="__dbprobe">`:

```
ViewportReport = {
  viewport, width, height, docHeight,
  hOverflow: bool,                       // horizontal scroll present
  overflowers: [{ sel, right, width }],  // top 10 elements past the right edge
  smallTaps:  [{ sel, w, h }],           // interactive targets < 44×44
  tinyText:   [{ sel, px, sample }],     // computed font-size < 12px (max 10)
  offscreen:  [{ sel, left }],           // content stranded left of x=0
  landmarks:  [{ sel, x, y, w, h }],     // header/nav/main/section/footer/h1/h2
  counts: { sections, images, buttons, inputs }
}
```

`screenshot: true` additionally captures `--screenshot` PNGs to
`book/shots/<slug-or-hash>-<viewport>.png` and adds `screenshotPath` (served
under `/book/shots/…`). Facts are the default; pixels are opt-in. Chrome binary
discovery: `CHROME_PATH` env → `/Applications/Google Chrome.app/Contents/MacOS/
Google Chrome` → `chromium`/`google-chrome` on PATH.

### The four lab modes (`/api/inspect` `mode` param) — agent DevTools

| Mode | What it answers | Report |
| --- | --- | --- |
| `layout` (default) | "Does it fit every screen?" | per-viewport ViewportReport above |
| `perf` | "Will it lag?" | `lagScore` 0–100 + `layoutCostMs` (30 forced reflows), `recalcCostMs` (20 style recalcs), `longTasks/longTaskMs`, `cls`, `domNodes`, `runningAnimations`, `census` {blurFilters, bigShadows, transitions, cssAnimations, willChange, fixedSticky, imgsNoDims} |
| `diagnose` | "What's broken?" — the common-issues audit | `score` 0–100 + `summary` and grouped findings: `console` (page errors/warns + uncaught + rejections, captured by a head-injected shim), `resources` (404 css/js/img), `a11y` {contrastFails (WCAG AA, solid-bg-provable only, deduped by class), missingAlt, unlabeledInputs, namelessButtons, headingSkips, duplicateIds}, `layout` {hOverflow, overflowers, smallTaps, tinyText, overlaps (interactive pairs)}, `typography` {longLines, fontFamilies}, `css` {undefinedVars (var(--x) with no definition + no fallback), unloadedFonts}, `images` {oversized (natural > 2× displayed), missingDims} |
| `element` | "Inspect this node" — point DevTools | requires `selector`; → `matches`, `box` {x,y,w,h}, curated `computed` styles, `parents` chain (display/position/overflow/width), `overlapping` (paint-order at center), `visibility` {inViewport, opacity, clippedByAncestor, offscreenRight} |

Honesty rule for all detectors: **report only what is provable** (e.g. contrast
is skipped over gradient/image backdrops rather than guessed), dedupe repeats
of the same class, cap list sizes — an agent must be able to trust every line.

## MCP tool surface (designbook-mcp/server.js)

Stdio MCP server (same `@modelcontextprotocol/sdk` version as the vault's);
every tool is a thin HTTP client to `http://localhost:<port>` (`DESIGNBOOK_URL`
env override). Tools (names locked):

- `book_overview()` — counts, queued briefs, how-to-work-a-brief instructions.
- `book_meta()` — genres/presets/palettes/viewports (mirrors `/api/meta`).
- `book_compose(args)` — mirrors `/api/compose`. **Draft here first; it's free.**
- `book_coherence(html)` / `book_inspect({ slug|html, viewports?, screenshot? })`.
- `book_list_pages()` / `book_get_page(slug)` / `book_save_page({ slug?, title, html, manifest?, briefId? })` — saving with `briefId` auto-completes that brief.
- `book_briefs(status?)` / `book_claim_brief(id?)` (→ status `working`) / `book_complete_brief({ id, pageSlug, summary })`.

Tool descriptions must encode the efficiency contract: draft deterministically
(`book_compose`), verify with facts (`book_inspect`), spend model effort only on
the delta the brief actually asks for, save with manifest + briefId.

**Save-gate (research rec #3):** `book_save_page` validates deterministically
before writing — coherence ≥ 70, zero console errors / failed resources, no
phone overflow, no undefined CSS vars — and REJECTS with the exact findings.
**Doom-loop guard (rec #5):** identical violation fingerprints on consecutive
attempts trigger an escalation instruction (recompose fresh, or `force:true`
with honest disclosure). The gate lives in the MCP layer so the model cannot
talk past it; the human UI is not gated.

## SDK engine (engines/sdk.js)

`runBrief(brief, ctx)`: lazy `import('@anthropic-ai/claude-agent-sdk')` — if
missing or no `ANTHROPIC_API_KEY`, return `{ error }` (UI shows enable steps;
never crash the server). Otherwise `query()` with `mcpServers.designbook`
(stdio spawn of designbook-mcp with `DESIGNBOOK_URL` pointing back at this
server), `allowedTools: ['mcp__designbook__*']`, model from settings
(default `claude-sonnet-4-6` — cheap-capable; user-overridable). The prompt =
brief text + the efficiency contract + the target page context (manifest, not
raw HTML). Mark brief `working` on start; the agent completes it through
`book_complete_brief`; on agent failure mark `error` with the message.

## UI (ui/) — vanilla, zero-build, dogfoods the vault

Loads `/vault/structure/structure.css`, `/vault/colors/palettes.css`, all
`/vault/taste/*.css` and uses `.struct pal-* data-aesthetic` for its own chrome.

**Layout (the Claude Design pattern — owner decision): chat left, big preview
right, tabs on the right.**

```
+----------------------------------------------------------------------+
| header: ◆ Design Book · engine pill (mcp|sdk) · server status         |
+------------------+---------------------------------------------------+
| CHAT RAIL ~360px | preview toolbar:                                  |
|                  |  [genre ▾][preset ▾][⚙ theme][seed ±]  ···        |
| conversation     |          Compose · Devices · Page · Book  ← tabs  |
| thread:          +---------------------------------------------------+
|  · user briefs   |                                                   |
|    as messages   |            BIG PREVIEW CANVAS                     |
|  · status/agent  |   Compose → 3 variant cards (seed+coherence)      |
|    summaries as  |   Devices → exact-size device frames + facts      |
|    replies (SSE) |   Page    → full preview of the focused doc       |
|                  |   Book    → saved-pages gallery grid              |
| composer pinned  |                                                   |
| at bottom        |   floating actions: Inspect · Diagnose · Save     |
+------------------+---------------------------------------------------+
```

- **Chat rail (left):** the briefs queue rendered as a conversation — each
  brief is a user message; status transitions and agent summaries appear as
  replies (live via SSE). Composer (textarea + engine select + send) pinned at
  the bottom, Claude-style. Clicking a brief's "done" reply focuses its page.
- **Preview area (right, dominant):** one toolbar row — compact theme controls
  on the left (genre, preset, a "theme" popover with the per-axis overrides:
  aesthetic/palette/density/motion/font-pair, seed stepper), the **tab bar
  right-aligned**: `Compose · Devices · Page · Book`. Below it the canvas fills
  everything. Inspect/Diagnose/Save live as actions on the canvas (toolbar end
  or floating), with results rendered as overlay panels per device.
- **Book tab** replaces the old gallery rail: saved pages as cards (title,
  theme chips, open/delete).

**Instant re-theme rule:** taste switches patch the cached doc's `<body>`
class/`data-*` attributes client-side and re-set `srcdoc` — zero server calls,
zero tokens. Composing new structure (genre/seed change) hits `/api/compose`.

## Video pipeline (book_video_*)

SaaS-style product videos are the page pipeline, generalized to motion. A
deterministic **video PLAN** (`lib/videoplan.js`) is the single source of truth:
ordered scenes (TitleCard / FeatureCard / ScreenshotShowcase / StatBurst /
LogoReveal / QuoteCard / BulletList / CTACard) with blessed frame durations and a
theme whose palette tokens are **the same the page genre would use** — so a site
and its launch video are brand-identical.

- **Isolation:** all of Remotion lives in `remotion-studio/` (its own
  `package.json` + `node_modules`), so the core stays zero-build. `lib/video.js`
  lazy-loads `@remotion/bundler` + `@remotion/renderer` by absolute path and
  degrades to `{skipped}` when absent (the `imagegen.js`/mflux pattern). The
  deterministic `book_video_compose` works with Remotion uninstalled.
- **The loop (mirrors pages):** `book_video_compose` (free plan) → set scene
  copy/media → `book_video_inspect` (`renderStill` one frame/scene → facts) →
  `book_video_critique` (vision rubric on keyframes) → `book_video_refine`
  (rewrite the plan JSON) → `book_video_render` (`renderMedia` → MP4) ·
  `book_video_view` (a keyframe inline).
- **Determinism law:** scenes animate only via `useCurrentFrame()` +
  `interpolate(…clamp)` + `spring()` + seeded `random()` — never `Math.random` /
  `Date.now` / CSS-animation, so the critiqued still equals the rendered frame.
  Enforced by `videoCoherence` + the regression gate.
- **Render facts:** a `bundle()`→serveUrl and one `openBrowser('chrome')` are
  memoized for the server's lifetime; once warm, stills render sub-second and a
  ~12s 1080p MP4 (h264/crf18) renders in a few seconds.

## Roadmap (post-MVP)

- **Video phase 2**: clone real page components into ScreenshotShowcase, audio +
  whisper captions, `@remotion/transitions` between scenes, richer scene
  placeholders, and page↔video asset association (`manifest.kind:'video'`).
- **Research-driven features**: the Lovable/Replit/v0/bolt competitive research
  (research/competitive-landscape.md) feeds a ranked recommendation list;
  "now"-phase items land in the MVP, the rest queue here.
- **Console/error piping**: surface preview-iframe runtime errors into the
  brief loop (the self-healing pattern every commercial builder uses).
- **Brand kit → asset generation** (owner request): let a user connect their
  company's UI/design system (the vault already consumes external DESIGN.md
  specs via `apply_design_md`, and `design_system` emits one) and use those
  tokens — colors, type voice, radius language — to drive **brand-consistent
  asset generation**: icons, logos, hero illustrations, og-images. Local
  image-gen routes exist in the vault skills (`local-image-gen.skill.md`);
  the missing piece is a `book_brand` store (uploaded kit → parsed tokens) +
  prompt scaffolds that translate tokens into generation style guidance.

## Invariants (enforced in review)

1. Engine parity: both engines see identical MCP tools; no engine-specific capability.
2. Determinism-first: if it can be computed without a model, it must be (and must be exposed both as API + MCP tool).
3. Facts before pixels: `book_inspect` structured reports are the default verification; screenshots only on request.
4. Plain-file book: every page is a self-contained folder a human can read, git, or hand to any agent.
5. Zero-build: no bundler, no framework; vanilla ESM + node:http. The only deps: MCP SDK (designbook-mcp) and the optional Agent SDK.
6. The API key lives in `ANTHROPIC_API_KEY` env only — never written to disk by us.
