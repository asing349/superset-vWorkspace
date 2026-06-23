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
- [x] (2026-06-22) A1 — Group explorer file mutations (New/Rename/Delete/Move) for all group roots, via `{groupId,rootId}` writes. New `useGroupFilesTabActions` (writeFile/createDirectory/movePath/deletePath, `{workspaceId}` for workspace roots / `{groupId,rootId}` for folder roots); right-click context menu + inline rename on `GroupFileTreeRow`; New File/New Folder header buttons + root-level create placeholder + delete-confirm on `GroupFileTreeSection`; new `GroupTreeInlineInput`; pure `groupTreePaths` helpers (+tests). Live-refresh via existing fs:events/fs:groupEvents (no manual refetch). Commit `4f4459f6d`. Gates: typecheck 28/28, lint 0, groupTreePaths 11/11, v2-group suite 31/31.
- [x] (2026-06-22) A2 — Fixed stale "folder roots can't be edited yet" banner → "this root is currently unavailable" + doc comment in `GroupReadOnlyFilePane`; removed stale `TODO(group-content-search)` comment in `useGroupFileSearch`. `grep -rn "can't be edited yet|TODO(group-content-search)" apps/desktop/src/renderer` → clean. Commit `46a2eaaac`. typecheck 28/28, lint 0.
- [x] (2026-06-22) A3 — Content-search focuses the matched line on open. Added `focusLine`/`focusColumn`/`focusTick` to `FilePaneData` (mirrors `DiffPaneData`); threaded `openFilePane` (re-stamps an already-open pane via `setPaneData`) → `FilePane` → `ViewProps` → `CodeView` (rAF effect → `CodeEditorAdapter.revealPosition`). Group content-search select now passes `result.line`/`column` (was discarded). Quick-open is file-name-only (no line info) → unchanged. Single-workspace unaffected (focus fields undefined → no-op). Commit `f2877ec35`. typecheck 28/28, lint 0, v2-group 31/31.
- [x] (2026-06-22) A4 — `workspace-client` event-bus test harness. First tests for the package (added a `test` script + `bun-types`; tsconfig `types: ["node","bun-types"]`). `eventBus.test.ts` (9 tests) covers watchFsGroup/unwatchFsGroup ref-counting, onFsGroup dispatch, the `maybeCleanupConnection` widening (group-fs listener keeps the connection alive), reconnect re-send of group+workspace watches, and that existing workspace methods/dispatch are unchanged. MockWebSocket stub; non-`/hosts/` URLs make `primeRelayAffinity` a no-op (no fetch). Commit `525003514`. `bun test packages/workspace-client` → 9/0; typecheck 28/28; lint 0; turbo now discovers the task.
- [x] (2026-06-22) A5 — Interactive end-to-end recorded in **Outcomes & Retrospective**: the wave-1/2 acceptance written as a step-by-step checklist (with the NEW A1 explorer-mutation step + A3 line-focus step); auto-verified everything checkable without the GUI (typecheck 28/28, lint 0, host-service 757/0 incl. the on-disk `{groupId,rootId}` write proof `filesystem-group-writes` 9/0, workspace-fs 41/0, workspace-client 9/0, v2-group+v2-workspace 127/0, production electron-vite bundle builds exit 0); flagged steps 1–9 as a human handoff (dev sign-in + native pickers + agent launch can't be driven headlessly); added a time-boxed Playwright-electron evaluation (recorded as a future follow-up, no production code). Pre-existing env-only renderer failures (`appearance`, `useOrderedSections`) confirmed NOT touched by Part A.

Part B — Superset Memory (local):
- [x] (2026-06-22) B1 — Memory data model + `packages/memory` + host `memory` router; path→area mapping; redaction. New pure-logic `@superset/memory` package (types — `Playbook`/`ProjectIndexEntry`/`PracticeDoc`+`PracticeVersion`/`MemoryFingerprint`/`AreaTag`/`MemoryTelemetrySample`; `pathToAreas`/`pathsToAreas` multi-label map from the AGENTS.md layout; best-effort `redactText`/`redactAll`; a `rankByAreaAndRecency` helper stub for B4) — no Node deps. Host SQLite tables `memory_playbooks`, `memory_project_index`, `memory_practice_versions`, `memory_fingerprints`, `memory_telemetry` (migration `0007_memory_tables.sql`, drizzle-generated). Host `memory` tRPC router registered in `router.ts`: REAL `listPlaybooks`/`getPlaybook`/`capture`/`confirm`/`demote`/`forget`/`getPractice`/`telemetry.record`+`telemetry.read`; typed non-throwing STUBs `consolidatePractice` (B5), `indexStatus`+`reindex` (B3), `retrieve` (B4). `~/.superset/memory/` path helper + ensure-dir (`runtime/memory/paths.ts`, honors `SUPERSET_HOME_DIR`). Gates: typecheck 29/29; lint exit 0; `bun test packages/memory` 34/0; memory router 7/0; host-service full suite **764/0/8-todo** (was 757, +7). Seam for B2 = the `capture` input shape (see Decision Log).
- [x] (2026-06-22) B2 — Capture: PR-time "Save to memory?" prompt → distill provisional Playbook → confirm-on-merge / demote-on-close; anti-pattern flag on close-unmerged. **Prompt** = new `MemoryCapturePrompt` banner mounted directly under `PRActionHeader` in `WorkspaceSidebar` (v2), driven by `useMemoryCapturePrompt`: it fires once per PR when the PR-flow state is `pr-exists`, project-scoped (`workspace.projectId`), gated by a persisted `memory-capture-prompt` zustand store keyed `${projectId}:${prNumber}` (Save AND Skip both mark-answered; only Save persists). **On Save** → calls the NEW host `memory.captureFromPR` mutation (renderer stays browser-safe; all git work host-side). **Distillation is fully LOCAL/DETERMINISTIC (zero model, zero new egress)**: new pure `@superset/memory` `distill/` (`distillCapture`/`distillIntent`/`distillDiffShape`) shapes a changed-file list + PR title/body into intent + touchedPaths + a content-free diffShape (status tally + churn + capped paths) + areaTags; the changed files come from `runtime/memory/capture-gather.ts` (`gatherChangedFiles`) reusing the git router's `resolveBaseComparison` + `getChangedFilesForDiff` (merge-base 3-dot diff vs PR base — same comparison the Changes view uses). `captureFromPR` then funnels through a refactored shared `persistCapture` (the same redact + area-tag + provisional-insert path `capture` uses). **Confirm/demote observer**: `PullRequestRuntimeManager` gained an optional `onPullRequestTerminal` hook fired from `upsertPullRequestRow` on the FIRST transition into `merged`/`closed` (prev-state compare → once per transition, swallows listener throws); `app.ts` wires it to `runtime/memory/pr-capture-reconciler.ts` (`reconcilePlaybooksForPr`) which matches provisional playbooks by `(projectId, provenance.prNumber)` → merged ⇒ `confirmed`+confidence 80, closed ⇒ `demoted`+confidence 0 with an `[anti-pattern]` gotcha prefix (A9). Idempotent (acts only on `provisional` rows; a confirmed/demoted row is skipped) and a PR with no saved playbook is a no-op. Gates: typecheck 29/29; lint exit 0 (no Node imports in renderer/distill); `bun test packages/memory` **63/0** (+9), host-service full suite **786/0/8-todo** (+11: distill 9, reconciler 5, PR-terminal-hook 5, captureFromPR 1), desktop targeted **38/0** (store 4, hook selector 3, PRActionHeader suite unchanged). Commit `dbc1f06a0`.
- [x] (2026-06-22) B3 — Lightweight Project Index (structural map + lexical) + incremental `fs:events` refresh + fingerprints. New host `runtime/memory/ProjectIndexService` (`index-service.ts`): enumerates source files via the workspace-fs **file** index (`getSearchIndex`, fast-glob — NOT ripgrep), reads each file, extracts exported symbols (TS compiler API in `symbol-extractor.ts` with a regex fallback), derives multi-label area tags, and persists one `memory_project_index` row per file + a `memory_fingerprints` row (FNV-1a content hash + HEAD SHA) for staleness. Incremental refresh via `IndexRefreshWatcher` (`index-refresh-watcher.ts`) subscribed to the existing `GitWatcher.onChanged` fs-event seam — refreshes only changed paths, skips broad (path-less) changes. Lexical layer reuses workspace-fs `searchContent` (ripgrep with the wrapper's built-in JS-scan fallback) **guarded** so a MISSING `rg` never throws (tests inject a throwing `runRipgrep` and assert the scan still finds matches — no real `rg` needed). Filled the B1 router stubs `indexStatus` + `reindex` (real) and added `listIndexEntries` (B4 reads these slices). Pure helpers added to `@superset/memory`: `contentHash`/`isFingerprintStale` (`fingerprint/`), `extractExportedSymbols`/`buildStructuralEntry`/`isSourceFile`/`summarizeEntry` (`structural-map/`). Wired into `app.ts` (constructed, started, disposed) + `HostServiceRuntime.memoryIndex`. Gates: typecheck 29/29; lint exit 0; `bun test packages/memory` 54/0; host-service full suite **775/0/8-todo** (was 764, +11). No embeddings (B7). Egress-free; workspace-fs reused read-only (unmodified).
- [~] B4 — Retrieval & injection + telemetry. **Host half (B4a) DONE (2026-06-22); renderer Memory panel (B4b) remains (memory-ux follow-up).**
  - (2026-06-22) **B4a (host)** — `retrieve` bundle + local memory MCP server + telemetry. Pure `@superset/memory` helpers: `assembleRetrievalBundle`/`deriveQueryAreas`/`estimateTokens` (`retrieval/`) — derive query areas from intent (path tokens + keyword map) + explicit `areaTags`, area-filter + rank playbooks & index slices with the B1 `rankByAreaAndRecency`, cap to a token budget by trimming lowest-ranked **index slices → playbooks → practices** (practices kept last as highest-signal); `computeSavedStat`/`computeSavedStats` (`telemetry/`) for the "saved ~X%" stat. Host `MemoryRetrieveService` (`runtime/memory/retrieve-service.ts`) loads playbooks (confirmed, +provisional opt-in)/index entries/practice (project+global) and records a `retrieval_tokens` sample; filled the `retrieve` router stub (real) + added `savedStats` procedure. **Local memory MCP server** in `@superset/mcp/memory` (NEW export): `createMemoryMcpServer(provider)` + `createInMemoryMemoryMcpClient` + tools `memory_search`/`memory_get_playbook`/`memory_get_practice`, reading an injected `MemoryDataProvider` (NO cloud db, NO network — separate from the org-scoped cloud `createMcpServer`). Host `HostMemoryDataProvider` + `createHostMemoryMcpServer` adapt the memory tables to it, so MCP pull == tRPC `retrieve`. Push delivery: `renderMemorySkill`/`generateMemorySkill` emit `.agents/skills/superset-memory/SKILL.md` (generated, idempotent; auto-discovered via the `.claude/skills` symlink). Gates: typecheck 29/29; lint 0; `bun test packages/memory` 78/0, `packages/mcp` 13/0, host-service **795/0/8-todo** (was 786, +9). Egress-free. **B4b (renderer panel reading `savedStats`/`retrieve`) is the remaining half.**
- [ ] B5 — Two consolidation buttons (project, then global) — reviewed-diff, prune/merge, versioned/revertible, provenance.
- [ ] B6 — The Graph: generate the Obsidian Markdown vault + serve the graph locally.
- [ ] B7 — Optional local semantic embeddings (detect Ollama-style endpoint; vector layer behind a toggle; local-only).

Timestamp each item when checked off; split partials into done/remaining.


## Surprises & Discoveries

- Observation: The host can already write to any group root — Part A's explorer gap is purely renderer orchestration.
  Evidence: wave-2 `addressingSchema` covers all five FS write procs in `packages/host-service/src/trpc/router/filesystem/filesystem.ts`; the single-workspace explorer mutations (`useFilesTabActions`) just need a group-addressed sibling.

- (A1) The group file explorer is a SIMPLE recursive tree off `useFileTree`, NOT the single-workspace Pierre tree. So `useFilesTabActions` (the named template) could only be mirrored at the *mutation+addressing* layer, not the inline-rename/create UI layer — Pierre's `model.startRenaming`/bridge has no group equivalent. A1 therefore added a small `GroupTreeInlineInput` + section-owned editing state to provide the inline create/rename UX the group tree previously lacked, while `useGroupFilesTabActions` faithfully mirrors `useFilesTabActions`'s mutations and `{workspaceId}|{groupId,rootId}` addressing. The group tree also works entirely in ABSOLUTE paths (vs the workspace tree's root-relative Pierre keys), so the path helpers are absolute-path-based (`groupTreePaths`).
  Evidence: `GroupFilesTab/components/GroupFileTreeSection` + `GroupFileTreeRow` (recursive, non-Pierre); host write procs already group-addressable (`addressingSchema` in `packages/host-service/src/trpc/router/filesystem/filesystem.ts`).

- (env) No shared `TaskUpdate`/`TaskList` tool is exposed in the finisher agent's toolset (only `TaskStop`/`SendMessage`/`EnterWorktree`). The shared task-board updates described in the per-milestone workflow could not be performed; this plan's living sections + per-milestone commits are the durable progress record instead.

- (A4) `packages/workspace-client` had no test infra at all (no `test` script, not in turbo's `test` pipeline). A4 added the first one: a `test` script (`bun test --pass-with-no-tests`) + a `bun-types` devDep + `tsconfig` `types: ["node","bun-types"]` (so `bun:test` resolves while keeping node globals for the source). The eventBus connects eagerly on `getEventBus`, but using non-`/hosts/` URLs makes `primeRelayAffinity` a no-op (it only `fetch`es `/hosts/<id>/*`), so the tests only need a `globalThis.WebSocket` stub, not a `fetch` mock. turbo now discovers `@superset/workspace-client#test`.

- (A5) The on-disk `{groupId,rootId}` write behavior A1 depends on was ALREADY covered by an integration test (`packages/host-service/test/integration/filesystem-group-writes.integration.test.ts`, 9 cases) from wave-2 M1 — so A5's "exercise the host FS write procs to prove on-disk create/rename/delete/move for a {groupId,rootId} target" was satisfied by running that suite rather than writing a new ad-hoc script.

- (B1) `host-service` deps hoist into `packages/host-service/node_modules`, NOT the repo-root `node_modules` (there is no root `node_modules/@superset`). After adding `@superset/memory` to host-service's `package.json`, a `bun install` is required before `bun test` can resolve the import — the symlink lands at `packages/host-service/node_modules/@superset/memory -> ../../../memory`.
  Evidence: `ls node_modules/@superset` at the repo root errors; the link exists under host-service.

- (B1) host-service has its OWN `~/.superset` convention (`SUPERSET_HOME_DIR` override, else `~/.superset`) already used by `runtime/workspace-groups/prepare-agent-root.ts` for `group-roots/`. B1's `runtime/memory/paths.ts` deliberately re-derives the same way (a tiny local `getSupersetHomeDir`) so the memory vault/index live alongside worktrees and tests can redirect the whole tree via `SUPERSET_HOME_DIR`. The memory paths are constants + an ensure-dir only — no vault/index is written in B1.

- (B1) Redaction seam tightened during implementation: the `.env`-style secret rule was initially matching `:` separators too, which false-positived on HTTP headers (`Authorization: ...`) and prose (`author: ...`). Fixed to match only `=` assignments and dropped `AUTH` from the key-name alternation (the dedicated `bearer-token` rule already covers auth headers). Captured as a negative-case test. This is exactly the "best-effort, imperfect" posture Assumption A9 calls out.

- (B1) `AreaTag` is a string union (not just labels from AGENTS.md): added `trpc`, `mcp`, `auth`, `memory`, plus cross-cutting `tests`/`config`/`other` so secondary filename rules (a `*.test.ts` or a `package.json` anywhere) are multi-label on top of the package-prefix rule. Adding an area is a one-line change in `AREA_RULES` + the union.

- (B3) The `rg`-absent fallback came essentially FREE: `workspace-fs`'s `searchContent` already (a) accepts an injectable `runRipgrep` and (b) catches a thrown ripgrep and falls back to a pure-JS line scan (`searchContentWithScan`). So the lexical layer just reuses `searchContent` and adds one more belt-and-suspenders `try/catch` returning `[]`. The B3 test injects a `runRipgrep` that throws `ENOENT` (exactly how `execFile` fails when `rg` isn't on PATH) and asserts the JS scan STILL finds the match — so no real `rg` binary is required by the suite. Separately, file ENUMERATION for the structural map uses `getSearchIndex` (fast-glob), which never shells out to ripgrep at all, so the structural map is fully `rg`-independent.
  Evidence: `packages/workspace-fs/src/search.ts` `searchContent` try/catch → `searchContentWithScan`; B3 test `index-service.test.ts` "lexical search falls back gracefully when ripgrep is ABSENT".

- (B3) The cleanest fs:events seam in host-service was NOT the raw `@parcel/watcher`/`FsWatcherManager` but the higher-level `GitWatcher.onChanged` — it already debounces worktree fs activity per workspace and hands listeners the changed worktree-relative `paths` (or omits them for broad commit/branch changes). `IndexRefreshWatcher` subscribes there, maps `workspaceId → projectId` via the `workspaces` table, and refreshes only those paths. This avoids installing a SECOND native watcher over the same worktree.
  Evidence: `src/events/git-watcher.ts` `onChanged`/`GitChangedEvent.paths`; `IndexRefreshWatcher` in `runtime/memory/`.

- (B3) `getSearchIndex` returns the internal `SearchIndexEntry` whose TYPE is not exported by `@superset/workspace-fs/host`, but the runtime objects do carry `.relativePath`, so the index service consumes it positionally without needing the type. No workspace-fs change required.

- (B3) host-service already depends on `typescript@6.0.3`, so symbol extraction uses the TS compiler API (`ts.createSourceFile` per file, no Program/type-checker — lightweight) and falls back to the pure regex extractor in `@superset/memory` for non-TS files or any compiler error. No new parser dependency added (Assumption A12).

- (B2) Keeping distillation LOCAL + EGRESS-FREE while still honoring the plan's "distills via a cheap model" wording was the central design call. The DEFAULT path uses NO model: a pure `@superset/memory` `distill/` module deterministically shapes a changed-file list (+ PR title/body) into the capture fields. `intent` = PR title (falls back to the body's first non-empty line, then a path summary); `touchedPaths` + `diffShape` come from the LOCAL git diff vs the PR base; `areaTags` reuse the existing `pathsToAreas`. The `diffShape` is content-free by construction (a per-status tally + total churn + a capped, sorted path list) — privacy- and size-conscious, exactly the "shape, not the full diff" the data model calls for. The only external read in the whole capture path is the local `git` subprocess. Optional model enrichment is intentionally NOT added (and if ever added must ride the user's running agent session, never a new egress).
  Evidence: `packages/memory/src/distill/distill.ts` (no Node/network), `packages/host-service/src/runtime/memory/capture-gather.ts`, `memory.captureFromPR`.

- (B2) The cleanest PR-state seam for confirm-on-merge / demote-on-close was NOT a new poller but `PullRequestRuntimeManager.upsertPullRequestRow` — the SINGLE write site for a PR row's `state`, already driven by the existing event-driven branch sync + safety-net sweeps. Adding an optional `onPullRequestTerminal` listener that fires on the prev→next transition into `merged`/`closed` gives exactly-once reconciliation with zero new GitHub calls and no new watcher. The PR runtime stays decoupled from the memory module: `app.ts` is the only place that knows about both (it wires the listener to `reconcilePlaybooksForPr`).
  Evidence: `src/runtime/pull-requests/pull-requests.ts` `notifyTerminalTransition` + the `upsertPullRequestRow` call site; `app.ts` `onPullRequestTerminal`.

- (B2) The PR-time prompt mounts on the v2 `PRActionHeader`/`usePRFlowState` seam (state `pr-exists`), not on a PR-creation success callback. Reason: v2's "Create PR" button is still gated off (`CREATE_PR_BUTTON_ENABLED = false`) and the actual create runs through a chat slash-command, so there is no reliable renderer-side "PR just created" callback yet. Observing the PR-flow state instead means the prompt fires for ANY way a PR comes to exist (chat-created, externally opened, checkout-linked) the moment the workspace's PR query first returns one — and a persisted once-per-`${projectId}:${prNumber}` store keeps it non-nagging across refetches and restarts.
  Evidence: `WorkspaceSidebar.tsx` mounts `<MemoryCapturePrompt>` under `<PRActionHeader>`; `useMemoryCapturePrompt` + `stores/memory-capture-prompt`.

- (B2) `captureFromPR` reuses the git router's `resolveBaseComparison` + `getChangedFilesForDiff` helpers (the merge-base 3-dot diff the Changes view already uses) rather than re-deriving the diff. `gatherChangedFiles` never throws (a git failure yields `[]`, so capture degrades to a paths-less Playbook instead of failing the user's Save click), and the per-file status maps cleanly from the git router's `FileStatus` onto the memory package's `DiffFileStatus`.

- (B2) `capture`'s persistence body was extracted into a shared `persistCapture(db, input)` so `captureFromPR` (host-distilled) and `capture` (caller-pre-distilled) funnel through ONE redact + area-tag + provisional-insert path — redaction/area-tagging is identical regardless of entry point. The existing B1 `capture` tests still pass unchanged after the refactor.

- (B2 / env) zustand `persist` writes to `localStorage` on every change, which is absent in the headless bun runner (the shared `apps/desktop/test-setup.ts` doesn't shim it). The `memory-capture-prompt` store test installs a tiny in-memory `localStorage` shim before importing the store (`await import` after defining the global). The pure selector (`selectCapturePromptTarget`) and the distill helper need no such shim and are the primary unit coverage.

- (B4a) The existing `@superset/mcp` server is CLOUD-oriented: `createMcpServer` registers org-scoped tools that import `@superset/db/client` (Postgres) and require a `getMcpContext` (organizationId/userId) injected via `authInfo`. Wiring memory into THAT server would have dragged the cloud db + network in, violating "local-only + egress-free." So B4a adds a SEPARATE, standalone `@superset/mcp/memory` export — `createMemoryMcpServer(provider)` — that imports only the MCP SDK + the new memory tools and reads an injected `MemoryDataProvider`. No `@superset/db`, no auth context, no network. host-service imports just the `/memory` subpath, so the cloud db module is never evaluated (confirmed: host-service suite stays green + fast).
  Evidence: `packages/mcp/src/server.ts` + `tools/utils/utils.ts` import `@superset/db/client`; the new `packages/mcp/src/memory/*` import only `@modelcontextprotocol/sdk` + local files.

- (B4a) The MCP `InMemoryTransport` (already used by the cloud `in-memory.ts`) is the local serving path — `createInMemoryMemoryMcpClient(provider)` links a client↔server pair with no sockets. A host can additionally expose the same `createMemoryMcpServer` over a stdio/local transport for an external CLI agent; B4a ships the server factory + the in-memory client/test, and leaves binding a stdio transport into a long-running host endpoint as a thin follow-up (the server object is ready; only transport plumbing remains).

- (B4a) Practice docs are kept as the LAST thing trimmed by the size cap (after index slices, then playbooks) because they're the durable, highest-signal layer; only if practices alone exceed the budget are they trimmed (lowest-version-last). Token budget is estimated with a dependency-free ~4-chars/token heuristic — no tokenizer (egress-free, and a budget doesn't need exact counts).

- (B4a) `retrieve` records a `retrieval_tokens` telemetry sample (the bundle's estimated injected tokens) with a null baseline; the "saved %" only counts samples that carry BOTH a baseline and an observed value, so a caller logs the real saving via `telemetry.record`/`recordSample({ baselineValue, observedValue })` when the before/after is known. `savedStats` clamps negative savings to 0.

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

- Decision: (B1) `memory.capture` persists a PRE-DISTILLED Playbook input; it does NOT distill a session. The router only validates (Zod), redacts free text, derives multi-label area tags from `touchedPaths` (merging any explicit labels the caller passes), and persists a `provisional` row. **The seam B2 must call** is the `capture` input shape: `{ projectId: string|null, intent: string, touchedPaths: string[], areaTags?: AreaTag[], commands: string[], gotcha: string|null, diffShape: string|null, validation: string|null, provenance: { prNumber: number|null, url: string|null, taskId: string|null } }` (exported as `MemoryCaptureInput`). B2 owns turning a finished session INTO this shape.
  Rationale: Keeps B1 a clean, testable persistence/validation layer; distillation (model-driven, session-aware) is B2's concern and shouldn't leak into the data model.
  Date/Author: 2026-06-22, B1 implementation.

- Decision: (B1) Later-milestone procedures are STUBBED as typed, non-throwing returns (`{ implemented: false, milestone: "B3"|"B4"|"B5" }`, with `retrieve` also returning `playbooks: []`) rather than `throw new TRPCError("NOT_IMPLEMENTED")`.
  Rationale: A thrown stub would break any caller/typecheck that wires the procedure early; a typed empty result lets the renderer + MCP server bind to the full surface now and light up as milestones land.
  Date/Author: 2026-06-22, B1 implementation.

- Decision: (B1) `confidence` is stored as an INTEGER 0–100 (not a 0–1 float) because the host SQLite columns are integer; the pure-logic `Playbook.confidence` type is `number` and B4's ranking helper works on relative scores, so the unit is an internal storage choice. `confirm` defaults to 80; `demote`/archive resets to 0.
  Rationale: Avoids a float column + keeps confidence human-readable in the DB; revisit if B4 needs sub-integer resolution.
  Date/Author: 2026-06-22, B1 implementation.

- Decision: (B3) Exported-symbol extraction uses the **TypeScript compiler API** (`ts.createSourceFile`, no Program/type-checker) since `typescript` is already a host-service dep, with the pure **regex extractor** in `@superset/memory` as the fallback (non-TS files, or any compiler throw). No heavyweight new parser dependency (honors Assumption A12).
  Rationale: The compiler API is accurate for top-level exports and already in the tree; the regex extractor keeps `packages/memory` pure/portable and serves as a robust fallback. A full Program/type-checker would be far more expensive than the "lightweight" the plan calls for.
  Date/Author: 2026-06-22, B3 implementation.

- Decision: (B3) The incremental index refresh hooks the existing **`GitWatcher.onChanged`** seam (debounced, per-workspace, carries changed paths) rather than installing a second `@parcel/watcher` over each worktree. Broad (path-less) change events are skipped for targeted refresh and left to an explicit `reindex`.
  Rationale: Reuses proven plumbing, avoids duplicate native watchers/inotify pressure, and keeps B3 additive. A path-less event means "many things changed" (commit/branch/fetch) where a full reindex is the right tool, not a guessy partial refresh.
  Date/Author: 2026-06-22, B3 implementation.

- Decision: (B3) The lexical layer **reuses** `workspace-fs` `searchContent` (ripgrep + built-in JS-scan fallback) and adds a guard so a missing `rg` binary degrades to scan/`[]` WITHOUT throwing; file enumeration for the structural map uses `getSearchIndex` (fast-glob), which never invokes ripgrep. Tests inject a throwing `runRipgrep` so the suite needs no real `rg`.
  Rationale: The environment (and many user machines) may lack ripgrep; the index must stay fully functional (structurally always, lexically via JS scan) without it. Reusing workspace-fs read-only respects the "do not modify workspace-fs" constraint.
  Date/Author: 2026-06-22, B3 implementation.

- Decision: (B2) The DEFAULT capture path is fully LOCAL + DETERMINISTIC — NO model call, NO new network egress. Distillation is a pure `@superset/memory` function over a local git-diff file list + the PR title/body; the only external read is the local git subprocess (host-side). Optional model enrichment is deferred and, if ever added, must ride the user's already-running agent session, never originate egress from the memory subsystem.
  Rationale: The wave's HARD CONSTRAINT is local-only + egress-free; the plan's "distills via a cheap model" is satisfied as a deterministic local distillation that delivers the same Playbook shape at zero token/network cost and keeps the subsystem trivially auditable.
  Date/Author: 2026-06-22, B2 implementation.

- Decision: (B2) The PR-time "Save to memory?" prompt mounts on the v2 PR-flow state (`PRActionHeader`/`usePRFlowState` → `pr-exists`), NOT on a PR-create success callback, and is shown at most once per `${projectId}:${prNumber}` via a persisted zustand store (Save and Skip both mark-answered; only Save persists). On Save it calls a NEW host procedure `memory.captureFromPR({ workspaceId, projectId, prNumber, prUrl, prTitle, prBody?, baseBranch?, commands?, validation?, taskId? })` which gathers+distills+persists host-side, keeping the renderer free of fs/git/Node.
  Rationale: v2's renderer "Create PR" path is gated off and runs via a chat command (no reliable create-success callback), so observing the PR-flow state catches a PR however it comes to exist; a single host procedure keeps capture to one round-trip and the renderer browser-safe.
  Date/Author: 2026-06-22, B2 implementation.

- Decision: (B2) Confirm-on-merge / demote-on-close hooks `PullRequestRuntimeManager.upsertPullRequestRow` (the single PR-state write site) via an optional `onPullRequestTerminal` listener fired on the first prev→next transition into `merged`/`closed`; `app.ts` wires it to `reconcilePlaybooksForPr`, which matches provisional playbooks by `(projectId, provenance.prNumber)`. Merged ⇒ `confirmed` (+confidence 80); closed-unmerged ⇒ `demoted` (+confidence 0) AND the gotcha is prefixed `[anti-pattern] PR closed without merging…` (A9 anti-pattern capture). Idempotent (only `provisional` rows are matched) and a no-op when no playbook exists.
  Rationale: Reuses the proven event-driven PR sync with zero new GitHub calls/watchers and keeps the PR runtime decoupled from memory. The anti-pattern is captured cheaply from the FREE merge signal (close-unmerged) rather than parsing review rejections, which aren't reliably available locally — honest best-effort per A9; a confirmed playbook stays a positive example, a demoted+flagged one a negative one.
  Date/Author: 2026-06-22, B2 implementation.

- Decision: (B4a) The local memory MCP server is a SEPARATE `@superset/mcp/memory` export (`createMemoryMcpServer(provider)` reading an injected `MemoryDataProvider`), NOT an extension of the cloud org-scoped `createMcpServer`. host-service supplies the provider over its local SQLite memory tables.
  Rationale: The cloud server imports `@superset/db/client` (Postgres) + requires org auth context — pulling memory into it would break the wave's local-only + egress-free constraint. Provider injection keeps `@superset/mcp/memory` free of any host-only/cloud dep, makes the server trivially testable in-memory, and guarantees no network egress. The pull bundle is produced by the same `MemoryRetrieveService` the tRPC `retrieve` uses, so MCP and tRPC return identical results.
  Date/Author: 2026-06-22, B4a implementation.

- Decision: (B4a) Bundle assembly + ranking + size-cap live as PURE helpers in `@superset/memory` (`assembleRetrievalBundle`), with the host service only loading rows + recording telemetry. Token budget uses a ~4-chars/token estimate (no tokenizer dep); the cap trims lowest-ranked **index slices → playbooks → practices**, keeping practices (the durable layer) last.
  Rationale: Keeps the scoring/trimming logic portable + unit-testable in isolation and reusable by a future renderer/MCP consumer; the heuristic estimate is sufficient for a budget and stays egress-free. Practices-last reflects their highest signal-per-token.
  Date/Author: 2026-06-22, B4a implementation.

- Decision: (B4a) Push delivery is a generated skill at `.agents/skills/superset-memory/SKILL.md` (via `generateMemorySkill`, idempotent overwrite), pointing agents at the `superset-memory` MCP tools. The MCP PULL path is the priority; the skill is the lightweight discovery hint (auto-loaded through the existing `.claude/skills` → `.agents/skills` symlink).
  Rationale: Provider-agnostic delivery (A8) wants the pull surface first; a single generated, regenerate-safe artifact satisfies the Claude-native push without over-building a CLAUDE.md mutator. Keeping it additive + idempotent avoids drift.
  Date/Author: 2026-06-22, B4a implementation.


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

### Part A — completion (2026-06-22)

All five Part-A milestones (A1–A5) landed on `claude/keen-euler-e9b3x8`, pushed per-milestone:
- **A1** `4f4459f6d` — group explorer New/Rename/Delete/Move for all roots via `{groupId,rootId}` writes.
- **A2** `46a2eaaac` — corrected stale "folder roots can't be edited yet" banner/doc + removed `TODO(group-content-search)`.
- **A3** `f2877ec35` — content-search hits focus the matched line (focusLine/focusColumn threaded → `CodeEditorAdapter.revealPosition`).
- **A4** `525003514` — `workspace-client` event-bus test harness (9 tests).
- **A5** — this section (E2E checklist + auto-verification + human handoff).

Part-A standing gates at completion (all GREEN): `bun run typecheck` 28/28; `bun run lint` exit 0; per-package tests — host-service **757 pass / 0 fail / 8 todo (765)**, workspace-fs **41/0**, workspace-client **9/0** (new), v2-group + v2-workspace renderer areas **127/0**; production **electron-vite bundle builds** (renderer + main + preload, exit 0).

### A5 — Interactive end-to-end: auto-verification + human handoff

The wave-1/2 interactive GUI acceptance was never run (it requires a human at the running Electron app: dev sign-in, native folder pickers, clicking through the UI, launching a real agent). An agent cannot drive that headlessly. A5 therefore (1) writes the script as an explicit checklist, (2) auto-verifies everything checkable without the GUI, and (3) records the remainder as a human handoff.

#### (1) Step-by-step E2E checklist (run by a human; from the wave-2 "Validation and Acceptance" + wave-3 A1/A3 additions)

1. `bun dev`; sign in as dev (per `DEVELOPMENT.md`).
2. Create a multi-root workspace. **Add two directories that are different git repos** via "Add folder → Set up & create worktree" (wave-2 M4). Both become editable, worktree-capable roots.
3. From the group, **create a fresh worktree (new branch) in each repo** (wave-2 M3). Each appears as a root with its own Changes panel.
4. **Add one plain (non-repo) folder.** Open a file in it; edit + save — confirm on disk (wave-2 M1). Change it from an external terminal — confirm the tree/editor **live-refresh** (wave-2 M6).
5. **[NEW — A1] In EACH root (workspace AND folder): from the explorer, create a file, create a folder, rename one, move/rename a nested entry, and delete one** — via the per-section New File / New Folder header buttons and the row right-click context menu (Rename / Delete; New File / New Folder on directories). Expected: every op lands on disk (verify in a terminal) and the tree live-updates with no manual refresh.
6. Open files from both repos in one editor; edit + save each; confirm each lands in the correct worktree on the correct branch.
7. **Launch the combined agent**; `ls -la` the synthetic root shows every current root (wave-2 M5). Ask it to read a file unique to each repo and edit in each; confirm. **Click a path** in its terminal output — opens in the editor (wave-2 M7).
8. Run a **cross-root content search** (wave-2 M8); matches from both repos appear, labeled per root. **[NEW — A3] Click a match — the file opens in the correct root scrolled to and with the cursor on the matched line/column** (re-clicking the same hit re-scrolls).
9. Quit and relaunch; the group, roots, and worktrees persist (wave-1 SQLite). Delete the group; confirm the worktrees survive and the `group-roots/<id>` synthetic dir is removed (wave-2 M2/Q5).

#### (2) Auto-verified without the GUI (PASS)

- **typecheck** `bun run typecheck` → 28/28. **lint** `bun run lint` → exit 0 (the renderer `noRestrictedImports` Node-import rule is part of this; new renderer files grep-clean of `node:*`/host imports).
- **Full relevant test suites:** host-service **757/0** (+8 todo), workspace-fs **41/0**, workspace-client **9/0** (A4), v2-group + v2-workspace renderer **127/0**, A1 `groupTreePaths` 11/0.
- **On-disk `{groupId,rootId}` write proof (the A1 substrate, scriptable without the GUI):** the existing integration test `packages/host-service/test/integration/filesystem-group-writes.integration.test.ts` exercises the host FS write procs against a real on-disk **folder root** addressed by `{groupId, rootId}` and asserts `writeFile` (incl. base64), `createDirectory`, `deletePath`, `movePath` (rename), and `copyPath` all land on disk, that writes stay sandboxed to the root, that an unknown `rootId` is rejected, and that the `{workspaceId}` form is unchanged — **9/0**. This is exactly the create/rename/delete/move that A1's explorer drives; A1 is renderer orchestration over this proven host path.
- **Production bundle:** `electron-vite build` (the renderer+main+preload compile inside `compile:app`) → **exit 0**, so all Part-A renderer changes compile into the shipping bundle.
- **Pre-existing, environment-limited failures (NOT Part A):** running the *entire* renderer suite (`bun test apps/desktop/src/renderer`) reports failures only in `lib/terminal/appearance/appearance.test.ts` and `screens/main/.../useOrderedSections/useOrderedSections.test.tsx` — they fail on a missing Electron preload (`Could not find electronTRPC global`) and the absence of a real canvas / `FontFaceSet` in the headless runner. Neither file is touched by any Part-A commit (`git diff 7abf4e95e..HEAD` does not include them); they are the same class of env-only failure the wave-2 plan documented. CI runs `turbo test` per-package (isolated), where the Part-A packages are green.

#### (3) Human handoff — GUI-only steps that remain

Checklist steps **1–9 above require a human** at the running Electron app (dev sign-in + native folder pickers + clicking through + launching a real agent). They are NOT executable headlessly by the agent. The structural correctness of each is backed by the unit/integration tests + the production bundle build listed in (2); the A1 explorer-mutation host path is additionally proven on-disk by `filesystem-group-writes.integration.test.ts`. **Action for a human reviewer:** run steps 1–9, paying special attention to the two NEW behaviors — **(5)** explorer create/rename/delete/move in BOTH a workspace root and a folder root, and **(8)** content-search line-focus on open — and file any discrepancy as a follow-up.

#### Optional spike — Playwright-electron e2e driver (time-boxed evaluation, no production change)

Evaluated, not built. `@playwright/test`'s `_electron.launch({ args: [appMain] })` can drive a packaged Electron app and would give a repeatable smoke test for steps 5/8. Blockers that make it a separate, non-trivial follow-up (out of A5's scope): (a) it needs the **dev sign-in** flow automated or a test-auth bypass (the app gates on Clerk auth before any group route mounts); (b) the **native folder picker** (`window.selectDirectory` Electron IPC) must be stubbed to return fixture repo paths, since Playwright can't drive the OS file dialog; (c) it needs a deterministic **fixture host-service** with seeded projects/worktrees on a temp `SUPERSET_HOME_DIR`. None of these are blockers for shipping Part A (the host write path + bundle are proven), so a Playwright-electron smoke harness is recorded here as a recommended future follow-up rather than added now.

### Part B — to be filled in as B1–B7 land.

Compare against the Purpose: multi-root is genuinely finished (explorer mutations, line-focus, tested event bus, and an auto-verified-plus-human-handoff end-to-end), and Superset Memory captures successful tasks at PR time, indexes the project lightly (semantically if a local model is present), feeds memory back via MCP to make runs cheaper and more consistent, consolidates durable practice at two scopes under user review, and renders a local knowledge graph — all local, additive, and egress-free.


## Future (explicitly out of scope this wave)
- **Organization/cloud shared tier:** promote confirmed Playbooks/Practice to an org-scoped shared store keyed by `organizationId`, synced over the existing channel, with redaction + curation governance. Designed-for (the local model maps cleanly onto it) but not built now.


---

### Revision note

- 2026-06-23 03:06Z — Initial wave-3 draft. Part A closes the audited wave-1/2 gaps (group explorer mutations, stale messaging, content-search line focus, workspace-client event-bus tests, and an actual interactive end-to-end run). Part B specifies Superset Memory — a local-first capture→index→retrieve→consolidate loop with an Obsidian graph and an MCP delivery surface — encoding the user's decisions (global practice by button only; lightweight index default with optional local-only embeddings; PR-time capture; local-only; provider-agnostic via MCP; prune-not-append consolidation). Assumptions A1–A12 listed; no open questions per user direction. Keeps Strategy A and changes no cloud schema.
