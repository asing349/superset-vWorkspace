---
name: superset-memory
description: Pull reusable knowledge from Superset Memory (local) before starting a task — prior playbooks, this repo's coding practice, and a project-index map — so you explore less and repeat the established conventions. Use BEFORE exploring the codebase on any non-trivial task.
---

# Superset Memory (local, self-improving)

Superset keeps a **local** memory of how past tasks were done in this repo and
feeds the relevant slice back to you. It is exposed over a local MCP server
named `superset-memory` (no network — everything stays on this machine).

## Connecting (loopback, egress-free)

The host serves `superset-memory` over **MCP-over-HTTP (Streamable HTTP)** on its
**loopback** interface (`127.0.0.1` only — no auth, no egress). The endpoint is
`<host-endpoint>/mcp/memory`, where `<host-endpoint>` is the running host's URL
published in its manifest at `~/.superset/host/<organizationId>/manifest.json`
(the `endpoint` field, e.g. `http://127.0.0.1:<port>`). External CLI agents
register it like any other local MCP server, e.g.:

```jsonc
// .mcp.json (Claude Code / Cursor) — point url at the manifest's endpoint
{ "mcpServers": { "superset-memory": {
  "type": "http", "url": "http://127.0.0.1:<port>/mcp/memory" } } }
```

## When to use

At the **start** of any non-trivial task, before grepping/exploring: pull the
bundle for what you're about to do. It returns (1) this repo's **coding
practice**, (2) the **top-k playbooks** (distilled records of similar past
tasks: intent, commands that worked, the gotcha avoided, the diff shape), and
(3) **project-index slices** (where things live + exported symbols), filtered to
the areas your task touches and capped to a token budget.

## How to pull (MCP tools on the `superset-memory` server)

- `memory_search` — the main entrypoint. Input: `{ intent, projectId?, areaTags?,
  topKPlaybooks?, topKIndexSlices?, maxTokens?, includeProvisional? }`. Returns
  `{ queryAreas, practices[], playbooks[], indexSlices[], estimatedTokens, trimmed }`.
- `memory_get_playbook` — `{ id }` → one playbook's full detail (touched paths,
  commands, validation).
- `memory_get_practice` — `{ scope: "project" | "global", projectId? }` → the
  latest durable coding-practice doc for that scope.

## What to do with it

1. **Follow the practice** returned by `memory_get_practice` / the `practices`
   field — these are this repo's (and your) durable conventions.
2. **Reuse the playbooks** — if a returned playbook matches your task, follow its
   commands and avoid its gotcha instead of rediscovering them.
3. **Jump to the index slices** — use the `indexSlices` paths/summaries to go
   straight to the right files instead of searching.

Memory is consolidated by the user at PR time and via the "update coding
practice" button; you only ever **read** it here.
