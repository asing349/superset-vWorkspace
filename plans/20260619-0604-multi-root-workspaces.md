# Multi-root workspaces (VS Code–style) for Superset

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Reference: This plan follows conventions from `AGENTS.md` (repo root) and the ExecPlan template in `.agents/skills/create-plan/SKILL.md`.


## Purpose / Big Picture

Today a Superset "workspace" is welded to exactly one git repository on one branch. A user who works across several repos at once (for example a `frontend` repo and a `backend` repo, or a library plus the app that consumes it) must open a separate Superset workspace for each and cannot see, edit, search, or run an agent across them together.

After this change, a user can create a **multi-root workspace**: a single named view that contains several **roots** at once, exactly like Visual Studio Code's multi-root workspaces (the `.code-workspace` feature). Each root is either an existing Superset worktree (a checked-out repo+branch) or a plain local folder on the same machine. In one window the user gets:

- a file explorer that shows every root side by side (collapsible per-root sections),
- one editor (tabs/splits) that can hold files from any root simultaneously,
- a Changes/git panel with one section per git root,
- terminals that can target any root, and
- a single CLI coding agent (Claude Code, Codex, etc.) launched against a combined view that can see every root at once.

You can see it working by: building the desktop app with `bun run dev`, creating a multi-root workspace from the sidebar, adding two different repos to it, opening files from both into one editor, and launching an agent that can read files from both repos in a single session.

This is **Strategy A**: a multi-root workspace is a *container that groups existing single-root worktrees/folders*. We do not change the existing single-repo worktree primitive (the unit of agent isolation that Superset is built around); we add a grouping layer on top of it. The grouping is **local to one machine** (like a `.code-workspace` file) and requires **no cloud database changes**.


## Definitions (read this first)

These terms are used throughout. They are defined here in plain language so the plan is self-contained.

- **Worktree**: a directory on disk that is one checked-out branch of one git repository. Superset creates these under `~/.superset/worktrees/<projectId>/<branch>`. In Superset's data model, one worktree corresponds to one row in the host-local `workspaces` table.
- **Superset workspace (existing concept)**: one worktree. It has exactly one `worktreePath`, one `projectId`, one `branch`. This is the thing the current IDE opens at the route `/.../v2-workspace/$workspaceId`.
- **Multi-root workspace (new concept, this plan)**: a named, ordered list of **roots**. Internally we call it a **group**. It is stored on one machine only.
- **Root (new concept)**: one entry in a group. A root is either `kind: "workspace"` (it points at an existing Superset worktree by its `workspaceId`) or `kind: "folder"` (it points at an arbitrary absolute directory path on the same machine). Every root has a stable `rootId` (unique within the group) that the UI uses to address it.
- **host-service**: the per-machine backend in `packages/host-service`. It is a tRPC server plus a local SQLite database. It owns everything path-related on the user's disk (where repos live, where worktrees live) and serves the filesystem, git, terminals, and agents. The desktop app talks to it over a WebSocket.
- **tRPC**: a typed remote-procedure-call layer. A "router" is a group of named procedures (functions callable from the client). The host-service root router is composed in `packages/host-service/src/trpc/router/router.ts`.
- **tRPC procedure**: one callable function on a router, e.g. `workspace.get`. The client calls it like `client.workspace.get.query({ id })`.
- **Renderer process / main process**: Superset's desktop app is Electron. The **renderer** (`apps/desktop/src/renderer`) is a browser environment — no Node.js APIs. The **main** process (`apps/desktop/src/main`) can use Node.js. The renderer reaches the host-service over the network, not via Node.
- **FS service**: an object created by `createFsHostService({ rootPath })` in `packages/workspace-fs`. It serves file reads/writes/listings/searches for exactly one root directory and refuses paths outside it. The host keeps a cache of these, one per distinct root path.
- **panes**: the editor layout engine in `packages/panes`. It is generic: it stores tabs, splits, and "panes" whose contents are an opaque data blob. It knows nothing about repos or roots.
- **Electric / cloud**: the cloud control plane (`packages/db` Postgres + `packages/trpc`) that syncs project/workspace *metadata* across devices. It deliberately stores **no filesystem paths**. This plan does **not** touch it.


## Assumptions

These assumptions unblock planning. Each must be confirmed (moved to the Decision Log) or removed by the end of implementation.

- A1. All roots in a multi-root workspace live on the **same host** (machine). Cross-host multi-root is explicitly out of scope for this plan.
- A2. The group definition (its name, ordered roots, and default root) is the host's responsibility, exposed through one new tRPC router `workspaceGroup`. The UI never reads group storage directly; it only calls `workspaceGroup.*`. This lets us swap the storage backend (in-memory first, SQLite last) without touching the UI.
- A3. Pane layout (which tabs/splits are open) continues to be persisted **renderer-side**, keyed by the group id, mirroring how the existing single-workspace IDE persists layout keyed by `workspaceId`.
- A4. Until the final milestone (M7), group definitions are held in an **in-memory** store on the host and therefore reset when the host process restarts. This is acceptable during development and is the user-approved sequencing ("make all the edits first, SQL last").
- A5. For the agent (M6), a single CLI agent is launched against a **synthetic parent directory** whose children are symbolic links to each root. Symlinks are the default mechanism (see Open Question Q3).
- A6. The user-facing label is "Multi-root workspace"; the internal code noun is "group" with "roots".


## Open Questions

- Q1. Final user-facing naming. Plan assumes label "Multi-root workspace", internal `group`/`root`, route segment `v2-group`. → Decision Log D-Q1.
- Q2. How should the file explorer render N roots — N independent tree widgets stacked with collapsible headers (closest to VS Code, least change to `useFileTree`), or one synthetic top-level node with roots as its children? Plan assumes N independent trees. → Decision Log D-Q2.
- Q3. Synthetic agent root mechanism for M6: symbolic links to each root (default), nested git worktrees, or OS bind mounts. Symlinks are simplest and traversable by CLI agents but some tools resolve symlinks and may cross `.git` boundaries oddly. → Decision Log D-Q3.
- Q4. Cross-root search/quick-open semantics: fan out `searchFiles`/`searchContent` to every root's FS service and merge results with a per-result root label, or search one focused root at a time? Plan assumes fan-out-and-merge. → Decision Log D-Q4.
- Q5. Should an empty multi-root workspace (zero roots) be allowed, and what does the shell render then? Plan assumes yes (shows an "Add a folder or workspace" empty state). → Decision Log D-Q5.


## Progress

- [x] (2026-06-19) M1 — host-service `workspaceGroup` router + in-memory store + `rootId` FS resolution (no SQLite). 9 procedures on `appRouter.workspaceGroup`; `WorkspaceGroupResolver` resolves roots (+`exists`); `getServiceForRootId` added. Committed `61cb589b6` — host tests 703 pass / 0 fail (+8 new), typecheck 28/28, lint clean.
- [x] (2026-06-19) M2 — `rootId` discriminator on pane data; route filesystem/git calls by root. Optional `rootId?` on FilePaneData/TerminalPaneData/DiffPaneData; reads route via `{groupId,rootId}` when set, else `{workspaceId}` (single-workspace unchanged); git stays `workspaceId`-keyed (no change needed). Committed `7857b249f` — typecheck 28/28, lint clean.
- [x] (2026-06-19) M3 — `v2-group/$groupId` route, `WorkspaceGroupProvider`, group-scoped pane store + renderer-local layout persistence. New IDE shell (page/layout) querying `workspaceGroup.get`, one per-host `WorkspaceClientProvider`, `useGroupPaneLayout` store keyed by `groupId` persisting to new `v2WorkspaceGroupLocalState` collection; group-scoped pane registry + file navigation thread `groupId`+`rootId`; folder roots read-only; Q5 empty state. Committed `5738d6b64` — typecheck 28/28, lint clean.
- [x] (2026-06-19) M4 — multi-root Files explorer (N trees) + multi-root Changes/git sections. `useFileTree` extended to a `{workspaceId,rootPath} | {groupId,rootId,rootPath}` union; `GroupFilesTab` (N independent per-root trees, per-`kind` addressing, `exists:false` shown unavailable); `GroupChangesTab` (per `kind:"workspace"` git root via `useGitStatus`); `GroupSidebar` mounted in the group shell; clicks → `useGroupFileNavigation` with the root's `rootId`. Committed `72aca0dd4` — typecheck 28/28, lint clean, group tests 3 pass. Folder-root fs-event watching deferred (TODO, needs host change).
- [ ] M5 — sidebar switcher entry + create/add-folder/remove/reorder/set-default management UI.
- [ ] M6 — agent spanning: per-root terminals, then synthetic-parent combined agent root + `SUPERSET_ROOTS` env.
- [ ] M7 — SQL: host SQLite `workspace_groups` + `workspace_group_roots` tables; swap in-memory store for SQLite-backed store.

Use timestamps (e.g. `- [x] (2026-06-19 06:30Z) ...`) when checking items off, to measure rate of progress. Split any partially complete item into "done: X / remaining: Y".


## Surprises & Discoveries

- Observation: The editor engine `packages/panes` is already fully root-agnostic and needs **no** changes.
  Evidence: `packages/panes/src/types.ts` defines `WorkspaceState`/`Tab`/`Pane`/`LayoutNode` purely structurally; a pane's contents are an opaque `TData`. The store (`packages/panes/src/core/store/store.ts`) routes operations only by `tabId`/`paneId`/`kind`, never by any root.

- Observation: File panes already store **absolute** paths, so a single editor can already hold files from multiple roots; only the FS *routing* (which root's FS service to call) is missing.
  Evidence: `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useWorkspaceFileNavigation/useWorkspaceFileNavigation.ts` calls `toAbsoluteWorkspacePath(worktreePath, filePath)` and stores `{ kind: "file", data: { filePath: absoluteFilePath, ... } }`.

- Observation: The client transport `packages/workspace-client` is scoped per **host**, not per workspace, and its event bus already multiplexes many workspaces over one socket.
  Evidence: `packages/workspace-client/src/providers/WorkspaceClientProvider/WorkspaceClientProvider.tsx` takes `{ cacheKey, hostUrl }` and no `workspaceId`; `packages/workspace-client/src/lib/eventBus.ts` keys connections by `hostUrl` and filters each event by a per-message `workspaceId`, supporting a `"*"` wildcard.

- (M1, 2026-06-19) The host tRPC context is assembled **inline** in `packages/host-service/src/app.ts` inside the `trpcServer({ createContext })` call (cast `as Record<string, unknown>`), not in a separate context-builder module. The single `createInMemoryWorkspaceGroupStore()` + `WorkspaceGroupResolver({ db })` are constructed there and exposed on ctx; `HostServiceContext` in `src/types.ts` gained `workspaceGroupStore` + `workspaceGroupResolver`.

- (M1) `getServiceForRootPath` did **not** need to be widened — it stays `private`. `getServiceForRootId({ groupId, rootId })` is a new public method on `WorkspaceFilesystemManager` that calls the private cache method internally, so no cache duplication.

- (M1) `bun:sqlite` vs `better-sqlite3` type mismatch: `HostDb` is typed against the better-sqlite3 driver (`run: RunResult`), but host-service tests use `bun:sqlite` (`run: void`). Passing a bun-sqlite db to `new WorkspaceGroupResolver({ db })` needed `as unknown as HostDb`, matching the existing cast pattern in `config.test.ts`.

- (M1) `noNonNullAssertion` is **on** for host-service (only `packages/cli`/`cli-framework` override it off). New code uses explicit guards, not `!`.

- (M1, env) `bun run lint` prints `rg: command not found` from an unrelated `check-git-ref-strings.sh` step; the script still exits 0 and Biome reports clean. Pre-existing on this machine (ripgrep not installed); not introduced by this work. NOTE: we deliberately did NOT install ripgrep — turning on that dormant sub-check could fail on pre-existing code and break the `bun run lint` gate mid-stream.

- (M2) **`lint:check-node-imports` does NOT exist in this repo** (absent from both the root and `apps/desktop` package.json). The plan's "run `bun run lint:check-node-imports`" instruction is stale for this checkout. The renderer-no-Node-imports rule is enforced by inspection instead: edited renderer files were grepped for `node:*`/`fs`/`path`/`os`/`child_process`/`crypto` imports and `require(` — zero matches.

- (M2) **`searchFiles`/`searchContent` were NOT extended to `{groupId,rootId}` in M1** — only `listDirectory`/`readFile`/`getMetadata` got the additive union. The Files explorer (M4) uses `listDirectory` via `useFileTree`, so it is unblocked; but cross-root quick-open/search (Q4 fan-out) needs a host follow-up to make `searchFiles` group-addressable. Quick-open search lives in `useV2FileSearch` under `apps/desktop/.../screens/main/components/CommandPalette/hooks/` (outside the `v2-workspace/$workspaceId` tree). Tracked as a separate host task; cross-root search is a Q4 nicety, not in the Validation acceptance list.

- (M2) The real filesystem read/write engine is `v2-workspace/$workspaceId/state/fileDocumentStore/fileDocumentStore.ts` via `useSharedFileDocument`, consumed by `FilePane` + `FilePaneTabTitle` + `FilePaneHeaderExtras` for the same document key (addressing threaded through all three). **Writes stay `workspaceId`-only** (matching the M1 contract). Folder roots have no `workspaceId`: reads route via `{groupId,rootId}`, but writes are not yet supported — M3/M4 must gate save for folder roots accordingly.

- (M2) There is **no per-pane in-editor git gutter/blame**. Git status is consumed at the shell/sidebar/diff level via `useGitStatus({ workspaceId, … })` (`hooks/host-service/useGitStatus/`), already keyed by `workspaceId`. So M2's git-routing requirement needed no code change; M4 instantiates that query per `kind:"workspace"` root and skips folder roots.

- (M3) The single-workspace shell hooks (`usePaneRegistry`, `useWorkspaceFileNavigation`, `useV2TerminalLauncher`, `FileDocumentStoreProvider`) are hard-coupled to `useWorkspace()` (one ambient `SelectV2Workspace`). Reusing them in the group shell would require faking a workspace row or nesting a second `WorkspaceProvider` (which opens a second connection — cache keyed by `${cacheKey}:${hostUrl}` — violating "exactly one connection per host"). So M3 built thin group-scoped equivalents (`useGroupPaneRegistry`, `useGroupFileNavigation`) that REUSE the underlying pane components (`FilePane`/`FilePaneHeaderExtras`, already groupId-aware from M2) and resolve `workspaceId` per pane from `rootId` (real id for `kind:"workspace"`, `folder:<rootId>` surrogate for `kind:"folder"`). This is the file-click seam M4 builds on.

- (M3) `FileDocumentStoreProvider` (the `fs:events` → external-change watcher) is `workspaceId`-singular; the group shell omits it for M3 (no files open yet). Per-`kind:"workspace"`-root fs-event watching belongs to M4 when file content/watching lands.

- (M3) Group host URL: groups are local-only / same-host (A1), so the shell uses `useLocalHostService().activeHostUrl` and queries `workspaceGroup.get` inside that single connection.

- (M3) `apps/desktop/src/renderer/routeTree.gen.ts` is **gitignored / generated** (regenerated by `pretypecheck` → `bun run generate:routes` / `tsr generate`); it is NOT committed. The new `/v2-group/$groupId` routes register on regeneration (verified: 21 refs after `tsr generate`).

- (M4) The multi-root explorer is built on the lighter `useFileTree` hook (`rootEntries` + `toggle`/`refreshAll`) plus a small recursive row component, NOT the heavy single-workspace Pierre tree stack (which is tightly coupled to one root). Each root's tree is fully independent (Q2 default).

- (M4) `v2WorkspaceGroupLocalState` (M3) persists only `paneLayout` (no `sidebarState`), so `GroupSidebar`'s active tab is component-local `useState` (ephemeral) — avoids editing M3's collection schema.

- (M4) `ResolvedWorkspaceGroupRoot` carries no `groupId`; folder-root FS addressing gets `groupId` from `useWorkspaceGroup()`, threaded into each section as a prop.

- (M4) **Folder-root fs-event watching is deferred (`TODO(M4-followup)` in `useFileTree.ts`).** The renderer event bus filters `fs:events` by `workspaceId`, which folder roots lack; live watching for folder roots needs a host change. `kind:"workspace"` roots keep live fs-events watching; folder trees refresh on demand (toggle/refresh button).


## Decision Log

- Decision: Use Strategy A (group existing worktrees/folders) rather than Strategy B (make one workspace own N roots).
  Rationale: The single-root machinery (per-workspace FS service, worktree creation, git status, terminal) is reused unchanged; the change is additive and low-risk. `packages/panes` and the per-host `packages/workspace-client` are already multi-root capable. Strategy B would rewrite the FS host service contract, the worktree path layout, and relax cloud single-FK constraints — far higher blast radius for the same user-visible result.
  Date/Author: 2026-06-19, planning session (user-selected).

- Decision: Local-only, same-host scope. The grouping lives on one machine; no cloud (`packages/db` / `packages/trpc`) schema changes.
  Rationale: Paths are machine-local by design in Superset (`docs/design/v2-host-project-paths.md`); a `.code-workspace`-style local grouping matches that philosophy and avoids a Postgres/Electric migration.
  Date/Author: 2026-06-19, planning session (user-selected).

- Decision: The combined-agent feature (originally proposed as a follow-up "P5") is **in scope** for this plan, as milestone M6.
  Rationale: User requested it explicitly.
  Date/Author: 2026-06-19, planning session (user-selected).

- Decision: Sequence all code edits first and land the SQLite tables last (M7), behind a `WorkspaceGroupStore` interface with an in-memory implementation used until M7.
  Rationale: User-directed sequencing ("make all the edits first and sql will be the last part of the plan"). The interface seam means the UI and tRPC contract are final from M1, and only the storage backend changes at M7.
  Date/Author: 2026-06-19, planning session (user-selected).

- D-Q1 (pending): Final naming. Default: label "Multi-root workspace", code `group`/`root`, route `v2-group`.
- D-Q2 (pending): Explorer rendering. Default: N independent `useFileTree` instances with collapsible per-root headers.
- D-Q3 (pending): Synthetic agent root mechanism. Default: symbolic links.
- D-Q4 (pending): Cross-root search. Default: fan out to all roots and merge with root labels.
- D-Q5 (pending): Empty group allowed. Default: yes, with an empty-state prompt.

- Decision (M1, 2026-06-19): The `workspaceGroup` contract is finalized as of M1. Deviation from the plan draft (additive, no narrowing): `create`/`list`/all mutations return the **resolved** group (roots already carry `rootPath`/`exists`), not just `get`. This spares the renderer a follow-up `get` after each mutation. Also added a named `WorkspaceGroupRootInput = Omit<WorkspaceGroupRoot, "rootId" | "position">` alias (the plan inlined it) and implemented the resolver as a small `WorkspaceGroupResolver` class (it depends on `db`, mirroring `WorkspaceFilesystemManager`). Q1–Q5 remain at their defaults; nothing in M1 required deviating.


## Context and Orientation

This is a Bun + Turborepo monorepo. The real IDE is the Electron desktop app in `apps/desktop`; `apps/web` is a thin web/mobile surface and is **not** changed by this plan. The packages that matter here:

- `packages/host-service` — the per-machine tRPC backend + local SQLite. This is where roots are resolved to absolute paths and where files/terminals/agents are served.
- `packages/workspace-fs` — the single-root filesystem service (`createFsHostService({ rootPath })`). **Unchanged** by this plan; we simply instantiate it once per root.
- `packages/workspace-client` — the renderer's transport to a host (per-host connection + event bus). Largely unchanged; one host connection already serves many roots.
- `packages/panes` — the editor layout engine. **Unchanged**.
- `packages/db` + `packages/trpc` — the cloud control plane. **Unchanged**.

Key existing files you will read and/or edit (full repo-relative paths):

Host-service:

- `packages/host-service/src/trpc/router/router.ts` — composes the root tRPC router (`appRouter`). New `workspaceGroup` router is registered here.
- `packages/host-service/src/runtime/filesystem/filesystem.ts` — `WorkspaceFilesystemManager` with `resolveWorkspaceRoot(workspaceId)`, `getServiceForWorkspace(workspaceId)`, `getServiceForRootPath(rootPath)`, `getServiceForProject(projectId)`. This is where a new `getServiceForRootId` resolution is added.
- `packages/host-service/src/trpc/router/filesystem/filesystem.ts` — the filesystem tRPC procedures (currently keyed by `workspaceId`). A `rootId`-addressed path is added here.
- `packages/host-service/src/trpc/router/terminal/terminal.ts` and `packages/host-service/src/terminal/env.ts` — terminal session creation (takes `workspaceId` + `cwd`) and terminal environment variables (`SUPERSET_ROOT_PATH`, `SUPERSET_WORKSPACE_PATH`). Touched in M6.
- `packages/host-service/src/db/schema.ts` — host-local SQLite schema (Drizzle, `sqlite-core`). New tables added here in M7 only.
- `packages/host-service/src/db/db.ts` — opens the SQLite DB with `better-sqlite3` and runs `migrate(db, { migrationsFolder })` from `packages/host-service/drizzle/` on startup.
- `packages/host-service/drizzle.config.ts` — Drizzle Kit config (`dialect: "sqlite"`, schema `./src/db/schema.ts`, out `./drizzle`). Used in M7 to generate the migration.

Desktop renderer (TanStack Router file-based routes under `apps/desktop/src/renderer/routes`):

- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/page.tsx` — the existing single-workspace IDE shell. The new group shell mirrors this.
- `.../v2-workspace/$workspaceId/layout.tsx` and `.../providers/WorkspaceProvider/WorkspaceProvider.tsx` — resolve the workspace row and wrap children in the per-host client provider (`WorkspaceClientProvider` from `packages/workspace-client`, re-exported as `WorkspaceTrpcProvider`).
- `.../v2-workspace/$workspaceId/types.ts` — `PaneViewerData` union and `FilePaneData` (`{ filePath: string; mode; ... }`). The `rootId` discriminator is added here.
- `.../v2-workspace/$workspaceId/hooks/useV2WorkspacePaneLayout/useV2WorkspacePaneLayout.ts` — creates the per-workspace pane store and persists layout into the renderer-local DB collection `v2WorkspaceLocalState`.
- `.../v2-workspace/$workspaceId/hooks/useWorkspaceFileNavigation/useWorkspaceFileNavigation.ts` — opens files into panes; converts to absolute paths.
- `.../v2-workspace/$workspaceId/components/WorkspaceSidebar/WorkspaceSidebar.tsx` and `.../components/FilesTab/FilesTab.tsx` — the Files/Changes/Review sidebar and the file tree, currently derived from a single `rootPath = workspace.worktreePath`.
- `apps/desktop/src/renderer/hooks/host-service/useFileTree/useFileTree.ts` — the reusable single-root tree hook (`{ workspaceId, rootPath }`). Instantiated N times in M4.
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/...` and `.../hooks/useDashboardSidebarData/buildDashboardSidebarProjects.ts` — the project→workspaces switcher. A "Multi-root workspaces" section is added in M5.

How the parts fit together at runtime today (single-root): the renderer opens `/.../v2-workspace/$workspaceId`; `WorkspaceProvider` computes the host URL from the workspace's `hostId` and opens one `WorkspaceClientProvider`; the shell queries `workspace.get` to obtain the single `worktreePath`; the Files tab builds a tree from that one path; opening a file stores an absolute path into a pane store keyed by `workspaceId`; terminals are created with that worktree as `cwd`. The multi-root version keeps every one of these pieces but drives them from a list of roots instead of one.


## Plan of Work

The work is split into seven milestones (M1–M7). Milestones M1–M6 contain only code edits; M7 introduces the SQLite tables and swaps the storage backend. Each milestone is independently verifiable.

Throughout, follow `AGENTS.md` conventions: Bun only (no npm/yarn/pnpm); object-parameter signatures for functions with 2+ parameters; no `any`/`@ts-ignore`/empty catch; co-locate components as `Name/Name.tsx` + `index.ts`; run `bun run lint:fix` and ensure `bun run lint` exits 0 before any commit (CI fails on Biome warnings). For desktop work, never import Node.js modules in the renderer; run `bun run lint:check-node-imports` to catch violations.


### Milestone M1: host-service `workspaceGroup` router + in-memory store + root resolution

Scope: introduce the group concept on the host with a clean tRPC contract, backed by an in-memory store, and make the filesystem layer addressable by `rootId` so that folder roots (which have no `workspaceId`) can be served.

What will exist that did not before: a callable `workspaceGroup` tRPC router and the ability to list/read files for an arbitrary group root.

New files:

- `packages/host-service/src/runtime/workspace-groups/types.ts` — the shared types:

      export type WorkspaceGroupRootKind = "workspace" | "folder";

      export interface WorkspaceGroupRoot {
        rootId: string;            // unique within the group
        kind: WorkspaceGroupRootKind;
        workspaceId: string | null; // set when kind === "workspace"
        folderPath: string | null;  // set when kind === "folder"
        label: string;             // display name (defaults to repo/folder basename)
        position: number;          // ordering within the group
      }

      export interface WorkspaceGroup {
        id: string;
        name: string;
        defaultRootId: string | null;
        roots: WorkspaceGroupRoot[];
        createdAt: number;
      }

      export interface ResolvedWorkspaceGroupRoot extends WorkspaceGroupRoot {
        rootPath: string;          // absolute path resolved on this host
        exists: boolean;           // whether rootPath currently exists on disk
      }

- `packages/host-service/src/runtime/workspace-groups/store.ts` — the storage interface and in-memory implementation:

      export interface WorkspaceGroupStore {
        create(input: { name: string; roots: Omit<WorkspaceGroupRoot, "rootId" | "position">[] }): WorkspaceGroup;
        get(id: string): WorkspaceGroup | null;
        list(): WorkspaceGroup[];
        rename(input: { id: string; name: string }): WorkspaceGroup;
        addRoot(input: { id: string; root: Omit<WorkspaceGroupRoot, "rootId" | "position"> }): WorkspaceGroup;
        removeRoot(input: { id: string; rootId: string }): WorkspaceGroup;
        reorderRoots(input: { id: string; orderedRootIds: string[] }): WorkspaceGroup;
        setDefaultRoot(input: { id: string; rootId: string | null }): WorkspaceGroup;
        delete(id: string): void;
      }

      export function createInMemoryWorkspaceGroupStore(): WorkspaceGroupStore { /* Map<id, WorkspaceGroup> */ }

  The in-memory store assigns `rootId` via `crypto.randomUUID()` and maintains `position` as the array index.

- `packages/host-service/src/runtime/workspace-groups/resolve.ts` — resolves a group's roots to absolute paths using existing host data: for `kind: "workspace"`, look up the host-local `workspaces` row to get `worktreePath` (the same lookup `resolveWorkspaceRoot` already performs); for `kind: "folder"`, use `folderPath` directly. Compute `exists` with `node:fs` `existsSync`.

- `packages/host-service/src/trpc/router/workspace-group/workspace-group.ts` and `.../workspace-group/index.ts` — the `workspaceGroupRouter` exposing procedures: `create`, `get` (returns the group with `ResolvedWorkspaceGroupRoot[]`), `list`, `rename`, `addRoot`, `removeRoot`, `reorderRoots`, `setDefaultRoot`, `delete`. Validate inputs with `zod` (the repo's standard validation). The router reads the store and the resolver from the request context (`ctx`).

Edits:

- `packages/host-service/src/trpc/router/router.ts` — import `workspaceGroupRouter` and add `workspaceGroup: workspaceGroupRouter` to the `appRouter({ ... })` object (alongside `workspace`, `workspaces`, etc.).
- Wherever the host builds its tRPC context / runtime (the same place `WorkspaceFilesystemManager` is constructed — see `packages/host-service/src/app.ts`), construct a single `createInMemoryWorkspaceGroupStore()` and expose it on the context so the router can reach it.
- `packages/host-service/src/runtime/filesystem/filesystem.ts` — add `getServiceForRootId(input: { groupId: string; rootId: string })` that resolves the root to an absolute path via the group resolver, then delegates to the existing `getServiceForRootPath(rootPath)`. This reuses the existing per-root FS cache; no change to `packages/workspace-fs`.
- `packages/host-service/src/trpc/router/filesystem/filesystem.ts` — for each read-only listing/read procedure currently accepting `{ workspaceId, ... }`, accept an alternative addressing of `{ groupId, rootId, ... }` and route via `getServiceForRootId`. Keep the existing `workspaceId` form working unchanged (additive). Write/move/delete procedures may be added in the same shape but are only required once the explorer needs them (M4).

Acceptance:

    cd /home/user/superset-vWorkspace
    bun run typecheck
    # Expected: no type errors

    bun test packages/host-service
    # Expected: existing tests pass; add a unit test for createInMemoryWorkspaceGroupStore
    # (create -> addRoot -> reorderRoots -> get returns resolved roots in order)

Verify before proceeding: the new router compiles and is reachable in the host `AppRouter` type; the in-memory store unit test passes.


### Milestone M2: `rootId` discriminator on pane data; route FS/git calls by root

Scope: make each file-bearing pane remember which root it belongs to, so the editor can read/save files from any root.

What will exist that did not before: opening a file records `{ rootId, filePath }`, and FS reads/writes for that pane are routed to the correct root's FS service.

Edits:

- `apps/desktop/.../v2-workspace/$workspaceId/types.ts` — add an optional `rootId?: string` to `FilePaneData` (and to the other path-bearing pane data: diff and terminal panes). It is optional so the existing single-workspace shell keeps working with `rootId` unset (interpreted as "the route's workspace"). In the new group shell it is always set.
- `apps/desktop/.../$workspaceId/hooks/useWorkspaceFileNavigation/useWorkspaceFileNavigation.ts` — accept a `rootId` when opening a file and store it on the pane data. De-duplication/focus continues to match on absolute `filePath` (already globally unambiguous) but now also carries `rootId` for FS routing.
- The file-pane component and quick-open that issue `filesystem.*` calls — when `rootId` is present, call the `{ groupId, rootId }` form added in M1; otherwise keep the `{ workspaceId }` form. Thread `groupId` from the group provider added in M3.
- Git reads for a pane (blame/status used by the editor gutter, if any) route by the root's `workspaceId` when the root is `kind: "workspace"`; folder roots that are not git repos simply skip git decorations.

Acceptance:

    cd /home/user/superset-vWorkspace
    bun run typecheck
    bun run lint:check-node-imports   # renderer must not import Node modules
    # Expected: no errors

Verify before proceeding: types compile; existing single-workspace IDE still opens and edits files (no behavior change when `rootId` is unset).


### Milestone M3: `v2-group/$groupId` route, provider, group-scoped pane store

Scope: a real window for a multi-root workspace. It opens one host connection and a pane store keyed by `groupId`.

What will exist that did not before: navigating to `/.../v2-group/<id>` renders an IDE shell whose pane layout is independent from any single workspace and persists per group.

New files (mirroring the `v2-workspace/$workspaceId` tree):

- `apps/desktop/.../_dashboard/v2-group/$groupId/page.tsx` — the group IDE shell. It queries `workspaceGroup.get` for the resolved roots, picks the host URL from the roots' host (all same host per A1), and renders the panes `Workspace` keyed by `groupId`.
- `.../v2-group/$groupId/layout.tsx` and `.../v2-group/$groupId/providers/WorkspaceGroupProvider/WorkspaceGroupProvider.tsx` — open exactly one `WorkspaceClientProvider` (per-host) and expose the group id, the resolved roots, and the default root via React context (a `useWorkspaceGroup()` hook).
- `.../v2-group/$groupId/hooks/useGroupPaneLayout/useGroupPaneLayout.ts` — `createWorkspaceStore<PaneViewerData>()` memoized on `[groupId]`, with `key={groupId}` on the rendered `Workspace`. Persist the layout into a renderer-local collection keyed by `groupId` (add a `v2WorkspaceGroupLocalState` collection mirroring the existing `v2WorkspaceLocalState`).

Acceptance:

    cd /home/user/superset-vWorkspace
    bun dev
    # In the desktop app, manually navigate to a group route for a group created via the
    # workspaceGroup.create procedure (temporary dev affordance or devtools call).
    # Expected: the group shell mounts; an empty pane area renders; no console errors.

    bun run typecheck && bun run lint
    # Expected: no errors

Verify before proceeding: the group route mounts with a working (empty) pane area and a single host connection; switching between a group route and a single-workspace route does not leak pane state (distinct stores).


### Milestone M4: multi-root Files explorer + multi-root Changes/git

Scope: the visible payoff — several roots in one explorer, and one Changes section per git root.

What will exist that did not before: the sidebar Files tab shows every root with a collapsible header; clicking a file in any root opens it (with the correct `rootId`); the Changes tab shows per-root git status.

Edits / new files:

- New `apps/desktop/.../v2-group/$groupId/components/GroupFilesTab/GroupFilesTab.tsx` — renders one collapsible section per resolved root. Each section instantiates the existing `useFileTree({ workspaceId, rootPath })` hook (for `kind: "workspace"` roots) or a folder-addressed variant (`{ groupId, rootId, rootPath }`) for `kind: "folder"` roots. Per Q2 default, these are N independent trees; each keeps its own internal `reveal()` guard so cross-root paths never leak between trees. File clicks call `useWorkspaceFileNavigation` with that section's `rootId`.
- `apps/desktop/src/renderer/hooks/host-service/useFileTree/useFileTree.ts` — extend to accept either `{ workspaceId, rootPath }` (existing) or `{ groupId, rootId, rootPath }` (new) and call the matching `filesystem.*` addressing form from M1/M2. Keep the single-root behavior unchanged.
- New `.../v2-group/$groupId/components/GroupChangesTab/GroupChangesTab.tsx` — one collapsible git section per root that is a git repository (skip non-git folder roots). Each section reuses the existing single-worktree git status query for that root's `workspaceId`.
- Wire `GroupFilesTab`/`GroupChangesTab` into a `GroupSidebar` used by the M3 shell.

Acceptance:

    cd /home/user/superset-vWorkspace
    bun dev
    # Create a group with two roots (two different repos). Open the group route.
    # Expected: the Files tab shows two collapsible roots; expanding each lists its files;
    # clicking a file in each root opens it into the SAME editor area in separate tabs;
    # the Changes tab shows two git sections reflecting each repo's status.

    bun run typecheck && bun run lint && bun test
    # Expected: no errors; tests pass

Verify before proceeding: files from two different repos are open simultaneously in one editor and each saves back to the correct repo (edit a file in each root, save, confirm on disk via a terminal `git status` in each worktree).


### Milestone M5: switcher entry + management UI

Scope: let the user create and manage multi-root workspaces from the sidebar without devtools.

What will exist that did not before: a "Multi-root workspaces" section in the dashboard sidebar, with actions to create a group, add an existing workspace or a folder to it, remove/reorder roots, set the default root, rename, and delete.

Edits / new files:

- `apps/desktop/.../components/DashboardSidebar/...` — add a "Multi-root workspaces" section listing groups from `workspaceGroup.list`, each navigating to its `v2-group/$groupId` route. Add a `+` action "New multi-root workspace".
- New management components under `.../v2-group/$groupId/components/` (or a dedicated modal under `DashboardSidebar`): a create dialog (name + initial roots), an "Add root" affordance offering two sources — "Add existing workspace" (pick from the user's worktrees) and "Add folder" (native folder picker; the picker is invoked in the renderer the same way existing folder-first import does, then the chosen absolute path is sent to `workspaceGroup.addRoot`), plus remove/reorder/set-default/rename/delete wired to the corresponding `workspaceGroup.*` procedures.

Acceptance:

    cd /home/user/superset-vWorkspace
    bun dev
    # In the sidebar: New multi-root workspace -> name it -> add two repos and one plain folder ->
    # open it -> reorder roots -> set a default root -> rename -> remove a root.
    # Expected: every action reflects immediately; reopening the group shows the persisted set
    # (within the same host process session; cross-restart persistence arrives in M7).

    bun run typecheck && bun run lint
    # Expected: no errors

Verify before proceeding: a non-developer can create and edit a multi-root workspace entirely from the UI.


### Milestone M6: agent spanning (combined agent root)

Scope: terminals and a single CLI agent that can operate across all roots.

What will exist that did not before: the user can open a terminal targeting any specific root, and can launch one agent that sees every root at once.

Two parts:

Part A — per-root terminals. The existing terminal procedures (`packages/host-service/src/trpc/router/terminal/terminal.ts`) already accept a `workspaceId` and a `cwd`. In the group shell, a "new terminal" action asks which root to target (defaulting to the group's `defaultRootId`) and creates the session with that root's `workspaceId`/path. This needs no host change beyond passing the selected root.

Part B — combined agent root (the headline feature). Add a host procedure `workspaceGroup.prepareAgentRoot({ groupId })` that:

1. Resolves the group's roots to absolute paths.
2. Creates (idempotently) a synthetic parent directory, e.g. `~/.superset/group-roots/<groupId>/`.
3. Inside it, creates one child per root (named by the root's `label`, de-duplicated) as a **symbolic link** to that root's absolute path (Q3 default). Re-running reconciles links to match the current roots (add missing, remove stale).
4. Returns `{ agentRootPath }`.

Then the agent/terminal for the whole group is launched with `cwd = agentRootPath`, so a CLI agent started there sees each root as a subdirectory. Extend the terminal environment builder (`packages/host-service/src/terminal/env.ts`) to also export, for group-launched sessions, a newline- or `:`-separated `SUPERSET_ROOTS` listing every root path, while keeping `SUPERSET_ROOT_PATH` pointed at `agentRootPath` for backward compatibility.

Acceptance:

    cd /home/user/superset-vWorkspace
    bun dev
    # Open a group with two repos. Launch the combined agent.
    # In its terminal, run:  ls -la
    # Expected: one symlinked entry per root, each pointing at the right worktree/folder.
    # Ask the agent to read a file that only exists in repo A and another only in repo B;
    # it can read both in one session.
    # Also open a per-root terminal and confirm `pwd` is that root's worktree.

    bun run typecheck && bun run lint && bun test
    # Expected: no errors; tests pass

Verify before proceeding: a single agent session reads and edits files in two different repos; symlinks are reconciled when a root is added/removed and the agent root is re-prepared.

Note on symlinks (Q3): if a CLI agent or tool misbehaves crossing symlinked `.git` boundaries, record it in Surprises & Discoveries and revisit Q3 (candidate alternatives: nested git worktrees or OS bind mounts). Do not silently switch mechanisms without a Decision Log entry.


### Milestone M7: SQL — durable host storage (LAST)

Scope: make multi-root workspaces survive host restarts by persisting them in the host-local SQLite database, and swap the in-memory store for a SQLite-backed one. This is intentionally last; nothing in M1–M6 depends on it because the store is behind the `WorkspaceGroupStore` interface.

Important repo rule (`AGENTS.md`): never hand-edit files under a Drizzle migrations folder or snapshots. Change only the schema source, then generate the migration with Drizzle Kit. The host-service migrations live in `packages/host-service/drizzle/` and are generated from `packages/host-service/src/db/schema.ts` via `packages/host-service/drizzle.config.ts` (`dialect: "sqlite"`). They are applied automatically on host startup by `migrate(...)` in `packages/host-service/src/db/db.ts`.

Edits:

- `packages/host-service/src/db/schema.ts` — add two tables mirroring the M1 types:

      export const workspaceGroups = sqliteTable("workspace_groups", {
        id: text().primaryKey(),
        name: text().notNull(),
        defaultRootId: text("default_root_id"),
        createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
      });

      export const workspaceGroupRoots = sqliteTable("workspace_group_roots", {
        id: text().primaryKey(),            // this is the rootId
        groupId: text("group_id").notNull().references(() => workspaceGroups.id, { onDelete: "cascade" }),
        kind: text().notNull(),             // "workspace" | "folder"
        workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
        folderPath: text("folder_path"),
        label: text().notNull(),
        position: integer().notNull(),
      }, (t) => [index("workspace_group_roots_group_id_idx").on(t.groupId)]);

  (When a `kind: "workspace"` root's underlying worktree row is deleted, the cascade removes that root from the group; a `kind: "folder"` root has a null `workspaceId` and is unaffected.)

- New `packages/host-service/src/runtime/workspace-groups/sqlite-store.ts` — `createSqliteWorkspaceGroupStore(db)` implementing the same `WorkspaceGroupStore` interface against the two tables.
- The host runtime construction (M1's `createInMemoryWorkspaceGroupStore()` call site) — swap to `createSqliteWorkspaceGroupStore(db)`. This is the only behavioral change; the router and UI are untouched.

Generate the migration:

    cd /home/user/superset-vWorkspace/packages/host-service
    bunx drizzle-kit generate --name="workspace_groups"
    # Expected: a new SQL file + snapshot under packages/host-service/drizzle/.
    # Do NOT edit those generated files by hand.

Acceptance:

    cd /home/user/superset-vWorkspace
    bun dev
    # Create a multi-root workspace with two roots. Fully quit and relaunch the desktop app
    # (so the host process restarts).
    # Expected: the multi-root workspace and its roots are still present after restart.

    bun run typecheck && bun run lint && bun test
    # Expected: no errors; tests pass

Verify before proceeding: groups persist across a host restart; the in-memory implementation can be deleted or retained only for tests.


## Concrete Steps (quick reference)

From the repo root `/home/user/superset-vWorkspace` unless noted:

    bun install                 # once, if dependencies changed
    bun run typecheck           # after each milestone
    bun run lint:fix            # auto-fix formatting/lint
    bun run lint                # MUST exit 0 before commit (CI treats warnings as errors)
    bun run lint:check-node-imports   # renderer must not import Node modules (desktop)
    bun test                    # run tests
    bun dev                     # launch dev (desktop + host-service + web)

Migration generation (M7 only), from `packages/host-service`:

    bunx drizzle-kit generate --name="workspace_groups"


## Validation and Acceptance

The end-to-end acceptance that proves the feature works:

1. `bun dev`, sign in (dev account per `DEVELOPMENT.md`: "Sign in as dev").
2. From the sidebar, create a multi-root workspace and add two different repositories plus one plain folder.
3. Open the multi-root workspace. The Files explorer shows three collapsible roots.
4. Open a file from each repo into the same editor; edit and save each; confirm via a terminal that each file changed in its own repo.
5. The Changes tab shows an independent git section per repo.
6. Launch the combined agent; in its terminal `ls -la` shows one symlink per root; ask it to read a file unique to each repo in a single session.
7. Quit and relaunch the app; the multi-root workspace and its roots persist (after M7).

Per-milestone acceptance commands are listed in each milestone above. The standing quality gates for every milestone are:

    bun run typecheck   # no type errors
    bun run lint        # no lint output (exit 0)
    bun test            # all tests pass


## Idempotence and Recovery

- M1–M6 are additive code edits and can be re-applied safely; re-running `bun run typecheck`/`bun test` is non-destructive.
- The combined agent root (M6) is reconciled idempotently: `prepareAgentRoot` re-creates missing symlinks and removes stale ones; running it repeatedly converges to the current root set. If a symlink target is gone (a worktree was deleted), `prepareAgentRoot` omits it and the resolver marks that root `exists: false` so the UI can show it as unavailable rather than crashing.
- M7's migration is generated by Drizzle Kit and applied on startup; it is forward-only. If generation produces an unexpected diff, delete the just-generated migration file (only the newly generated one), correct `schema.ts`, and regenerate. Never edit historical migrations or snapshots by hand.
- Because group storage is behind the `WorkspaceGroupStore` interface, reverting M7 (falling back to the in-memory store) is a one-line change at the construction site and does not affect the router or UI.


## Interfaces and Dependencies

No new third-party dependencies are required. The plan reuses: `better-sqlite3` + `drizzle-orm` (already used by host-service), `zod` (validation), `@superset/workspace-fs` (`createFsHostService`, unchanged), `@superset/workspace-client` (per-host transport, unchanged), `@superset/panes` (`createWorkspaceStore`, unchanged), and TanStack Router (renderer routing, existing).

Types that must exist at the end of M1 (host): `WorkspaceGroup`, `WorkspaceGroupRoot`, `ResolvedWorkspaceGroupRoot`, `WorkspaceGroupStore`, `createInMemoryWorkspaceGroupStore`, and a `workspaceGroupRouter` registered on `appRouter` so the host `AppRouter` type exposes `workspaceGroup.*`.

Types that must exist at the end of M2 (desktop): `FilePaneData` (and sibling path-bearing pane data) carrying an optional `rootId: string`.

There is no Electron IPC channel work in this plan: the renderer reaches the host-service over tRPC-over-WebSocket via `packages/workspace-client`, not via Electron IPC. (`apps/desktop/src/shared/ipc-channels.ts` is therefore not touched.)


## Artifacts and Notes

Router registration (M1) — the single edit in `packages/host-service/src/trpc/router/router.ts`:

    import { workspaceGroupRouter } from "./workspace-group";
    // ...
    export const appRouter = router({
      // ...existing routers...
      workspace: workspaceRouter,
      workspaces: workspacesRouter,
      workspaceGroup: workspaceGroupRouter,   // <-- added
      // ...
    });

Single-root assumption being generalized (M2/M4) — today the file tree derives one root:

    // FilesTab.tsx (existing)
    const workspaceQuery = workspaceTrpc.workspace.get.useQuery({ id: workspaceId });
    const rootPath = workspaceQuery.data?.worktreePath ?? "";

The group explorer instead maps over `workspaceGroup.get(...).roots`, instantiating the tree per root.


## Outcomes & Retrospective

To be filled in at completion. Compare the delivered behavior against the Purpose: a user can create a local, same-host multi-root workspace, see/edit/search several repos and folders in one window, run per-root terminals, and run a single agent across all roots, with the grouping persisted across restarts after M7.


---

### Revision note

- 2026-06-19 06:04Z — Initial draft. Encodes the four planning decisions already made (Strategy A; local-only same-host; combined agent in scope as M6; SQL sequenced last as M7 behind a `WorkspaceGroupStore` interface). Sequencing places all code edits in M1–M6 and the host SQLite schema/migration in M7, per user direction ("make all the edits first, sql will be the last part of the plan"). Open Questions Q1–Q5 carry sensible defaults and are linked to pending Decision Log entries.
