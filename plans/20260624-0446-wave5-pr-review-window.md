# Wave 5 — PR review window (Diff + on-demand, memory-grounded Guide via local AI sessions)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Reference: This plan follows conventions from `AGENTS.md` (repo root) and the ExecPlan template in `.agents/skills/create-plan/SKILL.md`. It is the **fifth wave** on branch `claude/keen-euler-e9b3x8`, on top of waves 1–4 (`plans/20260619-0604-…`, `plans/20260619-2359-…`, `plans/20260623-0306-…`, `plans/20260623-1430-…`), all already implemented on this branch. Read those for the multi-root + memory + ticket→PR foundation; this plan does not repeat them.


## Purpose / Big Picture

When GitHub is connected, a developer should be able to **review pull requests inside Superset** — every PR in the repo, not just the one checked out. This wave adds a **PR review window**: a pane with two tabs —

- **Diff** — the PR's code changes (multi-file diff), and
- **Guide** — a human-readable "context of the changes" (like Linear's review guide): what changed, why, risk areas, what to read first, how to review — **every claim anchored to specific code** (click a guide line → the Diff tab scrolls to that file/hunk, or the file opens in the editor at that line).

The Guide is the differentiator. It is produced **on demand by an explicit "Generate guide" button — it never generates on its own** (not on PR open, not on view, not on new commits). When the user clicks Generate, the guide is built from (1) a **deterministic + memory-grounded** skeleton (the PR diff shaped by wave-3 memory: this PR touches the auth area → here's the project convention + a prior playbook + where things live), and (2) — **when a local AI session is available (e.g. Claude Code / the on-device agent is connected)** — an **AI enrichment** of that skeleton through that **local** session. No new Superset cloud model call is introduced: the enrichment rides the user's own connected/on-device agent; if none is connected, the deterministic + memory-grounded guide is the result.

You can see it working by: connecting GitHub, opening the **Pull Requests** list (all repo PRs), opening a PR into the review window (Diff renders), clicking **Generate guide** (a memory-grounded guide appears, enriched by the local agent if connected), and clicking a guide reference to jump the Diff tab to that hunk.

**Discipline carried forward:** reuse the existing diff renderer, the pane/tab shell (the wave-3 Memory pane is the precedent for an in-pane segmented control), and wave-3 memory (`retrieve`/`getPractice`/`listPlaybooks`/`listIndexEntries`). Storage is **host-side/local** (no cloud schema change). The core is **read-only** — posting review comments back to GitHub is an explicitly-deferred later add.


## Definitions (read this first; self-contained)

- **PR review window**: a workspace pane, `kind:"pr-review"`, with an in-pane **segmented control** (`section: "diff" | "guide"`) — exactly the pattern the wave-3 Memory pane uses (`MemoryPaneData.section`). One pane, two tabs.
- **The two PR data planes (exist)**: cloud `githubPullRequests` (org-wide; has `baseBranch`, but `additions/deletions/changedFiles` stored as 0; no body; no files/diff) and host `pullRequests` (per-machine; no body/base/files/diff). **Neither stores or fetches the diff** — every existing diff path compares against the *local worktree HEAD*. So an arbitrary-PR diff is a net-new fetch.
- **Arbitrary-PR diff**: the `base..head` diff of a PR that may not be checked out locally. Fetched via GitHub `pulls/{n}/files` (the host PR runtime already has gh CLI + an Octokit factory) — its unified-diff patches parse straight into the existing diff renderer — or, when the PR's branch is local, via `git fetch` + `git diff base...head` using the existing helpers.
- **Diff renderer (reuse)**: `DiffPane` + `@pierre/diffs` `CodeView` + `parseDiffFromFile` + `useDiffCodeViewItems` — already render multi-file diffs with per-file scroll/collapse and inline threads.
- **Guide**: a computed, structured artifact (not free prose) with sections {at-a-glance, what changed, read-first/review-order, risk flags, project conventions, prior playbooks, where-X-lives, checks & threads}. Each claim carries a **code anchor** (see below). Built deterministically from the diff + wave-3 memory; optionally enriched by a local AI session.
- **Code anchor**: `{ file, optional line/hunk range, optional symbol }` attached to a guide claim. Clicking it **scrolls the sibling Diff tab** to that file/hunk and/or **opens the editor at `file:line`** (reusing wave-3 A3's `focusLine`/`revealPosition`).
- **Local AI session**: the on-device agent surface — the host `superset` chat agent (`ctx.runtime.chat`, mastracode, runs on the user's machine through their configured provider) **or** a connected CLI agent (Claude Code) launched via `runAgentInWorkspace`. "Local" = runs through the user's own connected agent; the feature adds **no new Superset cloud model call**.
- **Memory grounding (wave 3)**: `memory.retrieve` (project + global Coding Practice + area-filtered Playbooks + Project-Index slices), `pathsToAreas` (touched paths → area tags). Project-scoped, so grounding works even for PRs not checked out — degrades gracefully (diff-only) when the PR's repo isn't a locally-indexed project.
- **host-service / renderer / main**: as in waves 1–4. Renderer = browser (no Node); host owns paths/git/PRs/memory/agents.


## Assumptions

- A1. **Scope = all PRs of the repo** (user decision). This requires a PR-browse list and an arbitrary-PR diff fetch (not just the current branch's PR).
- A2. **The Guide is generated only by an explicit "Generate guide" button — never automatically** (user decision). No generation on PR open, on tab view, or on new commits. New commits mark the cached guide **stale** and offer "Regenerate" (a button), but do not run anything on their own.
- A3. **Guide generation uses a local AI session when available** (Claude Code / the on-device agent), grounded in the diff + wave-3 memory; with a **deterministic + memory-grounded skeleton** as the always-available baseline (and the sole result when no local agent is connected). **No new Superset cloud model call.**
- A4. **Read-only core.** Showing diff + guide only. Posting review comments back to GitHub (GitHub MCP `pull_request_review_write` / `gh pr review`) is an explicitly-deferred later add (adds egress + write scope).
- A5. **Local-only storage; no cloud schema change.** Guides + fetched diffs cache in host SQLite (new tables, drizzle-generated), keyed by `(projectId, prNumber, headSha)`. Carry wave-3/4's "no `packages/db`/`packages/trpc` change" discipline.
- A6. **Reuse, don't reinvent:** the `DiffPane` renderer + `@pierre/diffs`, the panes store + registry (Memory-pane segmented-control precedent), wave-3 memory (`retrieve`/`getPractice`/`listPlaybooks`/`listIndexEntries`/`pathsToAreas`) and the deterministic distill primitives (`gatherChangedFiles`/`distillDiffShape`), the local chat-agent surface (`runAgentInWorkspace`/`ctx.runtime.chat`), and the wave-3 A3 `focusLine` anchoring. No change to `packages/panes`/`workspace-fs`.
- A7. **GitHub egress is limited to fetching PR data/diffs** (via the existing gh CLI / Octokit in the PR runtime). The guide's AI step uses the user's own local/connected agent.


## Open Questions

None blocking — decisions are in the Decision Log per the user's direction. Deferred-by-choice (commenting back to GitHub; auto-preview of the deterministic skeleton) are noted as future, not open questions.


## Progress

- [x] M1 (2026-06-24) — DONE. Host `prReview` router + reusable `fetchPrDiff`: GitHub `pulls.get` + paginated `pulls.listFiles` (raw unified patches) with a local `git fetch refs/pull/<n>/head` + `git diff base...head` fallback for PRs not checked out. Returns the fixed `{ files: PrDiffFile[], body, baseBranch, headSha, prNumber }` (RAW patches; renderer parses via parseDiffFromFile). Graceful-empty on unresolvable. 4 tests; typecheck + biome clean. (Cache = M6.) Commit `afa4a514c`.
- [x] M2 (2026-06-24) — DONE. `PrReviewPaneData {prNumber, section:"diff"|"guide"}` + a `kind:"pr-review"` registry entry + `openPrReviewPane` (single-instance per PR) mirroring the Memory pane; Diff|Guide segmented control; Diff tab renders @pierre/diffs CodeView via `buildPrDiffItems`; Guide tab empty-state with the single "Generate guide" button + a stale "Regenerate" seam; a "Pull Requests" submenu lists all repo PRs. desktop typecheck + biome clean; 17 tests. Commit `2f96acfbe`.
- [x] M3 (2026-06-24) — DONE. `buildGuideSkeleton` (model-free) builds a code-anchored `PrReviewGuide` from the diff (as input) + wave-3 memory via narrow injected ports; sections at-a-glance/what-changed/read-first/risk-flags/conventions/playbooks/where-x-lives/checks; grounds when the project is indexed, degrades to diff-only (`grounded:false`) otherwise. Exports the guide artifact contract (window derives via inferRouterOutputs). 7 tests; typecheck + biome clean. Commit `f9ff9474f`.
- [x] M4 (2026-06-24) — DONE. `prReview.generateGuide` (MUTATION = the only trigger; structural never-auto-generate) → fetchPrDiff (M1) → normalizeFileStatus → buildGuideSkeleton (M3) → best-effort enrich via an injected local-AI session (anchor-preservation is STRUCTURAL — model returns notes keyed to anchored item ids, anchors re-attached unchanged; every model string redacted via redactText) → persist via guide-cache.putGuide (M6). `getCachedGuide` (query) reads {guide,stale}, generates nothing. NO new cloud model call. 35 tests; typecheck + biome clean. Commit `856a0c1c3`. **Live local-AI bridge CLOSED** (commit `7f93106c2`): `complete` now drives a real, hard-timeout-bounded (≤45s, double-layered) one-shot through `ctx.runtime.chat` — declines (never auto-approves) any approval/question, always tears down the session, degrades to the deterministic guide on no-provider / no-workspace / failure. 8 safety tests. So the guide is genuinely AI-enriched when a local model provider + workspace exist, deterministic + grounded otherwise.
- [x] M5 (2026-06-24) — DONE. Guide procedures wired: `getCachedGuide` (read-only query, cache-first on open — generates nothing) + `generateGuide` (mutation, button-only). Anchor click-through: a code-anchored Guide claim switches to the Diff tab + scrolls the sibling CodeView to the file/hunk (A3 focusTick; centered line or file-top; rename via previousFilename; binary/not-in-PR no-op), in-pane (no editor focus-steal). "stale — Regenerate" driven by M6's flag. Renderer guide types now derived from `inferRouterOutputs<AppRouter>["prReview"]` (single source of truth). Integrated desktop+host typecheck + biome clean; 21 pane tests. Commit `5fcaa209c`.
- [x] M6 (2026-06-24) — DONE. `pr_review_guides` + `pr_review_diffs` tables (migration `0011_pr_review_guides.sql`), `guide-cache.ts` (putGuide / getCurrentGuide / markGuideStaleOnHeadChange / putDiff / getDiff). Head-SHA staleness via a new `onPullRequestHeadChanged` hook at `upsertPullRequestRow` (fires only on a SHA-advance update; app.ts wires it to flip `stale=true` and run NOTHING else — never regenerates). Also fixed an M1 snapshot-guard regression (live-remote repo identity). host-service 906/0; typecheck + biome clean. Commit `d5a7bc496`.
- [ ] M7 (deferred) — post review comments back to GitHub (GitHub MCP / `gh`). Out of MVP.

Timestamp each item when checked off; split partials into done/remaining.


## Surprises & Discoveries

- Observation: the diff renderer and the "two-tab window" already exist; the genuinely new pieces are the arbitrary-PR diff fetch and the guide generator.
  Evidence: `DiffPane` + `@pierre/diffs` render multi-file diffs; the wave-3 Memory pane (`kind:"memory"`, `section` segmented control) is the precedent for a `kind:"pr-review"` pane; Octokit `pulls/{n}/files` returns unified-diff patches that `parseDiffFromFile` consumes directly.

(Add observations as work proceeds.)

- Gating reality carried from wave 4 (re-confirmed): biome is PINNED `@2.4.2`; there is NO `bun run lint:check-node-imports` script (node-import safety via desktop tsc + biome `noRestrictedImports`); whole-tree `bun test`/`turbo test` CRASHES Bun (pty-daemon real-spawn) so PER-PACKAGE `bun test` is the gate; the `rg`-based lint sub-check is env-blocked locally (no ripgrep binary) but runs in CI.
- Clean area-split for the host `pr-review` work (no file collision): guide owns `packages/host-service/src/runtime/pr-review/` (the guide builder + the shared artifact types); diff owns `packages/host-service/src/trpc/router/pr-review/` (the `prReview` router + `fetchPrDiff`). M6's storage stays in `runtime/`+`db/`; M4's guide procedures go in the `trpc/router/pr-review/` router.
- Contract note for M4: M1's `PrDiffFile.status` is `string` (raw GitHub/git status vocabulary); M3's `PrDiffInput.status` is the git `FileStatus` union. M4 must reconcile (normalize the raw status when feeding M1's result into `buildGuideSkeleton`) — GitHub uses `removed` where git uses `deleted`, etc.
- M2 discovery: GitHub's `pulls/{n}/files` `patch` is HUNKS-ONLY (no `diff --git`/`---`/`+++` header) — fed bare to `@pierre/diffs` `processFile` it parses ZERO hunks (renders blank). `buildPrDiffItems` synthesizes the minimal header (with `/dev/null` on add/delete sides) and calls `processFile(synth, { isGitDiff: true })`. Regression-tested. (Used `processFile`, not `parseDiffFromFile` — the latter takes two file-*contents*; a PR gives patch text.)
- M2 decisions: (a) reused only DiffPane's render primitives (`CodeView` + theme), not the whole component (it's hardwired to the route's `workspaceId`); (b) dropped the planned `DiffRef`/`getDiff` `pr` case — it broke the existing exhaustive `Record<source,…>` switches and the PR diff doesn't flow through the local-worktree path; documented in a comment. (c) renderer mirrors guide's `PrReviewGuide` types locally (field-identical) because the renderer can't import host `guide-types.ts` (it pulls `@superset/memory`); M5 confirms drop-in alignment once `generateGuide` is on the router.


## Decision Log

- Decision: Wave 5 adds a PR review window — all repo PRs, Diff + Guide tabs — on this branch.
  Rationale: User-directed; reuses the diff renderer, panes, and wave-3 memory.
  Date/Author: 2026-06-24, planning session.

- Decision: **The Guide never generates on its own — only the explicit "Generate guide" button triggers it.** New commits mark the cache stale and offer "Regenerate"; nothing runs automatically.
  Rationale: User decision ("generate guide button should not generate on its own") — avoids spontaneous AI runs / cost / surprise.
  Date/Author: 2026-06-24, planning session.

- Decision: Guide generation uses a **local AI session** (Claude Code / on-device agent) when connected, on top of a deterministic + memory-grounded skeleton; **no new Superset cloud model call**.
  Rationale: User decision ("all analysis using local ai sessions if claude code is connected") — keeps generation on the user's own agent; deterministic + memory baseline guarantees a useful guide even with no agent.
  Date/Author: 2026-06-24, planning session.

- Decision: All PRs of the repo (PR list + arbitrary-PR diff fetch).
  Rationale: User decision.
  Date/Author: 2026-06-24, planning session.

- Decision: Read-only core; local-only storage (host SQLite, no cloud schema change); commenting back to GitHub deferred.
  Rationale: Carry wave-3/4 discipline; keep the MVP read-only and egress-light.
  Date/Author: 2026-06-24, planning session.

- Decision (M4 local-AI seam): the live local-AI `complete` bridge is stubbed (returns null) pending a SAFE one-shot driver over the streaming `ctx.runtime.chat` — which has no clean synchronous one-shot (reply is via polling `getSnapshot`/`listMessages`; runs can raise tool-approval/sandbox questions; the real "model usable" signal `runtimeResolver` is private). The full enrichment pipeline (merge / redaction / STRUCTURAL anchor-preservation) is built + tested behind the `GuideEnrichmentSession` port; today `generateGuide` yields the deterministic + memory-grounded guide (the plan's specified no-session fallback). A genuine time-boxed bridge attempt follows; if a safe driver isn't tractable without broad changes / host-hang risk, the seam stands as the documented limitation. NO new Superset cloud model call either way.
  Rationale: ship the working deterministic guide + the complete enrichment infra now; do not ship a half-driven streaming bridge that could hang the host.
  Date/Author: 2026-06-24, guide teammate + orchestrator review.
  RESOLVED 2026-06-24 (commit `7f93106c2`): the safe one-shot driver WAS tractable entirely within `local-ai-session.ts` (no new manager methods, no exposed internals). `complete` sends the read-only prompt, polls `getSnapshot` to a settled reply, extracts the assistant text, and is bounded by a double 45s timeout (poll deadline + `Promise.race`); it declines (never auto-approves) any pending approval/question, always `stop`+`disposeRuntime` in `finally`, and returns null on any error / missing provider. The seam is CLOSED — the enrichment is live when a local provider + workspace exist; deterministic + grounded otherwise. Still NO new Superset cloud model call.


## Context and Orientation

Affected: `apps/desktop` (renderer) and `packages/host-service`. Untouched: `packages/panes`, `packages/workspace-fs`, the cloud schema (`packages/db`/`packages/trpc`).

Reuse anchors (all present):
- Diff renderer: `apps/desktop/.../usePaneRegistry/components/DiffPane/DiffPane.tsx` + `…/hooks/useDiffCodeViewItems.ts` (+ `@pierre/diffs` `CodeView`/`parseDiffFromFile`); `useChangeset`/`DiffRef` (the `against-base|uncommitted|commit` ref union to extend with a `pr` case).
- Pane shell + precedent: `packages/panes` store (`addTab`/`openPane`/`setPaneData`); `usePaneRegistry.tsx` (the `kind:"memory"` entry + `MemoryPaneData.section` segmented control); `useWorkspacePaneOpeners.ts` (`openMemoryPane`/`findMemoryPane` single-instance pattern).
- PR data: cloud `githubPullRequests` + `github.listPullRequests` (`packages/trpc/.../integration/github/github.ts`); host `pullRequests` + `PullRequestRuntimeManager` (gh CLI + Octokit factory) in `packages/host-service/src/runtime/pull-requests/`; host `git` router `getPullRequest`/`getPullRequestThreads`/`getDiff` and helpers `resolveBaseComparison`/`getChangedFilesForDiff` (`packages/host-service/src/trpc/router/git/`).
- Guide grounding: the `memory` tRPC router `retrieve`/`getPractice`/`listPlaybooks`/`listIndexEntries`; `pathsToAreas` + `gatherChangedFiles` + `distillDiffShape` (wave-3 capture primitives).
- Local AI session: `runAgentInWorkspace`/`ctx.runtime.chat` (`packages/host-service/src/trpc/router/agents/agents.ts`); the wave-4 A1 loopback memory MCP (`/mcp/memory`) so a CLI agent can pull grounding itself.
- Anchoring: wave-3 A3 `focusLine`/`focusColumn` on `FilePaneData` → `CodeView` → `revealPosition`.

How it fits today: a PR is only ever surfaced as "the current branch's PR" (`useReviewTab`), with no diff/body and no PR-browse list, and diffs only ever compare the local worktree HEAD. Wave 5 adds the PR list, an arbitrary-PR diff source, the two-tab pane, and the on-demand guide.


## Plan of Work

Seven milestones. M1 (diff source) and M2 (pane + list) form the visible shell; M3 (deterministic guide) → M4 (button + local AI) → M5 (anchors) make the Guide real; M6 is storage/staleness; M7 is the deferred commenting add. Across all: Bun only; object-param signatures; no `any`/`@ts-ignore`/empty catch; **renderer must not import Node modules** (`bun run lint:check-node-imports`); run `bun run lint:fix` and ensure `bun run lint` exits 0 before any commit; keep this plan's living sections updated.


### M1 — Arbitrary-PR diff source (host)
Scope: get the `base..head` diff of any repo PR (checked out or not) and PR body/base.
Plan: a host `prReview.getDiff({ projectId, prNumber })` that (a) fetches `pulls/{n}/files` via the Octokit factory already in the PR runtime (unified-diff patches → `parseDiffFromFile` items), falling back to local `git fetch` of the PR head + `git diff base...head` via `resolveBaseComparison`/`getChangedFilesForDiff` when the repo is local; (b) returns PR `body`/`baseBranch`/`headSha` (extend host PR sync to carry these). Cache the parsed diff by `(projectId, prNumber, headSha)` (M6 table).
Acceptance:

    bun dev
    # For a PR NOT checked out locally, prReview.getDiff returns a multi-file diff that renders.
    bun run typecheck && bun run lint && bun test packages/host-service

### M2 — PR-browse list + the `pr-review` pane shell
Scope: list all repo PRs and open one into the two-tab window.
Plan: a "Pull Requests" list (render `github.listPullRequests` or a host fetch) with an "open in review window" action. Add `PrReviewPaneData` (`{ prNumber, section: "diff"|"guide" }`) to the pane data union, a `"pr-review"` registry entry, and `openPrReviewPane` (mirror `openMemoryPane`, single-instance per PR). The **Diff** tab renders the existing `DiffPane` fed by M1's source (extend `DiffRef`/`getDiff` with a `pr` case). The **Guide** tab shows an empty state with a "Generate guide" button (M4).
Acceptance:

    bun dev
    # Open the PR list → open a PR → the pane shows Diff (rendered) and an empty Guide tab with a Generate button.

### M3 — Deterministic + memory-grounded guide skeleton (host)
Scope: the always-available, model-free guide content.
Plan: a host `buildGuideSkeleton({ projectId, prNumber })` that gathers the diff (M1), derives `areaTags` via `pathsToAreas`, calls `memory.retrieve` for grounding, and renders **markdown-with-anchors**: at-a-glance (metadata + diff stats), what-changed (by area + status, via `distillDiffShape`), read-first/review-order (deterministic priority: schema/migrations → entry/config/public-API → high-churn → tests last), risk flags (migration/auth/deleted-export/large-churn/no-test/lockfile), project conventions (`getPractice`), prior playbooks (`listPlaybooks` by area), where-X-lives (`listIndexEntries`), checks & threads. Each claim carries a `{file, line?, symbol?}` anchor. Degrades to diff-only sections when the repo isn't a locally-indexed project. No model.
Acceptance:

    bun test packages/host-service
    # buildGuideSkeleton on a seeded PR produces the sections with anchors; grounding sections present when indexed.

### M4 — "Generate guide" button → local-AI enrichment (button-only, never automatic)
Scope: the on-demand guide, optionally enriched by a local agent.
Plan: the **Generate guide** button (the ONLY trigger) calls a host `prReview.generateGuide({ projectId, prNumber })` that builds the M3 skeleton and, **if a local AI session is available**, enriches it by running the `superset` chat agent (`ctx.runtime.chat`) / a connected CLI agent over the diff + skeleton + memory grounding (the agent can also pull grounding via the wave-4 loopback `/mcp/memory`). If no local agent is connected, the M3 deterministic+memory guide is the result. Redact (`redactAll`) any captured text. Persist to `pr_review_guides` (M6). **Never invoked automatically** — not on open, view, or new commits.
Acceptance:

    bun dev
    # Click "Generate guide" → a memory-grounded guide appears (AI-enriched when Claude Code/agent connected; deterministic otherwise).
    # Verify NOTHING generates without the click: open/close the pane, switch tabs, push a new commit — no generation runs.

### M5 — Anchor wiring (guide ↔ code)
Scope: make every guide reference jump to the code.
Plan: render guide anchors as clickable; clicking sets the sibling **Diff** tab's active file and scrolls to the hunk, and/or opens the file in the editor at `file:line` (reuse wave-3 A3 `focusLine`/`revealPosition`). Symbol anchors resolve via the Project-Index ("where X lives"); PR/playbook anchors open the respective target.
Acceptance:

    bun dev
    # Click a "read first" file and a risk-flag line in the Guide → the Diff tab scrolls to that file/hunk (and/or the editor opens at the line).

### M6 — Storage/cache + manual staleness
Scope: cache the diff + guide locally and handle new commits without auto-running.
Plan: host SQLite tables (drizzle-generated, no cloud schema change): a guide cache keyed `(projectId, prNumber, headSha)` (+ a parsed-diff cache). On a PR's head SHA change (observed at the existing `upsertPullRequestRow` write site), mark the cached guide **stale** and surface a "Regenerate" button — **do not regenerate automatically**.
Acceptance:

    cd packages/host-service && bunx drizzle-kit generate --name="pr_review_guides"
    bun dev
    # Generated guide persists across reopen; after new commits the guide shows "stale — Regenerate" and only regenerates on click.

### M7 — Post review comments back to GitHub (DEFERRED, optional)
Scope: turn the guide/review into posted GitHub review comments.
Plan: via the GitHub MCP `pull_request_review_write` / `add_comment_to_pending_review` or `gh pr review`. Adds egress + write scope — **out of MVP**, kept here as the documented later add.
Acceptance: deferred.


## Concrete Steps (quick reference)

From repo root `/home/user/superset-vWorkspace` unless noted:

    bun install
    bun run typecheck                 # after each milestone
    bun run lint:fix && bun run lint  # lint MUST exit 0
    bun run lint:check-node-imports   # renderer must not import Node modules
    bun test
    bun dev

Host SQLite migration (M6), from `packages/host-service`:

    bunx drizzle-kit generate --name="pr_review_guides"


## Validation and Acceptance

End-to-end: connect GitHub → open the **Pull Requests** list (all repo PRs) → open a PR into the review window → the **Diff** tab renders the PR's `base..head` diff (even for a PR not checked out) → click **Generate guide** → a memory-grounded guide appears (AI-enriched when a local agent is connected, deterministic + grounded otherwise) → click a guide reference and land on the matching hunk/line. Verify: **nothing generates without the button** (open/close, tab-switch, new commits never auto-run — new commits show "stale — Regenerate"); the guide persists locally across reopen; no cloud schema change; no new Superset cloud model call.

Standing gates every milestone: `bun run typecheck` (no errors), `bun run lint` (exit 0), `bun test` (all pass), `bun run lint:check-node-imports` (renderer clean).


## Idempotence and Recovery

- M1 diff fetch + M3 skeleton are pure reads; safe to repeat. The diff/guide caches are keyed by `(projectId, prNumber, headSha)` — deleting them and re-fetching/regenerating is always safe.
- M4 generation is **explicit and idempotent per head SHA** — re-clicking regenerates and overwrites the cached guide for that SHA; it never runs on its own.
- M6's migration is drizzle-generated and forward-only (fix schema + regenerate if the diff is wrong; never edit historical migrations).
- The feature is read-only and adds no GitHub writes (M7 deferred); GitHub egress is limited to fetching PR data/diffs; the AI step uses the user's own local/connected agent.


## Interfaces and Dependencies

No cloud schema change; no new heavyweight dependencies (the GitHub Octokit + gh CLI already exist in the PR runtime; `@pierre/diffs` already renders diffs). New: a host `prReview` router (`getDiff`/`generateGuide`/guide-cache reads), a host guide-skeleton builder + local-AI enrichment step, local `pr_review_guides` (+ diff cache) tables, a `kind:"pr-review"` pane with a Diff|Guide segmented control + `openPrReviewPane`, a PR-browse list, an extended `DiffRef`/`getDiff` `pr` case, and the anchor-click wiring (reusing A3 `focusLine`). Reuse: `DiffPane`/`@pierre/diffs`, the panes store/registry, wave-3 memory (`retrieve`/`getPractice`/`listPlaybooks`/`listIndexEntries`/`pathsToAreas`/`gatherChangedFiles`/`distillDiffShape`), the local chat-agent surface, and the loopback `/mcp/memory`.


## Outcomes & Retrospective

**Wave 5 COMPLETE — 2026-06-24.** M1–M6 + the live local-AI bridge all landed and are green; M7 (comment-posting) deferred per plan. 16 commits on `claude/keen-euler-e9b3x8` (`32802e005`..).

**Against the Purpose:** a developer can browse ALL repo PRs (M2 "Pull Requests" list), open one into a Diff | Guide window (M2 `kind:"pr-review"` pane), and see the `base..head` diff even for a PR NOT checked out (M1 — Octokit `pulls/files` + a local `git fetch refs/pull/<n>/head` fallback; M2 synthesizes the `diff --git` header GitHub omits). Clicking **"Generate guide" (the ONLY trigger)** builds a deterministic, memory-grounded, code-anchored guide (M3 skeleton + wave-3 `retrieve`/`getPractice`/`listPlaybooks`/`listIndexEntries`), **AI-enriched through the developer's OWN on-device agent** when a local model provider + workspace exist (M4 + the live `ctx.runtime.chat` one-shot bridge; deterministic + grounded otherwise). Clicking a guide claim jumps the Diff tab to the matching hunk (M5 anchors + A3 `focusTick`). The guide persists locally (M6) and goes **stale → Regenerate on new commits without auto-running** (M6 head-SHA staleness flips a flag only).

**Guardrails verified (final acceptance):**
- **Never generates on its own** — `generateGuide` is a `mutation`; `getDiff`/`getCachedGuide` are read-only `query`s (generation is structurally unreachable from open/view/tab-switch); the head-SHA staleness site calls only `markGuideStaleOnHeadChange` (flag only); the renderer calls `generate` only from button `onClick` (no effect). So open/close, tab-switch, and a new commit run ZERO generation.
- **No new Superset cloud model call** — enrichment rides `ctx.runtime.chat` (the user's on-device agent) via a safe one-shot bounded by a double 45s timeout that declines tool-approvals and always tears the session down; `git`-grep finds no cloud model call.
- **No cloud schema change** — `git diff 32802e005..HEAD -- packages/db packages/trpc` is EMPTY; storage is host-side only (`pr_review_guides`/`pr_review_diffs`, migration `0011`, + `guide-cache`).
- **Read-only core** — GitHub egress limited to fetching PR data/diffs; M7 commenting deferred.

**Final gates:** `bun run typecheck` (turbo, whole tree) — **29/29 packages, 0 errors**; `packages/host-service` — **906/0/8-todo** (wave-5 suites 74/0); `apps/desktop` pr-review — **26/0**; `bun run lint` — **exit 0** (biome @2.4.2 clean). (Same env caveats as waves 1–4: whole-tree `bun test` crashes on pty-daemon → per-package is the gate; the `rg`-based lint sub-check is env-blocked locally, runs in CI.)

**Notable discoveries:** GitHub `pulls/files` patches are hunks-only (M2 header synthesis); GitHub vs git status vocab differs (M4 `normalizeFileStatus`); `ctx.runtime.chat` has no clean synchronous one-shot — M4's bridge built a safe driver (poll-to-settle + double timeout + decline-approvals + always-teardown) entirely within `local-ai-session.ts`.

**Honest boundary (handoff):** the interactive end-to-end (connect GitHub → open a real PR → click Generate → a real local-model enrichment) needs the running app + a configured local model provider + a project workspace; it was not executed headlessly. The code is complete and unit/integration-tested; the live-model path is exercised via mocks (a real provider returns enriched prose, no provider → the deterministic + grounded guide).


## Future (explicitly out of scope this wave)
- **Post review comments back to GitHub** (M7) — GitHub MCP `pull_request_review_write` / `gh pr review`; adds egress + write scope.
- **Auto-preview of the deterministic skeleton** on PR open (cheap, local) — deliberately omitted to honor "never generate on its own"; could be a later opt-in.
- **Cross-PR / repo-wide review dashboards.**


---

### Revision note

- 2026-06-24 04:46Z — Initial wave-5 draft: a PR review window (all repo PRs) with a Diff tab + a memory-grounded Guide tab. Encodes the user's decisions: scope = all repo PRs; the Guide is generated **only by an explicit "Generate guide" button — never on its own**; generation uses a **local AI session** (Claude Code / on-device agent) when connected on top of a deterministic + memory-grounded skeleton, with **no new Superset cloud model call**; guide claims are **code-anchored** (jump to Diff hunk / editor line via wave-3 A3); storage is **host-side/local** (no cloud schema change); read-only core with GitHub commenting deferred. Reuses the `DiffPane` renderer, the panes/Memory-pane segmented-control precedent, wave-3 memory, and the local chat-agent + loopback `/mcp/memory`.
