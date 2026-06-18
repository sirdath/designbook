# design-book — installable Agent Skill

Packages the **Design Book method** (compose tasteful, verification-gated web pages /
mobile flows / decks / diagrams from the frontendmaxxing vault) as a portable Agent
Skill — so it works in Cursor, Codex, and Claude Code *without* the MCP server.

This is the **reach** half of a two-product strategy:

- **Design Book MCP** — the full engine: deterministic compose **+ a headless
  save-gate** that proves a page renders clean. The moat.
- **design-book skill** (this) — teaches the method + the gate *checklist*, and is
  honest that markdown can't run the headless gate. It funnels to the MCP for real
  verification.

## Install

Copy (or symlink) this folder into your agent's skills directory:

```bash
# Claude Code
cp -r skills/design-book ~/.claude/skills/design-book
# Cursor / Codex
cp -r skills/design-book .agents/skills/design-book
```

Then read `SKILL.md` — it auto-activates from its description, or trigger it
explicitly (`/design-book`).

## Keep it honest (anti-drift)

`docs/genres.md` and `docs/taste.md` are **generated from the live engine**, never
hand-edited:

```bash
node skills/design-book/build-skill.mjs          # regenerate after changing genres/presets
node skills/design-book/build-skill.mjs --check   # CI guard — exits 1 if the docs drifted
```

If you hand-edit a genre/preset/palette and forget to regenerate, `--check` fails — so
the shipped skill can never lie about the real compose surface.
