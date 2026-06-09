# Idiolect Plugin

Write in **your** voice — everywhere your agent writes. Idiolect rewrites the prose
an agent drafts on your behalf (commit messages, PR descriptions, docs, release
notes, replies) into your own writing voice, and scores how close it got on a
validated voice‑fidelity metric. Works in **Claude Code** and **Codex**.

## Setup

1. **Get your API key** — sign in at <https://idiolect.app/connect> and generate one.
2. **Claude Code:**
   ```
   /plugin marketplace add Moshpit-Labs/idiolect-plugin
   /plugin install idiolect@idiolect
   ```
   Then set your key in the environment Claude Code runs in:
   ```
   export IDIOLECT_API_KEY=idl_sk_your_key_here
   ```
3. **Codex:** register Idiolect as an MCP server — one command, no clone (it runs
   via `npx`, writing an `[mcp_servers.idiolect]` entry to `~/.codex/config.toml`):
   ```
   codex mcp add idiolect \
     --env IDIOLECT_API_KEY=idl_sk_your_key_here \
     --env IDIOLECT_BASE=https://idiolect.app \
     -- npx -y idiolect-mcp
   ```

The plugin bundles a self‑contained MCP server (`server.mjs`) — no `npm install`
needed.

## Slash commands

Commands are namespaced by the plugin:

- `/idiolect:voice` — show a summary of your writing voice.
- `/idiolect:rewrite <text>` — rewrite text into your voice (+ Voice Match).
- `/idiolect:draft <brief>` — draft new content from a brief, in your voice.
- `/idiolect:check <text>` — score any text against your voice.

## The skill

The **in‑your‑voice** skill triggers automatically whenever the agent drafts prose
for you: it calls `get_my_voice`, rewrites the draft via `rewrite_in_voice`, and
shows the Voice Match — so everything you "write" through the agent sounds like you.

## Tools (MCP)

| Tool | What it does |
| --- | --- |
| `get_my_voice` | Load your Voice Card (call before writing on your behalf). |
| `rewrite_in_voice` | Rewrite text in your voice; returns Voice Match + before→after delta. |
| `draft_in_voice` | Draft new prose in your voice from a brief. |
| `score_voice` | Voice Match of any text against your own writing. |

Pro is required for `rewrite_in_voice` / `draft_in_voice`. Your voice and corpus
live in your Idiolect account; the key resolves to them server‑side.

---

Built from the Idiolect monorepo. To regenerate `server.mjs`, run `plugin/build.sh`.
