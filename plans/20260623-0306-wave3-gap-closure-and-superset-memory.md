# Wave 3 — multi-root gap closure + Superset Memory (local self-improving agent memory)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Reference: This plan follows conventions from `AGENTS.md` (repo root) and the ExecPlan template in `.agents/skills/create-plan/SKILL.md`. It is the **third wave** on branch `claude/keen-euler-e9b3x8`, on top of `plans/20260619-0604-multi-root-workspaces.md` (wave 1) and `plans/20260619-2359-multi-repo-worktrees-and-gap-closure.md` (wave 2), both already implemented on this branch. Read those for the multi-root foundation; this plan does not repeat them.


## Purpose / Big Picture

This wave has two parts, executed in order.

**Part A — finish the disclosed multi-root gaps (waves 1–2).** An independent audit of wave 2 found the feature substantially complete (7 of 9 milestones fully met) but with two honestly-disclosed gaps and a few cosmetic loose ends: (1) the group **explorer** cannot create/rename/delete/move files (only the editor *save* path works — for every group root, not just folders); (2) the interactive end-to-end acceptance was never actually run; plus a stale "folder roots can't be edited yet" banner, content-search results that open at the top of the file instead of the matched line, an untested `workspace-client` event-bus change, and a stale TODO comment. Part A closes these so multi-root is genuinely "done."

**Part B — Superset Memory.** A local-first, self-improving memory layer for the agent. Every time a task succeeds, Superset quietly distills *how* it was done into a small reusable **Playbook**, keeps a lightweight **Project Index** (a map of the codebase), and consolidates durable **Coding Practice** rules — then feeds the right slices back into the next run so the agent explores less, repeats your conventions, and gets **cheaper and more consistent over time**. It builds a browsable **knowledge graph** (Obsidian-style) you and the agent can look at. You stay in control at exactly two moments: a one-click "save this to memory?" when a PR is opened, and a reviewed "update my coding practice" button. Everything is **local** in this wave; an organization-shared cloud tier is explicitly deferred.

You can see Part A working by composing two repos in a group and creating/renaming/deleting files from the explorer in each, and by clicking a content-search hit and landing on the matched line. You can see Part B working by finishing a task, opening a PR, clicking "Save to memory," watching a Playbook + graph node appear locally, then starting a new related task and seeing the agent pull that memory in (and the local token-savings counter tick up), and finally clicking "Update this project's coding practice" and reviewing the proposed diff.

**Discipline carried from waves 1–2:** Part A keeps **Strategy A** (compose existing primitives; do not modify `packages/panes`, `packages/workspace-fs`, or the cloud schema). Part B is **local-only** (host-service SQLite + on-disk vault + local index; no `packages/db`/`packages/trpc` schema change, no network egress), **additive** (new `packages/memory` + a `memory` tRPC router + a local MCP server + a desktop Memory panel), and **provider-agnostic** (memory is exposed over MCP so any CLI agent benefits, not just Claude).


## Definitions (read this first; self-contained)

Multi-root terms (from waves 1–2, repeated so this plan stands alone):
- **Group (multi-root workspace)**: a named, ordered list of **roots**, stored locally in host SQLite; the host `workspaceGroup` tRPC router is the source of truth.
- **Root**: one entry in a group. `kind:"workspace"` references an existing worktree by `workspaceId`; `kind:"folder"` is an arbitrary absolute path (no `workspaceId`), addressed by `{groupId, rootId}`.
- **Addressing union**: wave-2 host filesystem read **and write** procedures accept either `{workspaceId}` or `{groupId, rootId}` (`addressingSchema` in `packages/host-service/src/trpc/router/filesystem/filesystem.ts`), routed via `getServiceForRootId`. So the host can already write to any group root; only some renderer call sites are unwired (Part A, A1).
- **host-service**: the per-machine backend (`packages/host-service`) — tRPC server + local SQLite (`better-sqlite3`, schema `src/db/schema.ts`, migrations auto-applied from `drizzle/`). Owns all on-disk paths, the filesystem service, terminals, git, PRs, and the group store.
- **Electron renderer / main**: the desktop browser process (`apps/desktop/src/renderer`, **no Node APIs**) and Node process (`apps/desktop/src/main`). The renderer reaches host-service over tRPC-over-WebSocket; native pickers go through Electron IPC.

Memory terms (new, Part B):
- **Playbook**: the distilled record of one successful task — intent, files/symbols touched, the commands that worked, the gotcha avoided, the diff *shape* (not the full diff), and the validation that proved success. One row per task. *Episodic* memory.
- **Project Index**: a per-project map of the codebase itself — module/dir tree, key files, exported symbols, "where X lives," conventions. **Lightweight by default** (structural map + lexical index); an **optional** semantic-embedding layer is built only if a **local embedding model is connected**. *Semantic* memory.
- **Coding Practice**: the durable, distilled **rules** layer, at two scopes — **project** ("how we do things in this repo", written to the repo's `AGENTS.md`/`CLAUDE.md` or a `.superset/practice.md`) and **global** ("how I like things everywhere", written to `~/.superset/practice.md` / `~/.claude/CLAUDE.md`). Maintained by **consolidation**, not append-only growth.
- **The Graph**: an Obsidian-style Markdown **vault** projecting Playbooks + index summaries + practice rules with `[[wikilinks]]`; the graph view comes free from plain Markdown. Obsidian the app is optional.
- **Capture → Consolidate → Retrieve**: capture a Playbook on task success; consolidate Playbooks into Coding Practice (button-driven, reviewed); retrieve the relevant Practice + Playbooks + index slices into the next run.
- **MCP (Model Context Protocol)**: the transport (`packages/mcp`) by which an agent can *pull* tools/context. Memory is exposed as a local MCP server so any agent can query it.
- **Ollama / local embedding model**: a locally-running model exposing an HTTP embeddings endpoint (e.g. `http://127.0.0.1:11434`). Used **only if present**; embeddings never leave the machine; no cloud embedding provider is contacted.


## Assumptions

Part A:
- A1. The host filesystem **write** procedures already accept `{groupId, rootId}` (wave-2 M1). Part A's explorer work is renderer-only orchestration; **no host write code changes**.
- A2. The interactive GUI end-to-end run requires a human (or a future Electron e2e driver); an agent cannot drive native pickers / dev sign-in headlessly. Part A treats running-and-recording it as a deliverable, with an optional driver spike.

Part B (Superset Memory):
- A3. **Success = "PR opened, you clicked Save" (provisional) → confirmed when the PR merges → demoted if the PR is closed unmerged or the branch is dropped.** Merge is the free quality signal. The host already tracks PRs (`packages/host-service/src/runtime/pull-requests/`, host SQLite `pull_requests` table).
- A4. **The PR-time save prompt is project-scoped only.** Global Coding Practice is reached **only** through the reviewed global-consolidation button (user decision).
- A5. **Project Index is lightweight by default and always-on**; semantic embeddings are **off** until a **local** embedding model is auto-detected (Ollama-style HTTP endpoint), and never leave the machine (user decision).
- A6. **Coding Practice docs are written where the agent already reads them** — project `AGENTS.md`/`CLAUDE.md` (or `.superset/practice.md`) and global `~/.superset/practice.md` / `~/.claude/CLAUDE.md` — relying on the existing user<project memory precedence.
- A7. **Everything is local** — host-service SQLite + an on-disk Markdown vault + a local index/vector store under `~/.superset/memory/`. **No cloud/org tier** is built (it is a clearly-marked future phase). No `packages/db`/`packages/trpc` change.
- A8. **Delivery is provider-agnostic via a local MCP "memory" server**, plus a Claude-native push through `CLAUDE.md`/skills.
- A9. **Redaction is best-effort** (regex + secret-scanner over captured text); imperfect, flagged as a real risk before any future sharing.
- A10. **Consolidation prunes/merges (never append-only)** and is versioned/revertible — required to keep the always-loaded layer small enough that memory is a token *saving*, not a tax.
- A11. **Area categorization is automatic from touched paths** (using the monorepo structure in `AGENTS.md`) plus optional explicit task labels (the `tasks.labels` jsonb column already exists), and is **multi-label**.
- A12. Memory lives in a new shared `packages/memory` (pure logic), surfaced through host-service (a `memory` tRPC router + runtime) and a desktop Memory panel; the local MCP server reuses `packages/mcp`. No new heavyweight third-party dependencies beyond a local embeddings client and a small vector index (only loaded when embeddings are enabled).


## Open Questions

None blocking — the design decisions are recorded in the Decision Log and Assumptions per the user's "no more questions; make assumptions" direction. Items deferred by choice (org/cloud tier, embeddings-by-default) are called out as future phases, not open questions.


## Progress

Part A — gap closure:
- [ ] A1 — Group explorer file mutations (New/Rename/Delete/Move) for all group roots, via `{groupId,rootId}` writes.
- [ ] A2 — Fix stale "folder roots can't be edited yet" banner + doc comment in `GroupReadOnlyFilePane`; remove stale `TODO(group-content-search)` comment.
- [ ] A3 — Content-search / quick-open: focus the matched line on open (thread `focusLine`/`focusColumn` through pane data → editor).
- [ ] A4 — `workspace-client` event-bus test harness (covers the wave-2 additive group-fs changes incl. the `maybeCleanupConnection` widening + reconnect re-send).
- [ ] A5 — Execute + record the wave-1/2 interactive end-to-end acceptance (human handoff; optional Electron e2e-driver spike).

Part B — Superset Memory (local):
- [ ] B1 — Memory data model + `packages/memory` + host `memory` router; path→area mapping; redaction.
- [ ] B2 — Capture: PR-time "Save to memory?" prompt → distill provisional Playbook → confirm-on-merge / demote-on-reject; anti-pattern capture from review rejections.
- [ ] B3 — Lightweight Project Index (structural map + lexical) + incremental `fs:events` refresh + fingerprints.
- [ ] B4 — Retrieval & injection (Practice + area-filtered Playbooks + index slices) via `CLAUDE.md`/skills push **and** a local "memory" MCP server (pull); local token-savings telemetry.
- [ ] B5 — Two consolidation buttons (project, then global) — reviewed-diff, prune/merge, versioned/revertible, provenance.
- [ ] B6 — The Graph: generate the Obsidian Markdown vault + serve the graph locally.
- [ ] B7 — Optional local semantic embeddings (detect Ollama-style endpoint; vector layer behind a toggle; local-only).

Timestamp each item when checked off; split partials into done/remaining.


## Surprises & Discoveries

- Observation: The host can already write to any group root — Part A's explorer gap is purely renderer orchestration.
  Evidence: wave-2 `addressingSchema` covers all five FS write procs in `packages/host-service/src/trpc/router/filesystem/filesystem.ts`; the single-workspace explorer mutations (`useFilesTabActions`) just need a group-addressed sibling.

(Add observations as work proceeds.)


## Decision Log

- Decision: Wave 3 finishes the audited wave-1/2 gaps (Part A) and then builds Superset Memory (Part B), in that order, on this branch.
  Rationale: User-directed; completing multi-root before layering memory keeps the foundation honest.
  Date/Author: 2026-06-23, planning session.

- Decision: Global Coding Practice is updated by the **global consolidation button only**; the PR-time prompt saves to the **project** scope (provisional).
  Rationale: User decision — keeps the always-loaded global rules clean and human-reviewed.
  Date/Author: 2026-06-23, planning session.

- Decision: Project Index is **lightweight (structural + lexical) by default**; semantic embeddings are **opt-in and local-only**, enabled only when a local embedding model (Ollama-style HTTP endpoint) is detected.
  Rationale: User decision — the lightweight index delivers most of the token savings at near-zero cost; embeddings add recall but only locally and only if the user already runs a model.
  Date/Author: 2026-06-23, planning session.

- Decision: Success signal = PR opened + user Save (provisional) → confirmed on merge → demoted on close-unmerged. Capture is one click at PR time; quality is gated by the free merge signal.
  Rationale: User direction ("ask after creating PRs should I update memory?"); avoids per-step prompts while keeping memory quality high.
  Date/Author: 2026-06-23, planning session.

- Decision: Local-only this wave; org/cloud shared tier is a future phase (B-future), not built now.
  Rationale: User direction ("locally now").
  Date/Author: 2026-06-23, planning session.

- Decision: Memory is delivered provider-agnostically via a local MCP server (pull) plus a Claude-native `CLAUDE.md`/skills push; consolidation prunes/merges and is versioned.
  Rationale: Maximizes reuse across agents and protects the token-savings goal (small, fresh always-loaded layer).
  Date/Author: 2026-06-23, planning session.


## Context and Orientation

Affected today: `apps/desktop` (renderer) and `packages/host-service`. New in Part B: a `packages/memory` package, a host `memory` tRPC router + `runtime/memory/`, a local memory MCP server (reusing `packages/mcp`), and a desktop **Memory** panel. Untouched: `packages/panes`, `packages/workspace-fs`, `packages/db`, `packages/trpc` (cloud schema).

Part-A anchor files (all present on this branch):
- Single-workspace explorer mutations (the pattern to mirror): `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/hooks/useFilesTabActions/...` — create via `writeFile`/`createDirectory`, rename/move via `movePath`, delete via `deletePath`, all `{workspaceId}`.
- Group explorer (navigation-only today): `.../v2-group/$groupId/components/GroupFilesTab/` (`GroupFileTreeSection`, `GroupFileTreeRow`) + `apps/desktop/src/renderer/hooks/host-service/useFileTree/useFileTree.ts`.
- Stale messaging: `.../v2-group/$groupId/hooks/useGroupPaneRegistry/components/GroupReadOnlyFilePane/GroupReadOnlyFilePane.tsx` (banner + doc comment now false post wave-2 M1); stale `TODO(group-content-search)` in `.../v2-group/$groupId/hooks/useGroupFileSearch/useGroupFileSearch.ts`.
- Line-focus: `FilePaneData` in `.../v2-workspace/$workspaceId/types.ts` (no `focusLine`); the editor `CodeView`; `openFilePane` in `.../v2-group/$groupId/page.tsx` (content-search select discards `result.line`).
- `workspace-client` event bus: `packages/workspace-client/src/lib/eventBus.ts` (wave-2 added `watchFsGroup`/`unwatchFsGroup`/`onFsGroup`/`fs:groupEvents` + the `maybeCleanupConnection` widening) — currently untested.
- Interactive acceptance script: the "Validation and Acceptance" section of the wave-2 plan.

Part-B anchor points:
- Capture hook: the host PR runtime `packages/host-service/src/runtime/pull-requests/` + host SQLite `pull_requests` table (PR open/merge/close are observable here); the desktop PR flow / create-pr skill is where the user-facing "Save to memory?" prompt mounts.
- Area labels: `tasks.labels` jsonb already exists (cloud schema, read-only use here); area is primarily derived from touched paths using `AGENTS.md` structure.
- Index/search building blocks: `packages/workspace-fs` already wraps ripgrep (lexical search) and `searchContent`; the structural map can reuse a fast parser. Prior groundwork: `apps/desktop/plans/done/SEMANTIC_SEARCH_PLAN.md`.
- Delivery: `packages/mcp` (MCP server); `CLAUDE.md`/`AGENTS.md` + `.agents/skills/` (push).
- Storage: host SQLite (metadata: playbooks, index entries, fingerprints, practice versions, telemetry) + an on-disk vault and index under `~/.superset/memory/`.


## Plan of Work

Twelve milestones: A1–A5 (gap closure) then B1–B7 (memory). Within Part B, B1→B4 is the spine that already bends the token curve; B5 adds curation, B6 the graph, B7 optional embeddings. Across both parts: Bun only; object-param signatures for 2+ args; no `any`/`@ts-ignore`/empty catch; **renderer must not import Node modules** (`bun run lint:check-node-imports`); run `bun run lint:fix` and ensure `bun run lint` exits 0 before any commit; keep this plan's living sections updated.


### Part A — finish the multi-root gaps

#### A1 — Group explorer file mutations
Scope: make the group file tree support New File / New Folder / Rename / Delete / Move for **all** group roots (workspace and folder), mirroring the single-workspace explorer.
Plan: add a `useGroupFilesTabActions` hook (sibling of `useFilesTabActions`) that issues `writeFile`/`createDirectory`/`movePath`/`deletePath` with `{groupId, rootId}` addressing (host already accepts it). Add a context menu to `GroupFileTreeRow` and New-File/New-Folder affordances to `GroupFileTreeSection`. Reuse the existing confirm/inline-rename UI. Refresh the affected tree via the existing `fs:events` / `fs:groupEvents` subscriptions (no manual refetch needed).
Acceptance:

    bun dev
    # In a group with a folder root AND a workspace root: from the explorer, create a file,
    # create a folder, rename, move, and delete — in EACH root.
    # Expected: every operation is reflected on disk (verify via a terminal) and the tree live-updates.
    bun run typecheck && bun run lint && bun run lint:check-node-imports

#### A2 — Fix stale messaging
Scope: remove now-false text introduced before wave-2 M1.
Plan: in `GroupReadOnlyFilePane`, change the banner from "Read-only — folder roots can't be edited yet" to an *unavailable-root* message (it's only used for `exists:false` roots now) and fix the doc comment. Remove the stale `TODO(group-content-search)` comment in `useGroupFileSearch.ts` (content search shipped in wave-2 M8).
Acceptance:

    bun run lint && grep -rn "can't be edited yet\|TODO(group-content-search)" apps/desktop/src/renderer || echo "clean"
    # Expected: no matches.

#### A3 — Focus the matched line on open
Scope: content-search and quick-open should land on the matched line/column, not the file top.
Plan: add optional `focusLine?: number; focusColumn?: number` to `FilePaneData`; thread them through `openFilePane` → `FilePane` → the editor `CodeView` (scroll into view + place the cursor). Update the group content-search select handler to pass `result.line`/`column` (it currently discards them).
Acceptance:

    bun dev
    # Run a cross-root content search, click a match.
    # Expected: the file opens in the correct root scrolled to and selecting the matched line.
    bun run typecheck && bun run lint

#### A4 — workspace-client event-bus test harness
Scope: cover the wave-2 additive group-fs changes the audit flagged as untested.
Plan: add unit tests for `packages/workspace-client/src/lib/eventBus.ts`: `watchFsGroup`/`unwatchFsGroup` ref-counting, `onFsGroup` dispatch for `fs:groupEvents`, the `maybeCleanupConnection` widening (a connection kept alive solely by a group-fs listener is NOT torn down), reconnect re-send of group watches, and that the existing workspace methods/dispatch are unchanged.
Acceptance:

    bun test packages/workspace-client
    # Expected: new event-bus tests pass; existing tests unaffected.

#### A5 — Run + record the interactive end-to-end
Scope: actually exercise the multi-root feature in the running app and record it (the wave-1/2 acceptance was never run).
Plan: a human (or a driver) runs the wave-2 "Validation and Acceptance" script (compose two repos, create worktrees inside the group, edit across them incl. a folder root via A1's explorer, live-refresh, combined agent + clickable paths, content-search line focus, restart persistence, group delete preserves worktrees) and records observations in **Outcomes & Retrospective**. Optional spike: evaluate an Electron e2e driver (Playwright-electron) for a repeatable smoke test; time-boxed, additive, no production change.
Acceptance: Outcomes records the run with pass/fail per step; any failures filed as follow-ups.


### Part B — Superset Memory (local)

#### B1 — Memory data model + package + host router
Scope: the foundation everything else writes to.
Plan:
- New `packages/memory` (pure logic, no Node-only deps in shared code): the types — `Playbook`, `ProjectIndexEntry`, `PracticeDoc`/`PracticeVersion`, `MemoryFingerprint`, `AreaTag` — plus the **path→area** mapping (derived from the monorepo layout in `AGENTS.md`: `apps/web`→frontend, `packages/host-service`/`apps/api`→backend, `packages/db`→schema, `packages/ui`→design-system, `apps/desktop`→desktop, …; multi-label) and a **redaction** pass (regex + secret patterns) over any captured text.
- Host SQLite (`packages/host-service/src/db/schema.ts`): tables `memory_playbooks`, `memory_project_index`, `memory_practice_versions`, `memory_telemetry`, plus fingerprints — generated via `bunx drizzle-kit generate` (never hand-edited).
- Host `memory` tRPC router (registered in `packages/host-service/src/trpc/router/router.ts`): `listPlaybooks`, `getPlaybook`, `capture`, `confirm`, `demote`, `forget`, `getPractice`, `consolidatePractice` (B5), `indexStatus`/`reindex` (B3), `retrieve` (B4), `telemetry`.
Acceptance:

    cd packages/host-service && bunx drizzle-kit generate --name="memory_tables"
    cd /home/user/superset-vWorkspace && bun run typecheck && bun test packages/memory packages/host-service
    # Expected: migration generated; unit tests for path→area mapping + redaction pass.

#### B2 — Capture (PR-time, provisional → confirm on merge)
Scope: turn a successful task into a Playbook with one click.
Plan: when a PR is opened (observed by the host PR runtime, or initiated from the desktop PR flow), show a single prompt **"Save how I did this to this project's memory? [Save] [Skip]"**. On Save, a cheap model distills the just-finished session (intent, touched paths→area tags, commands, gotcha, diff shape, validation) into a **provisional** Playbook (redacted), written to SQLite + the vault. On **PR merge** → mark **confirmed** (+confidence); on **close-unmerged / branch dropped** → **demote/archive**. Also capture **anti-patterns** from review rejections ("what was changed/rejected") so the agent stops repeating them.
Acceptance:

    bun dev
    # Finish a task, open a PR -> the Save prompt appears -> Save.
    # Expected: a provisional Playbook appears in the Memory panel, area-tagged, secrets redacted.
    # Merge the PR -> it flips to confirmed. (Close-unmerged on another -> demoted.)

#### B3 — Lightweight Project Index
Scope: the codebase map that lets the agent skip exploration even on novel tasks.
Plan: build a per-project **structural map** (module/dir tree, key files, exported symbols via a fast parser, "where X lives" from imports/exports + `AGENTS.md` conventions) and a **lexical index** (reuse the `workspace-fs` ripgrep wrapper). Build on first open; **refresh incrementally on `fs:events`**; **fingerprint** every entry (content hash + commit SHA) so stale entries decay. Default-on, cheap, no embeddings.
Acceptance:

    bun dev
    # Open a project; the Memory panel shows an index summary (modules, key symbols).
    # Edit a file; the relevant index entry refreshes (fingerprint changes).
    bun test packages/host-service  # index build + incremental refresh + staleness eviction

#### B4 — Retrieval & injection + telemetry
Scope: feed memory back in, and prove it saves tokens.
Plan: a `retrieve` step assembles a **small, high-signal bundle** for the current intent — the relevant Coding Practice (project+global), **top-k area-filtered Playbooks**, and the **Project-Index slices** for the touched areas. Deliver two ways: **push** via `CLAUDE.md`/`AGENTS.md` + a generated skill (Claude-native), and **pull** via a **local "memory" MCP server** (reusing `packages/mcp`) exposing `memory.search`/`memory.getPlaybook`/`memory.getPractice` so any agent benefits. Record **local token-savings telemetry** (tokens-per-task and exploration-steps-per-task, before/after) in `memory_telemetry`, surfaced as a "memory saved ~X%" stat.
Acceptance:

    bun dev
    # Start a task similar to a captured Playbook.
    # Expected: the memory MCP server returns the relevant Playbook + practice + index slice;
    # the agent references it; the Memory panel's token-savings counter updates.
    bun test  # retrieval bundle assembly (ranking, area filter, size cap)

#### B5 — Two consolidation buttons (project, then global)
Scope: curate durable rules without hand-writing them.
Plan: a consolidation pass reads accumulated **confirmed** Playbooks → an agent proposes **edits** to the scope's Practice doc → the UI shows a **diff** → user **reviews / edits / accepts**. **Project button** writes to the repo's `AGENTS.md`/`CLAUDE.md` (or `.superset/practice.md`). **Global button** reads **cross-project** confirmed Playbooks and only promotes patterns that **recur across repos / are clearly general** → diff → accept → `~/.superset/practice.md` / `~/.claude/CLAUDE.md`. Both **prune/merge/dedupe** (not append-only), are **versioned/revertible** (`memory_practice_versions`), and carry **provenance** ("from PR #123"). Project rules override global (existing precedence).
Acceptance:

    bun dev
    # Accumulate a few confirmed Playbooks. Click "Update this project's coding practice".
    # Expected: a reviewable diff to AGENTS.md/practice.md; accept -> file updated + version recorded;
    # revert restores the prior version. Global button behaves the same against ~/.superset/practice.md.

#### B6 — The Graph (Obsidian projection)
Scope: a browsable knowledge graph.
Plan: generate a Markdown **vault** under `~/.superset/memory/vault/` — one note per Playbook with `[[wikilinks]]` to files, area tags, practice rules, and similar Playbooks — and serve a local **graph view** (host-service local server, opened from the Memory panel). Obsidian the app is optional; the vault is plain Markdown.
Acceptance:

    bun dev
    # Open "Memory graph" -> a graph of playbooks ↔ files ↔ areas renders locally; clicking a node opens the note.

#### B7 — Optional local semantic embeddings
Scope: better recall for users who run a local model.
Plan: detect a connected **local** embedding endpoint (Ollama-style HTTP); if present, build per-file/chunk embeddings in a small local vector store (loaded only when enabled) and blend semantic recall into retrieval (B4). **Off by default; local-only; a settings toggle + auto-detect.** Fingerprint-driven incremental embedding refresh.
Acceptance:

    bun dev
    # With a local embedding model running and the toggle on: retrieval returns semantically-related files
    # even without keyword overlap. With it off or no model: lightweight index only, no network calls.


## Concrete Steps (quick reference)

From repo root `/home/user/superset-vWorkspace` unless noted:

    bun install                       # if deps changed (B7 may add a local embeddings client + vector index)
    bun run typecheck                 # after each milestone
    bun run lint:fix && bun run lint  # lint MUST exit 0
    bun run lint:check-node-imports   # renderer must not import Node modules
    bun test                          # tests
    bun dev                           # launch desktop + host-service

Host SQLite migrations (B1, never hand-edited), from `packages/host-service`:

    bunx drizzle-kit generate --name="memory_tables"


## Validation and Acceptance

Part A end-to-end: the wave-2 acceptance script PLUS explorer create/rename/delete/move in two roots (A1) and content-search line-focus (A3), recorded in Outcomes (A5).

Part B end-to-end (local): finish a task → open PR → **Save to memory** (provisional Playbook appears, redacted, area-tagged) → merge → confirmed → start a related task → the **memory MCP server** supplies the Playbook + practice + index slice and the **token-savings counter** ticks → click **Update project coding practice** → review+accept a diff to `AGENTS.md` → open the **memory graph**. With a local embedding model present and the toggle on (B7), retrieval also returns semantically-related files; with it off, no network calls occur.

Standing gates every milestone:

    bun run typecheck   # no errors
    bun run lint        # exit 0
    bun test            # all pass


## Idempotence and Recovery

- Part A is additive/renderer-mostly; A1 reuses host writes already proven in wave-2 integration tests. A4 is tests-only.
- B1 migrations are forward-only and drizzle-generated (delete the just-generated file + fix schema + regenerate if the diff is wrong; never edit historical migrations).
- Capture (B2) writes **provisional** rows; nothing is trusted until merge-confirmed, and `forget`/`demote` are reversible-by-recapture. Consolidation (B5) is **versioned** — every accept is a revertible diff.
- The Project Index (B3) and embeddings (B7) are caches: deleting `~/.superset/memory/` and reindexing is always safe. Stale entries decay via fingerprints.
- All B work is local and egress-free (except an explicitly-local embedding endpoint in B7); disabling the memory subsystem is a config flag, not a code revert.


## Interfaces and Dependencies

No cloud schema change. New: `packages/memory` (types + path→area + redaction + ranking, pure logic); host `memory` tRPC router + `runtime/memory/` + SQLite tables; a local **memory MCP server** (reusing `packages/mcp`) exposing `memory.search`/`memory.getPlaybook`/`memory.getPractice`; a desktop **Memory** panel (browse playbooks, the two consolidation buttons + diff review, the graph view, the embeddings toggle, one-click "forget"). New deps are confined to B7 (a local embeddings HTTP client + a small vector index), loaded only when embeddings are enabled. Reuse: host PR runtime (capture trigger), `workspace-fs` ripgrep (lexical index), `fs:events` (incremental refresh), `tasks.labels` (area supplement), `CLAUDE.md`/`AGENTS.md`/skills (push delivery).


## Outcomes & Retrospective

To be filled in at completion. Compare against the Purpose: multi-root is genuinely finished (explorer mutations, line-focus, tested event bus, and an actually-run end-to-end), and Superset Memory captures successful tasks at PR time, indexes the project lightly (semantically if a local model is present), feeds memory back via MCP to make runs cheaper and more consistent, consolidates durable practice at two scopes under user review, and renders a local knowledge graph — all local, additive, and egress-free.


## Future (explicitly out of scope this wave)
- **Organization/cloud shared tier:** promote confirmed Playbooks/Practice to an org-scoped shared store keyed by `organizationId`, synced over the existing channel, with redaction + curation governance. Designed-for (the local model maps cleanly onto it) but not built now.


---

### Revision note

- 2026-06-23 03:06Z — Initial wave-3 draft. Part A closes the audited wave-1/2 gaps (group explorer mutations, stale messaging, content-search line focus, workspace-client event-bus tests, and an actual interactive end-to-end run). Part B specifies Superset Memory — a local-first capture→index→retrieve→consolidate loop with an Obsidian graph and an MCP delivery surface — encoding the user's decisions (global practice by button only; lightweight index default with optional local-only embeddings; PR-time capture; local-only; provider-agnostic via MCP; prune-not-append consolidation). Assumptions A1–A12 listed; no open questions per user direction. Keeps Strategy A and changes no cloud schema.
