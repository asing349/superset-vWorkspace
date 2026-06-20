# Multi-repo worktree composition + first-wave gap closure (multi-root workspaces, wave 2)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Reference: This plan follows conventions from `AGENTS.md` (repo root) and the ExecPlan template in `.agents/skills/create-plan/SKILL.md`. It is the **second wave** on top of `plans/20260619-0604-multi-root-workspaces.md` (the first wave, already implemented on this branch). Read that file for the foundational design; this plan does not repeat it.


## Purpose / Big Picture

Wave 1 delivered local, same-host **multi-root workspaces**: a "group" that contains several "roots" (existing repo worktrees and/or plain folders), shown in one explorer, with per-repo Changes, terminals per root, and a single combined agent that can read/edit across all roots. Two things are still missing for the experience the product is aiming at:

1. **You cannot create worktrees across repos from inside a multi-root workspace.** Today you must create each worktree through the normal per-project New Workspace flow first, then compose them into a group. And a directory you drop in that *is* a git repo is treated as a degraded, read-only "folder" root — it cannot become a real, worktree-capable root.

2. **First-wave gaps remain.** Plain-folder roots are read-only in the GUI editor; folder roots don't live-refresh on external change; the combined-agent terminal's output paths aren't clickable; cross-root *content* search isn't wired; and there are a handful of correctness loose ends (a stale "default root" after a worktree is deleted, an orphaned symlink directory left on group delete, a document-cache key that ignores root addressing, and an unguarded double-invocation of the agent-root preparer). The interactive end-to-end acceptance from wave 1 was also never actually run.

After this wave, a user can: open a multi-root workspace; **add two different git repos** (by picking their folders) and have each become a first-class, editable, worktree-capable root; **create a fresh worktree (new branch) in each repo from inside the group**; **edit any root** (repo *or* plain folder) in the GUI with live refresh; and **launch one agent that sees every worktree** with shared context — with clickable terminal paths and no leaked state. You can see it working by building the desktop app (`bun run dev`), composing two repos + worktrees in one group, editing across them, and running the combined agent end-to-end (the full acceptance script is in "Validation and Acceptance").

This wave keeps the wave-1 discipline: **Strategy A** (compose existing primitives; do not modify the single-worktree primitive, the panes engine, `packages/workspace-fs`, or the cloud schema), **local-only / same-host**, and **reuse the existing worktree-creation and project-import flows wholesale** rather than writing new git plumbing.


## Definitions (read this first; self-contained)

- **Worktree**: a directory that is one checked-out branch of one git repo, created by `git worktree add` under `~/.superset/worktrees/<projectId>/<branch>`. In Superset it corresponds to one host-local `workspaces` row with a single `worktreePath`.
- **Project**: a registered repo on this machine. The host keeps a `projects` row with a single `repoPath` (the main checkout). Worktrees can only be created for a registered project (worktree creation requires a `projectId`).
- **Group (multi-root workspace)**: the wave-1 container. A named, ordered list of **roots**, stored locally (host SQLite). Source of truth is the host `workspaceGroup` tRPC router; the renderer stores only pane layout.
- **Root**: one entry in a group, with a `kind`:
  - `kind:"workspace"` → references an existing worktree by `workspaceId`. Full git, editable, terminal-by-workspace.
  - `kind:"folder"` → an arbitrary absolute path (the native picker result). Treated as a plain directory: no git, read-only in the GUI editor today, no worktree creation. Has no `workspaceId`; addressed by `{groupId, rootId}`.
- **tRPC**: typed remote-procedure layer. A "router" groups named "procedures" the client calls. The host root router is `packages/host-service/src/trpc/router/router.ts`.
- **host-service**: the per-machine backend (`packages/host-service`) — tRPC server + local SQLite. Owns all on-disk paths, the filesystem service, terminals, git, and (wave 1) the `workspaceGroup` store + agent-root preparer.
- **FS service**: `createFsHostService({ rootPath })` from `packages/workspace-fs` — serves reads **and writes** for exactly one root path, sandboxed (`isPathWithinRoot`). The host caches one per distinct path. Wave 1 added `getServiceForRootId({groupId, rootId})` that resolves a root to a path and reuses this cache.
- **Read vs write addressing**: wave 1's host filesystem **read** procedures accept either `{workspaceId}` or `{groupId, rootId}` (`readAddressingSchema` in `packages/host-service/src/trpc/router/filesystem/filesystem.ts`). The **write** procedures (`writeFile`, `createEntry`, `deleteEntry`, `moveEntry`, `rename`) and `statPath` accept `{workspaceId}` only — this is the root cause of folder-root read-only and non-clickable agent paths.
- **prepareAgentRoot**: `packages/host-service/src/runtime/workspace-groups/prepare-agent-root.ts` — builds `~/.superset/group-roots/<groupId>/` containing one **symlink** per resolved root, idempotently reconciled, and is used as the cwd for the combined-agent terminal (which also exports `SUPERSET_ROOTS`).
- **fs:events**: the host's filesystem change stream consumed by the renderer file trees. Wave 1 wires it per `workspaceId` (`packages/host-service/src/events/`), so folder roots (no `workspaceId`) don't get live updates.
- **Electron renderer / main**: the desktop app's browser process (`apps/desktop/src/renderer`, no Node APIs) and Node process (`apps/desktop/src/main`). The renderer reaches host-service over tRPC-over-WebSocket; native pickers go through Electron IPC.


## Assumptions

- A1. The base for this wave is the wave-1 implementation already on branch `claude/keen-euler-e9b3x8`. All wave-1 files referenced here exist on that branch.
- A2. All roots and worktrees are on the **same host** (carried from wave-1 A1). No cross-host work.
- A3. Worktree creation reuses the **existing** host `workspace.create` path (the same one the desktop New Workspace modal drives via its create hook). Repo import reuses the **existing** `project.findByPath` / `project.create` (importLocal) / `project.setup` procedures. No new git or clone code is written.
- A4. The combined agent already spans all roots via `prepareAgentRoot` + `SUPERSET_ROOTS`; newly created worktree roots flow through it with no agent-code change (they are ordinary `kind:"workspace"` roots).
- A5. The group definition stays host-owned (SQLite from wave-1 M7); the renderer keeps storing only pane layout. No cloud (`packages/db`/`packages/trpc`) schema change.
- A6. `packages/panes`, `packages/workspace-fs`, and `packages/workspace-client` remain unmodified (instantiated per root only), exactly as wave 1.


## Open Questions

- Q1. Folder-repo promotion (M4): when a `kind:"folder"` root that is actually a git repo is promoted to a worktree root, do we **replace** the folder root or keep both? Default: **replace** (the worktree is the working copy; two roots over overlapping paths is confusing). → Decision Log D-Q1.
- Q2. Create-worktree-and-add orchestration (M3/M4): **renderer two-step** (`workspace.create` then `workspaceGroup.addRoot`; simplest, reuses tested hooks; an `addRoot` failure leaves a recoverable orphan worktree) vs a **host atomic** `workspaceGroup.createWorktreeRoot` (one unit, rolls back the worktree on failure, but couples the group router to the workspaces router). Default: **renderer two-step for this wave**, host-atomic only if orphans prove annoying. → D-Q2.
- Q3. Dangling `defaultRootId` fix (M2): **reconcile-on-read** (when `defaultRootId` is not in `roots`, treat as null in `resolve`/`buildGroup`) vs **self-referential FK** `ON DELETE SET NULL` on `default_root_id`. Default: **reconcile-on-read** (cheapest, no migration), and additionally null it in the store mutations' read path. → D-Q3.
- Q4. Cross-root content search (M8): ship a minimal results panel this wave, or keep deferred? Default: **ship minimal** (host `searchContent` is already group-addressable), lower priority than M1–M5. → D-Q4.
- Q5. Group delete vs worktrees (M2/M5): deleting a group must **not** delete the worktrees it referenced. Default: **never delete worktrees on group delete**; offer an explicit per-root "remove root **and** delete its worktree" action separately. → D-Q5.


## Progress

- [x] (2026-06-20) M1 — Folder-root editing. Host: shared `addressingSchema` ({workspaceId}|{groupId,rootId}) now covers the 5 FS write procs (`writeFile`/`createDirectory`/`deletePath`/`movePath`/`copyPath`), routed via `getServiceForRootId` (`127f926d7`). Renderer: `writeAddressing()` in fileDocumentStore `save()`; folder roots route to the editable `FilePane`, `GroupReadOnlyFilePane` only for `exists:false` (`a48be7b2f`). Pushed. host tests 731 pass / 0 fail, typecheck 28/28, lint clean. NOTE: group-**explorer** mutations (New/Delete/Rename/Move) remain unwired for ALL group roots (pre-existing, not folder-specific) — tracked as a follow-up; editor save is fully working.
- [x] (2026-06-20) M2 — Group correctness fixes. Host (`64e4aeaa8`): reconcile-on-read dangling `defaultRootId` (shared `reconcileDefaultRootId` in in-memory/sqlite/resolver; no migration per Q3); `workspaceGroup.delete` best-effort `rmSync(group-roots/<id>)` — symlink dir only, worktrees untouched (Q5); `prepareAgentRootSerialized` per-group mutex at both double-invoke sites (`resolveRootTarget` now async). Renderer (`c9ff4b9cb`): document-cache key now `(addressing, absolutePath)` via `documentAddressingKey` (`ws:<id>` | `group:<gid>:<rid>`). Pushed. host tests 737 pass / 0 fail, typecheck 28/28, lint clean. Startup GC sweep skipped (optional per plan).
- [x] (2026-06-20) M3 — Create-worktree-in-group (existing project) → auto-add as root. `CreateWorktreeDialog` in the group Add-root surface (project picker + base-branch selector + new-branch input) → host `workspaces.create` → `workspaceGroup.addRoot({kind:workspace})` → refresh (Q2 renderer two-step). Reuses host `project.list` + `workspaceCreation.searchBranches` + `useWorkspaceGroups`; no new git code. Committed `111b1297c`, pushed — typecheck 28/28, lint clean.
- [x] (2026-06-20) M4 — Repo-folder import/promotion → first-class worktree root. "Add folder" classifies via host `project.findByPath` then `project.setup` (1 candidate) / `project.create` importLocal (0 candidates), then runs M3's worktree flow via a project-pinned `CreateWorktreeDialog`; non-repos stay `kind:folder`. "Promote to repo" replaces a repo folder root (add worktree root → `removeRoot` folder, Q1). Mirrors `useFolderFirstImport`; no new git code. Committed `1846f4a2a`, pushed — typecheck 28/28, lint clean.
- [ ] M5 — Combined-agent UX: re-prepare on root change + "roots visible to agent" affordance.
- [ ] M6 — Folder-root live fs-events (group-addressed watch channel) so folder trees + open docs refresh.
- [ ] M7 — Clickable combined-agent terminal paths (group-address `statPath`).
- [ ] M8 — Cross-root content search panel (optional; host already group-addressable).
- [ ] M9 — Test + interactive end-to-end backfill (wave 1 **and** wave 2). LAST.

Timestamp each item when checked off (e.g. `- [x] (2026-06-20 14:00Z) ...`); split partials into done/remaining.


## Surprises & Discoveries

- Observation: The write capability for folder roots already exists at the lowest layer — only the tRPC boundary is missing.
  Evidence: `createFsHostService` (`packages/workspace-fs/src/host/service.ts`) implements `writeFile`/`createDirectory`/`deletePath`/`movePath`/`copyPath` against any `rootPath`; wave-1 `getServiceForRootId` already returns a write-capable service for folder roots. The gap is that `packages/host-service/src/trpc/router/filesystem/filesystem.ts` write procedures accept `{workspaceId}` only.

- Observation: The agent/shared-context half of "multi-repo, one agent" needs no new code.
  Evidence: `prepare-agent-root.ts` iterates resolved roots regardless of kind; new worktree roots are ordinary `kind:"workspace"` roots and are symlinked + exported in `SUPERSET_ROOTS` automatically.

- (M1 host) The plan's prose named the write procs `writeFile, createEntry, deleteEntry, moveEntry, rename`, but the ACTUAL filesystem router procedures are `writeFile, createDirectory, deletePath, movePath, copyPath` (5 mutating procs). Those were extended. The shared schema is named `addressingSchema` (renamed from wave-1 `readAddressingSchema`); resolver `resolveServiceInput`. It now covers 9 procedures (4 reads incl. `searchContent`, + the 5 writes). `statPath` and `searchFiles` were intentionally left (statPath → M7; searchFiles keeps its own 3-way refine).

- (M1 host, test fixture) On macOS `mkdtempSync` under `tmpdir()` returns a `/var/folders/...` symlink to `/private/var/...`; the FS service realpath-sandbox (`assertRealpathWithinRoot`) makes `deletePath`/`movePath`/`copyPath` reject targets unless the group's stored folder-root path is canonicalized. Host tests using a temp dir as a `kind:"folder"` root must wrap it in `realpathSync(...)`. Test-fixture detail only; not a procedure behavior change.

- (M1 renderer) **Group-explorer file mutations are unwired for the group shell entirely** — `GroupFilesTab`/`useFileTree` are navigation-only and have NO New File/Folder/Delete/Rename/Move actions for ANY root kind (workspace or folder). So folder roots are already at parity with workspace roots inside the group explorer; the folder-vs-workspace disparity M1 targets was specifically the EDITOR read-only gate, now closed. The single-workspace explorer's mutations live in `useFilesTabActions` (`v2-workspace/.../FilesTab/hooks/useFilesTabActions/`, `{workspaceId}`-only). Wiring group-explorer mutations would mean a new group-addressed actions hook mirroring `useFilesTabActions` with `{groupId,rootId}` — pure renderer orchestration (host writes already accept the union). Tracked as a low-priority follow-up; NOT an M1 blocker.

- (M2 host) The genuinely dangling `defaultRootId` case is the **SQLite workspace-row FK cascade**: deleting a `workspaces` row cascades the `kind:"workspace"` root out of `workspace_group_roots`, but `default_root_id` is plain text with no self-FK, so it's left pointing at the removed rootId. The in-memory/sqlite `removeRoot` mutation path already nulled a self-removed default; reconcile-on-read covers the cascade path. Test asserts the raw column genuinely dangles, then `get`/`list`/`resolveGroup` all reconcile it to null.

- (M2 host) `prepareAgentRoot` is double-invoked by design (launcher + terminal `createSession`/`resolveRootTarget`); `prepareAgentRootSerialized` (a `Map<groupId, Promise>` chain) now serializes same-group calls (different groups stay parallel). `resolveRootTarget` in `terminal/router/terminal.ts` became `async` as a result.

- (M2 renderer) **Pre-existing wiring gap (follow-up):** `useGroupPaneRegistry.onBeforeClose` calls `getDocument(workspaceId, filePath)` WITHOUT addressing, so after the M2 cache-key change a dirty **group-root** doc can be missed by the dirty-on-close guard and close without prompting. The load-bearing acquire/release ref-counting is fully fixed; only this read-only lookup needs the pane's `groupAddressing` threaded in. `useGroupPaneRegistry` is touched again in **M7** (editing half), so this one-liner is folded into M7. Tracked.

- (M3, CRITICAL) The Electron-IPC `useCreateWorkspace` hook (`electronTrpc.workspaces.create`) writes the Electron-main `localDb` only — it does NOT register a row in the **host-service `workspaces` table** that `workspaceGroup.addRoot`'s resolver reads. The plan's prose "`useCreateWorkspace` → host `workspace.create`" describes intended semantics, but on this branch that hook routes to the wrong layer (its id would be an unaddable orphan to the group resolver). The two layers share one UUID namespace (host writes the cloud `v2Workspace.id` verbatim), but only the **host `workspaces.create`** procedure (called via `getHostServiceClientByUrl`, the same path `useWorkspaceGroups` uses) registers the resolvable row. M3/M4 therefore drive host `workspaces.create` directly. The branch search is host `workspaceCreation.searchBranches`. The project list is host `project.list` (authoritative for worktree-capable host-resolvable ids), not the cloud `v2Projects` collection alone.

- (M3) `@superset/ui` has no `command`/`combobox` primitive (only `popover`); the house pattern for pickers is a search-input + scrolled list (mirrored from wave-1 `AddExistingWorkspaceDialog`). The New Workspace UI's `ProjectPickerPill`/`CompareBaseBranchPickerInline` are inlined inside `PromptGroup` and not importable, so M3 built compose-owned picker equivalents driving the same host queries (charter-permitted).

- (M4) Real `project.findByPath` shape: `{ repoPath }` → `{ candidates, cloudErrors }` for a repo, or `{ candidates:[], cloudErrors:[], needsGitInit:true }` for a non-repo. Branch by candidate COUNT, not source: **1 candidate → `project.setup({ projectId, mode:{kind:"import", repoPath} })`; 0 → `project.create({ name, mode:{kind:"importLocal", repoPath} })` → `{ projectId }`**. `project.setup` already reconciles both a known local row and a cloud-known-but-not-local project, so source-level branching is unnecessary (matches the canonical `useFolderFirstImport`). `candidates.length > 1` is treated as ambiguous → bail with a clear message (host setup needs exactly one projectId).

(Add observations as work proceeds.)


## Decision Log

- Decision: This wave both closes wave-1 gaps and adds multi-repo worktree composition, on the same branch, reusing the existing worktree-creation and project-import flows.
  Rationale: User-directed. The git/clone/worktree engine and project import are mature and tested; the missing capability is pure orchestration + UI, keeping Strategy A intact.
  Date/Author: 2026-06-19, planning session.

- Decision: Carry wave-1's invariants unchanged — Strategy A, local-only/same-host, host-owned group state, untouched panes/workspace-fs/workspace-client/cloud schema.
  Rationale: Consistency and low blast radius; wave 1 proved the seams.
  Date/Author: 2026-06-19, planning session.

- D-Q1..D-Q5 (pending): see Open Questions; defaults recorded there stand unless changed here.


## Context and Orientation

Affected app: `apps/desktop` (Electron renderer). Affected package: `packages/host-service` (tRPC + SQLite + filesystem/terminal/events). Untouched: `packages/panes`, `packages/workspace-fs`, `packages/workspace-client`, `packages/db`, `packages/trpc`.

Wave-1 files this wave edits or extends (full paths; all present on this branch):

Host-service:
- `packages/host-service/src/trpc/router/filesystem/filesystem.ts` — read procedures use a `{workspaceId} | {groupId,rootId}` addressing union; **write procedures and `statPath` are `workspaceId`-only** (M1, M7 extend these).
- `packages/host-service/src/runtime/filesystem/filesystem.ts` — `getServiceForRootId`, the per-root FS-service cache (reused by M1/M6/M7).
- `packages/host-service/src/runtime/workspace-groups/{types,store,sqlite-store,resolve,prepare-agent-root}.ts` and `packages/host-service/src/trpc/router/workspace-group/workspace-group.ts` — the group store/router (M2, M3, M5).
- `packages/host-service/src/db/schema.ts` — `workspace_groups.default_root_id` is plain `text()` with no FK (M2, Q3).
- `packages/host-service/src/events/event-bus.ts` and `.../events/git-watcher.ts` — `fs:events` keyed by `workspaceId` (M6 adds a group-addressed channel).
- `packages/host-service/src/terminal/terminal.ts`, `.../terminal/env.ts`, `.../trpc/router/terminal/terminal.ts` — terminal/agent wiring (M5, M7 read paths).
- Existing reuse targets (NOT modified, only called): the worktree-creation router (`packages/host-service/src/trpc/router/workspaces/workspaces.ts`, `workspace.create`) and the project router (`packages/host-service/src/trpc/router/project/project.ts` — `create`/`setup`/`findByPath`).

Desktop renderer (under `apps/desktop/src/renderer/`):
- `routes/_authenticated/_dashboard/v2-group/$groupId/hooks/useGroupPaneRegistry/useGroupPaneRegistry.tsx` — dispatches folder roots to `GroupReadOnlyFilePane` (M1 flips this), and `resolveStatWorkspaceId` returns null for non-workspace roots (M7).
- `.../v2-group/$groupId/hooks/useGroupPaneRegistry/components/GroupReadOnlyFilePane/` and `.../GroupTerminalPane/GroupTerminalPane.tsx` (M1, M7).
- `routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore/fileDocumentStore.ts` — `save()` sends `{workspaceId}`; `readAddressing()`; `acquireDocument` keys by `${workspaceId}:${absolutePath}` (M1, M2).
- `.../v2-group/$groupId/components/GroupManageButton/`, `.../GroupSidebar/`, `.../components/AddRootMenu`, `WorkspaceGroupManageDialog`, `WorkspaceGroupCreateDialog`, `hooks/useWorkspaceGroups` (M3, M4, M5).
- The New Workspace modal + its create hook (`routes/.../v2-workspace/$workspaceId/...NewWorkspaceModal*` and `react-query/workspaces/useCreateWorkspace`) and project picker/branch selector — **reused** by M3/M4.
- `hooks/host-service/useFileTree/useFileTree.ts` — group-addressed tree (M6 wires its refresh to the new event channel).
- `.../v2-group/$groupId/hooks/useGroupFileSearch/` and `.../components/GroupQuickOpen/` (M8 adds content-search sibling).

How it fits together today: a group is opened at `/v2-group/$groupId`; the shell queries `workspaceGroup.get` for resolved roots; folder roots render read-only; worktree roots are editable; the combined-agent terminal launches at the `prepareAgentRoot` synthetic dir. This wave fills the write path for folder roots, adds worktree creation/import into the group, makes folder roots live and agent paths clickable, and hardens correctness.


## Plan of Work

Nine milestones. M1–M2 are foundational gap fixes (independent, low-risk). M3–M5 are the new multi-repo composition capability. M6–M8 are richer UX gap closure. M9 is verification, and runs LAST. M1, M2, M3–M5, M6, M7, M8 are largely independent and can be parallelized across teammates by file ownership (host vs renderer vs group-router), but M9 depends on all.

Throughout, follow `AGENTS.md`: Bun only; object-param signatures for 2+ args; no `any`/`@ts-ignore`/empty catch; renderer must not import Node modules (`bun run lint:check-node-imports`); run `bun run lint:fix` and ensure `bun run lint` exits 0 before any commit. Keep this plan's living sections updated as milestones land.


### Milestone M1 — Folder-root editing (close the headline gap)

Scope: make `kind:"folder"` roots editable and saveable in the GUI, reusing the write engine that already serves worktree roots.

What will exist that didn't: saving/creating/deleting/renaming/moving a file inside a folder root works from the editor and lands on disk in that folder.

Plan:
- Host: in `packages/host-service/src/trpc/router/filesystem/filesystem.ts`, extend the **write** procedures (`writeFile`, `createEntry`, `deleteEntry`, `moveEntry`, `rename`) to accept the same `{workspaceId} | {groupId, rootId}` addressing union the read procedures already use (reuse the existing `readAddressingSchema` — rename to a shared `addressingSchema`), and route through `getServiceForRootId` when the group form is given. The FS service already enforces `isPathWithinRoot`, so writes stay sandboxed to the folder.
- Renderer: in `.../$workspaceId/state/fileDocumentStore/fileDocumentStore.ts`, add a `writeAddressing()` mirroring `readAddressing()` (`groupAddressing ?? {workspaceId}`) and use it in `save()` and any create/delete/move/rename calls.
- Renderer: in `useGroupPaneRegistry.tsx`, stop forcing folder roots to `GroupReadOnlyFilePane`; route them to the editable `FilePane` with `{groupId, rootId}` addressing. Keep `GroupReadOnlyFilePane` only for genuinely unresolvable roots (`exists:false`).
- The FS service's revision/`ifMatch` optimistic-concurrency precondition is path-based and already applies — no new conflict infra.

Acceptance:

    bun run typecheck && bun run lint && bun run lint:check-node-imports
    bun dev
    # Add a plain folder as a root, open a file in it, edit, save.
    # Expected: the change is written to the folder on disk (verify via a terminal `cat`).
    # Create/rename/delete a file in the folder root from the explorer; expected: reflected on disk.

Verify before proceeding: folder-root edits persist to disk; worktree-root editing is unchanged; no renderer Node imports.


### Milestone M2 — Group correctness fixes

Scope: four contained correctness fixes surfaced by the wave-1 review.

What will exist that didn't: no stale default root, no leaked synthetic dir, addressing-correct document cache, and a guarded agent-root preparer.

Plan:
- **Dangling `defaultRootId`** (Q3 default = reconcile-on-read): in `resolve.ts`/`buildGroup` (and the in-memory `store.ts`), treat `defaultRootId` as null when it is not present in the current `roots`. Optionally also add the self-FK `ON DELETE SET NULL` on `default_root_id` (needs a new drizzle-generated migration; only if Q3 is decided that way — do NOT hand-edit migrations).
- **Synthetic-dir leak**: in `workspace-group.ts` `delete`, remove `~/.superset/group-roots/<groupId>/` (reuse the path helper in `prepare-agent-root.ts`). Optionally add a startup GC sweep that removes `group-roots/*` dirs with no matching group.
- **Document-cache addressing key**: in `fileDocumentStore.ts`, include the addressing discriminator in the cache key (e.g. `${workspaceId|group:groupId:rootId}:${absolutePath}`) so the same path opened single-workspace then in a group doesn't silently reuse the wrong addressing.
- **`prepareAgentRoot` concurrency**: add a simple per-group in-process mutex/dedup so the deliberate double-invoke (launcher + createSession) and any concurrent calls serialize; the body stays synchronous.

Acceptance:

    bun test packages/host-service
    # Add/extend unit tests: removeRoot-then-cascade leaves no stale default; delete removes the synthetic dir;
    # prepareAgentRoot serializes concurrent calls.
    bun run typecheck && bun run lint

Verify before proceeding: tests cover each fix; deleting a group removes its `group-roots/<id>` dir; reopening a file across surfaces uses correct addressing.


### Milestone M3 — Create a worktree in an existing project, from inside the group

Scope: a "Create new worktree" action in the group that spins a fresh branch-worktree in an already-imported project and auto-adds it as a root.

What will exist that didn't: one-click worktree creation across repos without leaving the multi-root workspace.

Plan:
- Renderer: add "Create new worktree" to the group's Add-root menu (`AddRootMenu`/`WorkspaceGroupManageDialog`). It opens a compact picker that **reuses** the New Workspace modal's project picker + branch selector (project recents, `searchBranches`, branch-prefix logic).
- On submit (Q2 default = renderer two-step): call the existing worktree-creation hook (`useCreateWorkspace` → host `workspace.create`) to create the worktree, then `workspaceGroup.addRoot({ kind:"workspace", workspaceId })`, then refresh the group. Surface progress and reuse the modal's existing error handling (branch exists, dirty tree, clone needed). On `addRoot` failure, the worktree persists and is recoverable via "Add existing workspace."

Acceptance:

    bun dev
    # In a group, "Create new worktree" -> pick an imported project + new branch -> submit.
    # Expected: a new worktree is created (git worktree under ~/.superset/worktrees/<projectId>/<branch>)
    # and appears as an editable workspace root with its own Changes panel.

Verify before proceeding: the created worktree is a normal workspace (cloud + SQLite rows), editable, and present in the group.


### Milestone M4 — Add a repo by folder / promote a repo-folder

Scope: dropping in a directory that is a git repo yields a first-class worktree root (not a degraded folder root).

What will exist that didn't: "add two folders that are different repos" produces two worktree-capable roots.

Plan:
- Renderer: after the native folder picker returns a path, call `project.findByPath({ repoPath })`. Branch:
  - Git repo with a matchable/known project → "Set up as project & create worktree": `project.setup` if needed, then M3's create-worktree-and-add.
  - Git repo with no matching project → `project.create` (importLocal), then create-worktree-and-add.
  - Not a git repo → current plain-folder behavior (now editable via M1).
- Renderer: add a "Promote to repo" action in the manage dialog for an existing folder root that is actually a repo; it runs the above and (Q1 default = replace) removes the folder root after the worktree root is added.

Acceptance:

    bun dev
    # "Add folder" on a directory that is a git repo -> choose "Set up & create worktree".
    # Expected: it becomes a workspace root (git, editable, worktree-capable). Repeat for a second, different repo.
    # Promote an existing folder root that is a repo; expected: replaced by a worktree root.

Verify before proceeding: two different repos can be brought in as worktree roots entirely from the group UI.


### Milestone M5 — Combined-agent UX: re-prepare on root change

Scope: ensure the combined agent reflects newly added/removed roots, and show which roots it will see.

What will exist that didn't: launching (or re-launching) the combined agent always reflects the current root set; clear affordance of scope.

Plan:
- Renderer/host: when roots change (add/remove/promote), re-run `prepareAgentRoot` (idempotent) so the synthetic dir matches; for an already-running agent, surface a "relaunch agent to include new roots" nudge (the running process won't auto-see new symlinks). No agent-spawn code change.
- Renderer: a small "N roots visible to the combined agent" hint near the launch affordance, listing root labels.

Acceptance:

    bun dev
    # Create worktrees in two repos (M3/M4), launch the combined agent, `ls -la` the synthetic root.
    # Expected: one symlink per current root. Add a third root, relaunch (per nudge); expected: it now appears.

Verify before proceeding: the combined agent's synthetic root tracks the current roots; the hint is accurate.


### Milestone M6 — Folder-root live fs-events

Scope: make folder-root trees and open documents refresh on external/agent change, like worktree roots.

What will exist that didn't: editing a folder root on disk (or via the agent) updates the explorer/editor without manual refresh.

Plan:
- Host: add a group-addressed watch channel. The FS service already exposes `watchPath`; wire a `{groupId, rootId}` (or rootPath)-keyed subscription in `packages/host-service/src/events/` that emits the same `fs:events` shape as the workspace-keyed channel.
- Renderer: in `useFileTree.ts` (and the group file-navigation/open-doc refresh), subscribe to the group-addressed channel for `kind:"folder"` roots, mirroring the existing `useWorkspaceEvent("fs:events", workspaceId, …)` path for workspace roots.

Acceptance:

    bun dev
    # In a folder root, change a file from an external terminal (echo >> file; touch newfile).
    # Expected: the folder-root tree and any open document refresh live, same as a repo root.

Verify before proceeding: folder roots live-update; no duplicate/stuck watchers on group close (clean unsubscribe).


### Milestone M7 — Clickable combined-agent terminal paths

Scope: make file paths in the combined-agent (and folder-root) terminal output open in the editor.

What will exist that didn't: clicking a path emitted by the agent opens the right file in the right root.

Plan:
- Host: extend `filesystem.statPath` to accept the `{groupId, rootId}` addressing union (same change shape as M1's write procedures), routing through `getServiceForRootId`.
- Renderer: in `useGroupPaneRegistry.tsx`, make `resolveStatWorkspaceId` (or its replacement) resolve non-workspace roots via `{groupId, rootId}` so `GroupTerminalPane` can stat and link paths for folder roots and the agent root.

Acceptance:

    bun dev
    # In the combined-agent terminal, have the agent print a path under one of the roots; click it.
    # Expected: it opens that file in the editor in the correct root.

Verify before proceeding: agent-root and folder-root terminal paths are clickable; worktree-root behavior unchanged.


### Milestone M8 — Cross-root content search (optional, Q4)

Scope: a results panel that greps across all roots, mirroring the existing cross-root filename quick-open.

What will exist that didn't: search file *contents* across every root with per-root labels.

Plan:
- Renderer: add a content-search sibling to `useGroupFileSearch`/`GroupQuickOpen` that fans out the already-group-addressable host `searchContent` across roots and merges results with per-root labels (the host side needs no change). Add a minimal results panel/entry point.

Acceptance:

    bun dev
    # Run a content search across a group with two repos; expected: matches from both, labeled by root.

Verify before proceeding: results are correct and labeled; performance acceptable on a large repo.


### Milestone M9 — Test + interactive end-to-end backfill (LAST)

Scope: close the wave-1 test gaps and actually run the end-to-end acceptance for both waves.

What will exist that didn't: tests for the previously-untested seams, and a recorded human/agent run proving the feature works in the app.

Plan:
- Add host tests: `prepareAgentRoot` with a `kind:"workspace"` root (worktree lookup), the terminal `rootTarget`/`agentRoot` tRPC resolution path, and M1's group-addressed write procedures.
- Add renderer tests where feasible: `useGroupFileSearch` merge/score, the create-worktree-and-add orchestration (M3), and folder-root save (M1).
- Execute the interactive acceptance below and record the result in Outcomes & Retrospective (this was never done in wave 1).

Acceptance:

    bun run typecheck && bun run lint && bun test
    # Plus the full interactive script in "Validation and Acceptance", recorded as done.

Verify before proceeding: gates green; the interactive run is recorded with observations.


## Concrete Steps (quick reference)

From repo root `/home/user/superset-vWorkspace` unless noted:

    bun install                       # if deps changed (none expected)
    bun run typecheck                 # after each milestone
    bun run lint:fix                  # auto-fix
    bun run lint                      # MUST exit 0 before commit
    bun run lint:check-node-imports   # renderer must not import Node modules
    bun test                          # tests
    bun dev                           # launch desktop + host-service

If Q3 chooses the self-FK migration (M2), generate it (never hand-edit migrations), from `packages/host-service`:

    bunx drizzle-kit generate --name="workspace_group_default_root_fk"


## Validation and Acceptance

End-to-end proof (run in M9; the wave-1 plan's interactive acceptance plus this wave's additions):

1. `bun dev`; sign in as dev (per `DEVELOPMENT.md`).
2. Create a multi-root workspace. **Add two directories that are different git repos** via "Add folder → Set up & create worktree" (M4). Both become editable, git-aware worktree roots.
3. From the group, **create a fresh worktree (new branch) in each repo** (M3). Each appears as a root with its own Changes panel.
4. **Add one plain (non-repo) folder** too; open a file in it, **edit and save** — confirm on disk (M1). Change it from an external terminal — confirm the tree/editor **live-refresh** (M6).
5. Open files from both repos in one editor; edit and save each; confirm each lands in the correct worktree on the correct branch.
6. **Launch the combined agent**; `ls -la` the synthetic root shows every current root (M5). Ask it to read a file unique to each repo and to make an edit in each; confirm the edits land correctly. **Click a path** in its terminal output — it opens in the editor (M7).
7. Run a **cross-root content search**; matches from both repos appear, labeled (M8).
8. Quit and relaunch; the group, its roots, and the created worktrees persist (wave-1 SQLite). Delete the group; confirm the worktrees survive and the `group-roots/<id>` synthetic dir is removed (M2/Q5).

Standing gates for every milestone:

    bun run typecheck   # no type errors
    bun run lint        # exit 0
    bun test            # all pass


## Idempotence and Recovery

- M1/M6/M7 are additive addressing extensions — re-running typecheck/tests is safe; worktree-root behavior is unchanged by construction.
- M3/M4 worktree creation reuses the existing flow, which is itself idempotent per (project, branch); a failed `addRoot` leaves a real, reusable worktree (recoverable via "Add existing workspace") rather than corrupt state.
- M2 synthetic-dir cleanup and `prepareAgentRoot` reconcile are idempotent (the preparer already adds-missing/removes-stale; delete is a best-effort `rm` of a dir of symlinks).
- If Q3's migration is generated, it is forward-only; an unexpected diff means delete the just-generated migration, fix `schema.ts`, regenerate — never edit historical migrations.
- Reverting any milestone is localized: the new capability (M3–M5) is gated behind new UI actions; the gap fixes (M1, M6, M7) are addressing-union extensions that fall back to `{workspaceId}` when the group form is absent.


## Interfaces and Dependencies

No new third-party dependencies. Reuse: the host worktree-creation procedure (`workspace.create`), the project router (`project.findByPath`/`create`/`setup`), the wave-1 `workspaceGroup` router and `getServiceForRootId`, `createFsHostService` (writes already supported), `prepareAgentRoot`, the FS service `watchPath`, and the desktop New Workspace project/branch pickers + create hook.

Shapes that must exist at the end of this wave:
- Host filesystem **write** procedures and `statPath` accept `{workspaceId} | {groupId, rootId}` (M1, M7), via a shared `addressingSchema`.
- A group-addressed `fs:events` subscription keyed by `{groupId, rootId}` (M6).
- (Q2-dependent) optionally `workspaceGroup.createWorktreeRoot({ projectId, branch, name })` if host-atomic orchestration is chosen later.
- `fileDocumentStore` cache key includes the addressing discriminator (M2).

No Electron IPC channel work beyond the existing native folder picker used by M4 (already in place from wave 1).


## Artifacts and Notes

The single recurring pattern in this wave is "apply the read-side addressing union to the write/stat side." Wave 1 already did this for reads in `packages/host-service/src/trpc/router/filesystem/filesystem.ts` (`readAddressingSchema`); M1 and M7 generalize it to writes and `statPath`, and the renderer mirrors it via a `writeAddressing()` helper next to the existing `readAddressing()` in `fileDocumentStore.ts`. The other recurring pattern is "compose, don't reinvent": M3/M4 chain the existing `workspace.create` and `project.*` procedures with `workspaceGroup.addRoot`.


## Outcomes & Retrospective

To be filled in at completion. Compare against the Purpose: a user can bring two different repos into one multi-root workspace, create worktrees in each from inside the group, edit any root (repo or folder) with live refresh, run one agent across all worktrees with clickable terminal paths, search contents across roots, and rely on correct group/default/cleanup behavior — verified by an actual interactive run (M9), not just unit gates.


---

### Revision note

- 2026-06-19 23:59Z — Initial draft of wave 2. Scope set by user: add multi-repo worktree composition (create worktrees across repos from inside a group + promote repo-folders, with the already-working combined agent) AND close the wave-1 gaps (folder-root editing, live fs-events, clickable agent terminal paths, cross-root content search, and the correctness loose ends: dangling default root, synthetic-dir leak, document-cache addressing, prepareAgentRoot concurrency), plus a test/interactive-E2E backfill. Sequenced foundational fixes (M1–M2) first, the new capability (M3–M5) next, richer UX (M6–M8) after, and all verification (M9) last. Reuses the existing worktree-creation and project-import flows wholesale; keeps Strategy A, local-only/same-host, and untouched panes/workspace-fs/workspace-client/cloud schema. Open Questions Q1–Q5 carry defaults pending confirmation.
