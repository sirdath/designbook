# Design Book

> **Identity** — mark: "Index" (`ui/logo.svg`), a book spine + descending
> page-lines reading as a book *and* an index of saved designs. Palette:
> **Ink & Amber** — warm near-black `#0e0d0c` / surface `#1b1714` / amber accent
> `#e8a33d` / clay `#c9714a` / cream `#f5f1ea`. Set on `body.struct` in
> `ui/app.css` (overrides the vault palette on the app shell only).

A local-first AI design workbench built on the [frontendmaxxing](../frontendmaxxing) vault, resting on three pillars: **deterministic drafts** (full pages are composed from the vault's snippets, palettes and taste presets in-process — free, instant, zero tokens), **viewport facts** (pages are verified with structured layout reports from headless Chrome across real device sizes — overflow, tap targets, tiny text — instead of screenshots an agent has to squint at), and **dual engines** (the same MCP tool surface drives both your Claude Code subscription and the optional Agent SDK on API credits, so model effort is spent only on the bespoke delta a brief actually asks for). Everything lives in plain files you can read, git, or hand to any agent.

## Install & run

The [frontendmaxxing](https://github.com/sirdath/frontendmaxxing) vault is bundled
as a **git submodule** (`./frontendmaxxing`), so one recursive clone gets everything:

```sh
git clone --recurse-submodules https://github.com/sirdath/designbook.git
cd designbook
node server.js
# → http://localhost:4747   (PORT env to change)
```

Already cloned without `--recurse-submodules`? Pull the vault with:
`git submodule update --init`.

Requirements: Node 18+ and Google Chrome/Chromium for the viewport lab
(`CHROME_PATH` overrides discovery). The MCP server needs its deps once:
`cd designbook-mcp && npm install`.

Vault resolution order: `FRONTENDMAXXING_PATH` env → the `./frontendmaxxing`
submodule → a sibling `../frontendmaxxing` checkout. For live vault development,
point `FRONTENDMAXXING_PATH` at your working copy so edits show without updating
the submodule pin.

No build step, no required dependencies for the core — vanilla ESM on `node:http`.

**Building a UI?** See [`API.md`](API.md) — the full HTTP API contract (every endpoint,
request/response shape, and suggested flows). The UI is just a client of the `:4747`
REST API + the `/api/events` SSE stream; a reference shell lives in [`ui/`](ui/).

Run the test suite (server should be running for the vault checks):

```sh
node test.js
```

## Connecting Claude Code (engine "mcp")

Register the designbook MCP server with Claude Code:

```sh
claude mcp add designbook -- node "/Users/dath/Documents/Claude Usable Stuff/designbook/designbook-mcp/server.js"
```

Or add it to your MCP config JSON directly:

```json
{
  "mcpServers": {
    "designbook": {
      "command": "node",
      "args": ["/Users/dath/Documents/Claude Usable Stuff/designbook/designbook-mcp/server.js"],
      "env": { "DESIGNBOOK_URL": "http://localhost:4747" }
    }
  }
}
```

With the core server running, your Claude Code session can then work the book directly: `book_overview` → claim a queued brief with `book_claim_brief` → draft free with `book_compose` → verify with `book_inspect` → `book_save_page` (passing `briefId` auto-completes the brief).

## The SDK engine (engine "sdk")

Briefs can run unattended on API credits via the Claude Agent SDK. It is an *optional* dependency — the core never needs it.

```sh
npm install @anthropic-ai/claude-agent-sdk
export ANTHROPIC_API_KEY=sk-ant-...
```

How briefs route: queue a brief with engine `sdk` (left rail in the UI, or `POST /api/briefs`), then trigger `POST /api/generate { briefId }` (the UI's run button does this). `engines/sdk.js` marks the brief `working` and runs an Agent SDK `query()` whose only tools are the same `mcp__designbook__*` tools Claude Code uses — engine parity is a hard invariant. The model defaults to `claude-sonnet-4-6` (override in `book/settings.json` → `sdk.model`). If the SDK isn't installed or the key isn't set, the brief is marked `error` with a clear message and the server keeps running. The API key is read from the environment only — it is never written to disk.

Briefs queued with engine `mcp` simply wait for your Claude Code session to claim them — no API spend.

## API surface

Full request/response shapes live in [ARCHITECTURE.md](./ARCHITECTURE.md) — it is the binding contract. Summary:

| Endpoint | What it does |
| --- | --- |
| `GET /api/health` · `GET /api/meta` | Server status · genres/presets/palettes/viewports |
| `POST /api/compose` · `POST /api/variants` | Deterministic page drafts (free, no model) |
| `POST /api/coherence` | Taste-coherence score for any HTML |
| `GET /api/search` · `GET /api/snippet` | Vault snippet search / source |
| `GET/POST/PUT/DELETE /api/pages…` | Page CRUD with automatic revisions |
| `GET/POST/PUT /api/briefs…` | Brief queue (statuses: queued → working → done/error) |
| `POST /api/generate` | Run a queued brief through the SDK engine |
| `POST /api/inspect` | Multi-viewport layout facts (screenshots opt-in) |
| `GET /api/events` | SSE: live page/brief changes |
| `GET /` · `/vault/*` · `/book/*` | UI · vault assets · saved book files |

## The book/ data layout

Your data is plain files — gitignorable, portable, human-readable:

```
book/
  book.json            collection meta
  briefs.json          the work queue
  settings.json        engine prefs (never the API key)
  pages/<slug>/
    index.html         the current page
    manifest.json      title, genre/preset/theme, revision count, timestamps
    revisions/<n>.html every prior version, archived on save
  shots/               inspect screenshots (only when explicitly requested)
```
