# Design Book — desktop app

A double-click macOS app for the SDK-engine Design Book workbench. No terminal,
no Electron, no build step — a `.app` bundle wraps a shell launcher that manages
the server and opens a chromeless window.

## Build it

```bash
bash app/make-app.sh              # → ./Design Book.app
bash app/make-app.sh ~/Desktop    # also drop a copy on the Desktop
```

The build bakes in **this machine's** absolute `node` + repo paths, so the
bundle is portable anywhere (Desktop, /Applications). Re-run after moving the
repo or changing node versions.

## What a double-click does

1. **Key** — reads your Anthropic SDK key from the macOS **Keychain**
   (`security`, service `designbook-anthropic`). First run pops a one-time
   hidden-input dialog for the key (and an optional custom base URL for a
   gateway). The key is **never written to plaintext disk** — it lives in the
   Keychain and is exported into the server's env only at launch.
2. **Server** — guarantees a server *with the key* is running on `:4747`. If a
   keyless one is already up, it restarts it; otherwise it starts one. The chat
   box runs the **Agent SDK engine** (`engines/sdk.js`) — full designbook +
   frontendmaxxing tool surface, on your SDK credits.
3. **Window** — opens `http://localhost:4747` in a chromeless Chrome/Edge/Brave
   app window (falls back to your default browser).

## Manage the key

```bash
# change / re-enter the key
security delete-generic-password -s designbook-anthropic
# (next launch re-prompts)

# set a custom base URL without the dialog
security add-generic-password -s designbook-anthropic -a baseurl -w "https://your-gateway" -U
```

## Notes

- Built bundles (`Design Book.app`) and `.app-server.log` are gitignored — the
  generator (`make-app.sh`) is the source of truth.
- Locally-built `.app`s aren't Gatekeeper-quarantined, so the first double-click
  just works (no "unidentified developer" prompt).
- An app icon isn't bundled yet (default icon for now) — drop an `icon.icns` in
  `Contents/Resources/` and add `CFBundleIconFile` to ship one.
