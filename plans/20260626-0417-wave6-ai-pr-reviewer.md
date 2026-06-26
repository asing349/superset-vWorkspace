# Wave 6 — grounded, agentic AI PR reviewer (review · comment · merge · manage context)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Reference: This plan follows conventions from `AGENTS.md` (repo root) and the ExecPlan template in `.agents/skills/create-plan/SKILL.md`. It is the **sixth wave** on branch `claude/keen-euler-e9b3x8`, on top of waves 1–5 (multi-root workspaces; multi-repo composition; **wave 3 Superset Memory**; Linear ticket→autonomous PR; **wave 5 PR review window**), all already implemented on this branch. Read those for the memory + PR-review foundation; this plan does not repeat them.


## Purpose / Big Picture

Wave 5 gave us a **PR review window** (a `pr-review` pane with a Diff tab + an on-demand, memory-grounded **Guide**). Wave 6 turns that into a **grounded, agentic AI PR reviewer** that a developer onboards per project and uses on a button press:

- **Set up AI reviewer** (per project) — configure a reviewer grounded in the project's context (its Coding Practice + observed business rules + the common/guide context). One-time onboarding; "ready" once configured.
- **Review PR** (button) — produce **structured findings** (severity + category, each anchored to a specific file/line in the Diff) grounded in the project's coding practices, prior playbook gotchas, and the project index. Like wave 5, this is **button-only — it never reviews on its own**, runs through the user's **own local AI session** (no new Superset cloud model call), and degrades to a deterministic baseline when no agent is connected.
- **Leave comments (opt-in)** — for any finding, the developer can **click to post** it to the PR on GitHub. Posting is an explicit, per-comment user action — never autonomous.
- **Merge** — a manual **Merge PR** button (confirm-gated). The reviewer never merges on its own.
- **Refresh context** (button) — re-read the current project context, **detect whether it changed** (practice/index/settings/features), and refresh — show what changed, never auto-run.
- **Manage context** — a cross-project view to see and refresh each project's context.
- **PR filters** — see all repo PRs, or only **PRs you created** / **you're tagged in / review-requested**.

The differentiator is grounding: the reviewer checks the diff against *this project's* conventions and the gotchas it has observed, and (wave 6's one new grounding piece) **persists the business rules it observes back as a new memory layer**, so it gets more grounded with use.

**Discipline carried from wave 5 (the reviewer's guardrails):** review is **button-only** (never automatic), uses a **local AI session only** (no new Superset cloud model call), **redacts** all model text, and stores everything **host-side/local** (no cloud schema change). **One deliberate, scoped posture change:** commenting and merge are GitHub *writes* — beyond wave-5's read-only envelope — so they are **explicit opt-in user actions** under the connected account's already-write-scoped token, never performed autonomously.


## Definitions (read this first; self-contained)

- **PR review window (wave 5)**: the `kind:"pr-review"` pane with an in-pane segmented control. Wave 6 adds a **Findings** section beside Diff and Guide.
- **Finding**: one review issue — `{ severity: info|warning|danger, category: correctness|business-logic|convention|security|perf, anchor: {file, line?, symbol?}, rationale, state: open|posted|dismissed }`. Findings extend the wave-5 guide artifact shape (`GuideItem` already has `text`, `anchor`, `severity`; wave 6 adds `category`, `rationale`, line-level anchors, and per-finding `state`).
- **The reviewer engine (reuse, wave 5)**: `fetchPrDiff` (raw per-file patches), `buildGuideSkeleton`'s deterministic risk/priority heuristics, `buildGroundingServices` (practice + playbooks + index + retrieve bundle), and the **local-AI `complete()` one-shot bridge** (`packages/host-service/src/runtime/pr-review/local-ai-session.ts` — 45 s timeout, **declines approvals**, degrades to null, always tears down; runs `ctx.runtime.chat` on the user's configured provider). All in `packages/host-service/src/runtime/pr-review/` + `…/trpc/router/pr-review/`.
- **The "context" (wave 3 memory)**: per-`projectId` Coding Practice (project + global, versioned), Project Index ("where X lives"), Playbooks (with `gotcha`), the memory graph — `memory` tRPC router + `packages/memory` + `memory_*` host SQLite tables.
- **Observed business rules (new, wave 6)**: a new project-scoped memory layer the reviewer writes — domain rules/invariants it infers at review time (which the structural project index does **not** capture today). Curated like the wave-3 practice consolidation.
- **Change detection (reuse)**: FNV-1a `contentHash` + `isFingerprintStale` (`packages/memory/src/fingerprint`), the `memory_fingerprints` upsert pattern, the wave-5 `stale`-flag + `markGuideStaleOnHeadChange`, and versioned practice with a built-in propose-diff (`consolidation-service.ts`). "Detect changed → offer refresh, never auto-run."
- **GitHub write surfaces**: the host has a write-capable Octokit `ctx.github()` (`app.ts`). Merge already ships (`github.mergePR` → `octokit.pulls.merge`, with a working v2 caller `PRStatusGroup`). PR search exists (`projects.searchPullRequests` / `workspaceCreation.searchPullRequests` → GitHub `search/issues` with qualifiers). Review threads are readable (`git.getPullRequestThreads`) and resolvable (`setReviewThreadResolution`). **No comment-posting path exists** — that is net-new.
- **host-service / renderer / main**: as in waves 1–5. Renderer = browser (no Node); host owns git/PRs/memory/agents.


## Assumptions

- A1. **Review is button-only — never automatic** (carry wave-5's guardrail). Opening a PR, switching tabs, or new commits never run a review; new commits mark cached findings **stale** and offer "Re-review" (a button).
- A2. **Review uses a local AI session only** (the wave-5 `complete()` bridge on the user's connected provider), with a **deterministic baseline** (the skeleton's risk/priority heuristics) as the always-available result. **No new Superset cloud model call.**
- A3. **All model output is redacted** (`redactText`/`redactAll`). Findings that reference a file not in the diff are rejected (anti-hallucination guard).
- A4. **Commenting and merge are explicit, opt-in user actions — never autonomous.** Each comment is posted only on a per-finding click; merge requires an explicit confirm. The reviewer never posts or merges on its own. These are GitHub *writes* under the connected account's already-write-scoped token (a deliberate, scoped change from wave-5's read-only core).
- A5. **All wave-6 storage is host-side/local** (new host SQLite tables: findings cache, reviewer config, observed-business-rules), drizzle-generated, keyed by `(projectId, …)`. **No cloud schema change** (`packages/db`/`packages/trpc` frozen).
- A6. **Reuse, don't reinvent:** the wave-5 review pipeline + anchors + cache + button-only mutation guardrail; wave-3 memory + fingerprints + consolidation; the shipped `github.mergePR`; `searchPullRequests` + GitHub qualifiers; `getPullRequestThreads`/`setReviewThreadResolution`; `project.list` for cross-project enumeration; `MemoryPane` as the manage-view precedent; `approved_ticket_context` + its router as the per-project config precedent. No change to `packages/panes`/`workspace-fs`.
- A7. **Viewer GitHub identity** (`@me`) for filters is resolvable via `github.getUser` / `getGitHubUsername` (already available).


## Open Questions

None blocking — decisions are in the Decision Log per the user's direction. Deferred-by-choice items are listed in Future.


## Progress

- [x] M1 — Review engine + Findings tab (2026-06-26T05:21Z): `prReview.reviewPr` (button-only mutation) → deterministic baseline + local-AI findings (severity + category + line anchors + anti-hallucination guard), host-SQLite findings cache + head-SHA staleness; Findings section in the pane (anchors → Diff). Shipped: `pr_review_findings` table + migration `0012_pr_review_findings.sql`; host engine `runtime/pr-review/{findings-types,parse-findings,build-findings,findings-cache,review-pr}.ts`; router `prReview.reviewPr` mutation + `getCachedFindings` query; `markFindingsStaleOnHeadChange` wired into `app.ts` head-change hook; renderer Findings tab (`FindingsTab` + `FindingsSectionView` reusing `GuideItemLine`, `useReviewPr` hook, `sections` registry now `diff|findings|guide`). Tests: parser/validator (valid parse, off-diff anti-hallucination drop, redaction), `@@` line-anchor computation, baseline derivation, staleness flip — host suite 940 pass / 0 fail; renderer PrReviewPane 21 pass. Gates: typecheck ✓, lint ✓ (exit 0), renderer Node-import guard ✓, `bun test packages/host-service` ✓.
- [x] M2 — PR filters (2026-06-26T05:36Z): the PR picker (`PullRequestsSubmenu`) now offers **All** / **Created by me** (`author:@me`) / **Review-requested · Tagged** (union of `review-requested:@me` / `assignee:@me` / `mentions:@me`) as a `DropdownMenuRadioGroup` of chips (chips `preventDefault` on select so switching keeps the submenu open). New Electron-main query `projects.listFilteredPullRequests({projectId, filter, includeClosed})` routes through the existing `gh pr list [--search]` path via a new shared `runGhPrList` helper; the review-requested union runs one search per qualifier and merges/dedupes by `prNumber`. `@me` is resolved server-side by GitHub to the gh-authenticated account (same identity `getGitHubUsername` reads via `gh api user`) — no client-side login substitution. Pure, testable logic extracted to `projects/utils/pr-filters/` (`searchQueriesForFilter` + `mergePullRequestsByNumber`). Read-only: no mutation, no cloud/schema change, no host-service change. Tests: `pr-filters.test.ts` (8 pass — qualifier mapping + union dedupe + first-seen order). Gates: typecheck ✓, lint ✓ (exit 0), renderer Node-import guard ✓, `bun test packages/host-service` 940 pass / 0 fail.
- [x] M3 — Opt-in commenting (2026-06-26T05:53Z): the one new GitHub WRITE surface, explicit + per-finding + opt-in (Assumption A4 / Decision Log). Host: a pure `postReviewComment` core (`…/trpc/router/github/post-review-comment.ts`) wrapped by a new `github.createReviewComment({owner, repo, pullNumber, commitId, body, path?, line?})` mutation — inline `octokit.pulls.createReviewComment` when `path`+`line` are present (M1's anti-hallucination guard makes the anchor safe), else a top-level `octokit.pulls.createReview` (`event:"COMMENT"`); the body is **redacted** (`redactText`) before any egress; returns `{ id, htmlUrl, inline }`. State flip: a new findings-cache helper `markFindingPosted({db, projectId, prNumber, findingId})` mutates ONLY that finding's `state` inside the existing `findings_json` blob and **preserves `stale` + `headSha`** (unlike `putFindings`, which resets `stale`), exposed as a `prReview.markFindingPosted` mutation returning the `{ report, stale }` shape. NO schema change. Renderer: a per-finding **"Post comment"** action in `FindingsSectionView` (co-located `FindingPostAction`), wired by a new `usePostFindingComment` hook (post → `markFindingPosted` → invalidate `getCachedFindings`); `commentTarget` (owner/repo) is parsed from the PR's html URL via a new pure `parsePrTarget` util; double-post guard = a `posted` finding shows a "Posted" badge and a quieter "Post again" (re-post needs a second explicit click). No bulk "post all"; review stays button-only. Tests: `post-review-comment.test.ts` (6 — inline-vs-top-level selection, redaction on both paths, single-write/no-dual-post), `markFindingPosted` (5 added to `findings-cache.test.ts` — single-finding flip + persisted, stale-preserved, idempotent, unknown id, null when no review), `parsePrTarget.test.ts` (6 — owner/repo extraction + null cases). Gates: typecheck ✓, lint ✓ (exit 0), renderer Node-import ban ✓ (no `node:` / `@superset/workspace-fs/{host,server}` in new renderer files), `bun test packages/host-service` 951 pass / 0 fail, PrReviewPane renderer suite 27 pass / 0 fail.
- [x] M4 — Manual merge + threads (2026-06-26T06:10Z): a confirm-gated **Merge PR** button in the PR-review header + an existing-review-**Threads** tab, both as explicit opt-in user actions (Assumption A4). Merge: a co-located `PrMergeButton` (under `PrReviewHeader/components/PrMergeButton`) reusing the shipped `github.mergePR` (`octokit.pulls.merge`) verbatim — copying the `PRStatusGroup` toast lifecycle + post-merge refresh — behind an `AlertDialog` confirm with a strategy `Select` (squash/merge/rebase, default squash); the merge fires ONLY from the dialog's "Confirm merge" click. The header shows it only while `prRow.state === "open"` (the UI already-merged/closed guard; `octokit.pulls.merge`'s 405 is the authoritative one); on success it invalidates `electronTrpc.projects.listPullRequests` so the row's state flips and the button hides. Owner/repo come from M3's `parsePrTarget(prRow.url)` (renamed `commentTarget`→`prTarget`, now shared by post-comment + merge + threads). Threads: the host `git.getPullRequestThreads` / `setReviewThreadResolution` are **generalised** to take explicit GitHub coordinates — `getPullRequestThreads` input is now `z.union([{workspaceId}, {owner,name,prNumber}])` and `setReviewThreadResolution.workspaceId` is now optional (existing v1/v2 workspace callers stay green; the fetch body is extracted to a pure `fetchReviewThreads({octokit,owner,name,prNumber})` core). New renderer: a `useReviewThreads` hook + `ThreadsTab` (ordered actionable-first via a pure `orderReviewThreads` util) reading by `{owner,name,prNumber}` and toggling resolution by `{threadId,resolved}` (no workspace). Sections registry is now `diff|findings|guide|threads` (+ `PrReviewPaneData.section`). NO schema change; merge + threads are GitHub API calls only. Tests: host `fetch-review-threads.test.ts` (5 — coord plumbing into GraphQL + REST, comment pagination/empty-drop, independent degradation); renderer `orderReviewThreads.test.ts` (5 — rank order, stability, no-mutation) + `sections.test.ts` extended for the threads tab. Gates: typecheck ✓, lint ✓ (exit 0), renderer Node-import ban ✓ (no `node:` / `@superset/workspace-fs/{host,server}` in new renderer files), `bun test packages/host-service` 956 pass / 0 fail, PrReviewPane renderer suite 32 pass / 0 fail.
- [ ] M5 — Reviewer onboarding/config + Refresh-context + cross-project Manage-context view (host config table; setup-card gate; fingerprint/version snapshot staleness; `project.list`-driven manage view).
- [ ] M6 — Observed-business-rules memory layer: persist what the reviewer infers as a new project-scoped memory store, curated by consolidation, feeding future grounding (the differentiator).

Timestamp each item when checked off; split partials into done/remaining.


## Surprises & Discoveries

- Observation: the AI reviewer is ~70% assembly of wave-5/wave-3 parts; merge already ships and the never-merge rule is orchestrator-only.
  Evidence: the wave-5 `generateGuideCore` pipeline + `local-ai-session.complete()` + `buildGroundingServices` transfer to a `reviewPr` sibling; `github.mergePR` (`octokit.pulls.merge`) is already called by the v2 `PRStatusGroup`; `never-merge.test.ts` greps only the ticket-run orchestrator, not UI.

- Observation: "business logic" has no store today — the project index is structural ("where X lives"), not behavioral.
  Evidence: `packages/memory/src/structural-map` summarizes exported symbols; `distillDiffShape` is paths+churn only. So observed business rules are net-new (M6).

- Observation (M1): the deterministic baseline is most cleanly built by REUSING the wave-5 skeleton's `risk-flags` section rather than re-deriving the heuristics — those path predicates (`isMigrationPath`/`isAuthPath`/`removesExport`/…) are module-private in `build-guide-skeleton.ts`. `deriveBaselineFindings({ guide })` projects each risk flag onto a `Finding`, classifying `category` from the flag's stable phrasing (`classifyRiskFlag`, locked by a test). Baseline findings are file-level (no line); line anchors come from the local-AI pass only.

- Observation (M1): line anchoring is purely from the `@@` hunk headers' NEW-side ranges (`+start,count` → `start..start+count-1`); a model-supplied `line` is KEPT only if it falls in a range, else dropped to a file-only anchor (never fabricated). The anti-hallucination guard drops a whole finding only when its `file` ∉ the diff's changed-file set (which includes rename `previousFilename`).

- Surprise (M1, gate): the standing gate `bun run lint:check-node-imports` is NOT a root npm script — the renderer Node-import ban is enforced by a Biome `noRestrictedImports` override on `apps/desktop/src/renderer/**` (`node:*` + `@superset/workspace-fs/{host,server}`), which runs inside `bun run lint` (exit 0). Verified the new renderer files import no `node:*`.

- Surprise (M1, gate): full-repo `bun test` aborts with a Bun C++ panic triggered by `packages/pty-daemon/test/control-plane.test.ts` (TCP framing / detached process-group kills) — it fails 19/32 in isolation too, independent of any M1 change (an OS/sandbox flake). `bun test packages/host-service` (940 pass / 0 fail) and the renderer PrReviewPane suite (21 pass) are green.

- Surprise (M2): the PR picker that opens a `pr-review` pane is the **Electron-main** path, not host-service. `PullRequestsSubmenu` (in `AddTabMenu`, → `onOpenPullRequest={openPrReviewPane}`) reads `electronTrpc.projects.listPullRequests` (`gh pr list` in the desktop main process), NOT the host-service `workspaceCreation.searchPullRequests`. So M2's wiring lives in `apps/desktop/src/lib/trpc/routers/projects/projects.ts` + the renderer submenu — host-service is untouched (the `bun test packages/host-service` gate is pure regression for M2). The tasks-view `PullRequestsContent` (host-service path, navigates to `/tasks/pr/$prNumber`) and the workspace-creation `PRLinkCommand` are different surfaces and out of M2 scope.

- Surprise (M2): GitHub search **AND-combines** qualifiers within one query, so `review-requested:@me assignee:@me mentions:@me` as a single search means "all three at once" (≈ empty). The "tagged" union therefore must run **one search per qualifier** and be merged/deduped by `prNumber` — done server-side in `listFilteredPullRequests` via `Promise.all` + `mergePullRequestsByNumber` (first-seen order, so review-requested wins on collision).

- Decision (M2): use **literal `@me`** qualifiers (not a resolved login). `gh pr list --search` runs as the gh-authenticated account and GitHub resolves `@me` to that same identity (`getGitHubUsername` itself just reads `gh api user`), so substituting a login would add a round-trip and a mismatch risk for zero benefit. This matches the Decision-Log line that literally specifies `author:@me`; A7's "resolvable via getGitHubUsername" stays available but isn't needed for the `gh`-CLI path. The viewer login *will* still be the way to resolve `@me` for any future host-service/Octokit search path.

- Surprise (M3): `putFindings` ALWAYS resets `stale=false` (a fresh review is current by definition), so it is the WRONG primitive for the M3 state flip — re-persisting a stale report through it to mark one finding `posted` would silently un-stale a report whose head advanced. M3 therefore adds a dedicated `markFindingPosted` cache helper that updates only the matching finding's `state` inside the `findings_json` blob and leaves `stale` + `headSha` untouched (a test pins this). The renderer flow is two writes — `github.createReviewComment` then `prReview.markFindingPosted` — then an invalidate of `getCachedFindings` (the single read path, mirroring `useReviewPr`).

- Surprise (M3): the renderer has no `owner`/`repo` in hand for the comment-post call. The PR-review pane's `prRow` (from `electronTrpc.projects.listPullRequests`) carries only `{ prNumber, title, url }` — no `repoOwner`/`repoName` columns (unlike the tasks-view PR rows the merge caller `PRStatusGroup` uses). The pane already fetches that row for the header, so M3 derives `{ owner, repo }` from its `url` (`https://github.com/{owner}/{repo}/pull/{n}`) via a pure, browser-safe `parsePrTarget` util rather than adding a host round-trip; the `commit_id` is the reviewed `report.headSha` (so an inline comment anchors to the exact code the finding describes, and GitHub correctly rejects a post if that commit isn't in the PR). Posting is disabled (`canPost=false`) until both resolve.

- Surprise (M3): the desktop renderer has NO component-render test infra (no `@testing-library/react`; existing PrReviewPane tests are pure `.test.ts` for utils/hooks logic). So M3's renderer test is the pure `parsePrTarget` parser (the load-bearing new logic); the post-orchestration hook + button are exercised by typecheck + the host-side mutation tests rather than a DOM render.

- Surprise (M4): `github.mergePR` (host) already takes `{owner, repo, pullNumber, mergeMethod}` (NOT worktree/branch based — that's the SEPARATE Electron-main `changes.mergePR` used by the v1 `PRButton`). So M4's merge is a thin reuse: the same `parsePrTarget(prRow.url)` M3 added gives `{owner, repo}`, `prNumber` is in hand, and the strategy is the dropdown value — zero new merge path. `prRow.state` (`"open"|"draft"|"merged"|"closed"`, already on the `projects.listPullRequests` row) is the UI guard; GitHub's `octokit.pulls.merge` 405 on a non-open PR is the authoritative one. Post-merge refresh is just invalidating the `electronTrpc.projects.listPullRequests` query the pane already reads.

- Surprise (M4): `git.getPullRequestThreads` and `setReviewThreadResolution` were both keyed on `workspaceId` (threads: workspace→pullRequestId→prNumber + `resolveGithubRepo(projectId)`; resolution: workspace existence guard only). Generalising WITHOUT breaking the v1/v2 workspace callers was a clean two-step: (1) make the threads input a `z.union([{workspaceId}, {owner,name,prNumber}])` and branch with `"workspaceId" in input` (TS narrows the union), extracting the GraphQL+REST body into a pure injectable `fetchReviewThreads` core; (2) make `setReviewThreadResolution.workspaceId` OPTIONAL — the resolve/unresolve GraphQL mutation only needs the global thread node id, so the PR-review pane omits it entirely while the workspace surfaces still pass it (the existence guard runs only when present). Both keep the return shape identical, so the existing `.useQuery({workspaceId})` / `.invalidate({workspaceId})` / `.mutate({workspaceId,…})` callers typecheck unchanged.

- Surprise (M4): threads render as a 4th pane tab (`diff|findings|guide|threads`) rather than inline — extending the data-driven `PR_REVIEW_SECTIONS` registry is the least-surprise home (mirrors M1's Findings tab). This required widening the closed `PrReviewPaneData.section` union AND the `sections.ts` `PrReviewSection` union to include `"threads"` (two sources — the persisted-pane type lives at `…/$workspaceId/types.ts`, separate from the renderer-local `sections.ts`). The renderer-test gap (no DOM infra, per M3) is again covered by a pure helper: `orderReviewThreads` (unresolved-current → unresolved-outdated → resolved-current → resolved-outdated, stable within a bucket).

(Add observations as work proceeds.)


## Decision Log

- Decision: Wave 6 builds a grounded agentic AI PR reviewer on the wave-5 window + wave-3 memory.
  Rationale: User-directed; ~70% reuse per the investigation.
  Date/Author: 2026-06-26, planning session.

- Decision: Review is **button-only** (never automatic), **local AI session only** (no new Superset cloud model call), **redacted**, **host-local storage** — carry the wave-5 guardrails verbatim.
  Rationale: Consistency + the user's stated preference; keeps egress + cost controlled.
  Date/Author: 2026-06-26, planning session.

- Decision: **Commenting and merge are explicit opt-in user actions, never autonomous** (per-comment click; confirm-gated merge). They add GitHub write egress beyond wave-5's read-only core — a deliberate, scoped change under the already-write-scoped token.
  Rationale: User asked for click-to-comment + merge; safety requires they never run on their own. The never-merge guardrail is orchestrator-only and does not apply to user-initiated UI merges.
  Date/Author: 2026-06-26, planning session.

- Decision: Persist **observed business rules** as a new project-scoped memory layer (M6), curated like wave-3 practice.
  Rationale: It's the one missing grounding piece and the thing that makes the reviewer "onboard and improve per project."
  Date/Author: 2026-06-26, planning session.

- Decision: "Refresh context" detects change via fingerprints/version snapshots and **offers** a refresh — never auto-runs (mirror the wave-5 stale-flag + Regenerate pattern).
  Rationale: Carry the wave-5 "never on its own" discipline to context refresh.
  Date/Author: 2026-06-26, planning session.

- Decision: Filters reuse GitHub search qualifiers; "created" is trivial, "tagged/review-requested" must go through GitHub search (the cloud table lacks reviewer/mention columns).
  Rationale: Investigation found the cloud `githubPullRequests` table cannot serve reviewer/mention filters.
  Date/Author: 2026-06-26, planning session.

- Decision (M1): the findings artifact is a `FindingsReport` (`{ findings: Finding[], prNumber, headSha, enriched, baselineOnly }`) stored as ONE JSON blob in `pr_review_findings.findings_json` (mirroring the guide-cache blob), with per-finding `state` (`open|posted|dismissed`) INSIDE the JSON so M3's comment-post flips one finding without a schema change. `getCachedFindings` returns `{ report, stale } | null` — uses `report` (not `guide`) to avoid a `findings.findings` collision; otherwise identical to the wave-5 `getCachedGuide` shape.
  Rationale: Match the wave-5 guide-cache style exactly (least surprise, reuses the staleness pattern), keep the per-finding state mutable cheaply for M3.
  Date/Author: 2026-06-26T05:21Z, M1 implementation.

- Decision (M3): split the post into TWO mutations — a low-level `github.createReviewComment` (the octokit write, redaction, inline-vs-top-level selection; signature `{owner, repo, pullNumber, commitId, body, path?, line?}`, unit-tested against a fake octokit via the pure `postReviewComment` core) and a `prReview.markFindingPosted` (the host-local state flip) — orchestrated by the renderer (`usePostFindingComment`: post → mark → invalidate). Rationale: the GitHub write naturally belongs in the `github` router beside `mergePR` and is the testable seam M3's host test targets; the state flip is a findings-cache concern keyed by `(projectId, prNumber, findingId)`, so it belongs in `prReview` next to `getCachedFindings`. The top-level fallback uses `octokit.pulls.createReview` (`event:"COMMENT"`) rather than `issues.createComment` so a file-only finding still posts as a PR *review* comment (one coherent surface). The double-post guard is UI-level (a `posted` finding requires a deliberate second "Post again" click); `markFindingPosted` itself is idempotent so a re-post is harmless.
  Date/Author: 2026-06-26T05:53Z, M3 implementation.

- Decision (M4): generalise the EXISTING `git.getPullRequestThreads` / `setReviewThreadResolution` (union input + optional `workspaceId`) rather than adding parallel `prReview.*` thread procedures. Rationale: the plan/Assumption A6 says these "exist" and to reuse them; a `(owner,name,prNumber)` parameterisation is the minimal change that serves an arbitrary PR while keeping the v1/v2 workspace callers green (a sibling procedure would duplicate the GraphQL + REST + parser surface). The fetch body is extracted to a pure `fetchReviewThreads` core so the new coordinate plumbing is unit-testable against a fake Octokit (the M3 `postReviewComment` precedent). Merge stays the shipped `github.mergePR` untouched — the M4 add is purely the confirm-dialog caller + the post-merge list invalidation.
  Date/Author: 2026-06-26T06:10Z, M4 implementation.

- Decision (M4): the Merge PR confirm is an `AlertDialog` (NOT the `DropdownMenu`-of-strategies the v2 `PRStatusGroup` uses) with a strategy `Select` inside, defaulting to **squash**. Rationale: the plan explicitly asks for a "confirm dialog with a merge-strategy dropdown"; an AlertDialog makes the merge a deliberate two-step (open → pick strategy → Confirm) vs PRStatusGroup's one-click-per-item dropdown, which better fits A4's "explicit, confirm-gated, never autonomous" posture. Plain `AlertDialogContent` (not the Enter-to-confirm variant) avoids an accidental Enter-key merge. Default squash matches PRStatusGroup's first-listed/most-common method; the user can still pick merge/rebase.
  Date/Author: 2026-06-26T06:10Z, M4 implementation.

- Decision (M1): the Findings section reuses the guide renderer by exporting `GuideItemLine` from `GuideSectionView` and composing it inside a new `FindingsSectionView` (grouped by severity, with a category badge per finding), rather than feeding a synthetic guide into `GuideSectionView` (whose section `id` is the closed `GuideSectionId` union). Same `onOpenAnchor` → `resolveScrollTarget` flow; anchors now carry a NEW-side `line`, so clicking a finding scrolls the Diff tab to the file/line.
  Rationale: `Finding` carries `category` (which `GuideItem` lacks) and findings group by severity, not by guide section; exporting the leaf line component is the minimal true reuse.
  Date/Author: 2026-06-26T05:21Z, M1 implementation.


## Context and Orientation

Affected: `apps/desktop` (renderer) and `packages/host-service`. Untouched: `packages/panes`, `packages/workspace-fs`, the cloud schema (`packages/db`/`packages/trpc`).

Reuse anchors (all present):
- Reviewer engine: `packages/host-service/src/runtime/pr-review/{generate-guide,build-guide-skeleton,enrich-guide,fetch-pr-diff,local-ai-session,guide-cache,guide-types}.ts` + `…/trpc/router/pr-review/pr-review.ts` (the button-only `.mutation` + `buildGroundingServices`). The renderer pane `apps/desktop/.../usePaneRegistry/components/PrReviewPane/*` + `resolveScrollTarget` + `GuideSectionView` (anchor → Diff).
- Memory (the context): `…/trpc/router/memory/memory.ts` (`getPractice`/`listPlaybooks`/`listIndexEntries`/`indexStatus`/`reindex`/`consolidatePractice`…) + `packages/memory/*` + `memory_*` tables; `packages/memory/src/fingerprint`; `consolidation-service.ts` (propose-diff).
- GitHub writes/reads: `…/trpc/router/github/github.ts` (`mergePR` via `octokit.pulls.merge`; `getUser`) + `ctx.github()` (`app.ts`); `…/trpc/router/git/git.ts` (`getPullRequestThreads`, `setReviewThreadResolution`); `apps/desktop/.../PRStatusGroup/PRStatusGroup.tsx` (working merge caller). Comment posting = net-new (`octokit.pulls.createReview`/`createReviewComment`/`issues.createComment`).
- Filters: `apps/desktop/src/lib/trpc/routers/projects/projects.ts` (`listPullRequests`/`searchPullRequests` → `gh pr list --search`); `…/workspace-creation/procedures/search-pull-requests.ts` (`ghApiSearchPullRequests`, `q=repo:… is:pr <qualifiers>`); `getGitHubUsername`.
- Config/onboarding precedent: `approved_ticket_context` + `…/trpc/router/ticket-context/ticket-context.ts` (upsert-keyed per-project + redact-before-write); `…/trpc/router/config/config.ts` (`shouldShowSetupCard`); `project.list`. Manage-view precedent: `…/MemoryPane/MemoryPane.tsx` (single-project today).


## Plan of Work

Six milestones. M1 lands the reviewer + findings (the core value). M2 (filters) is cheap read-only. M3 (commenting) is the one new write surface. M4 (merge + threads) is mostly wiring. M5 (onboarding/config/refresh/manage) makes it "onboarded per project." M6 (business-rules layer) is the compounding differentiator. Across all: Bun only; object-param signatures; no `any`/`@ts-ignore`/empty catch; **renderer must not import Node modules** (`bun run lint:check-node-imports`); `bun run lint` exits 0 before any commit; keep this plan's living sections updated.


### M1 — Review engine + Findings tab
Scope: produce grounded, anchored findings on a button press.
Plan: a `prReview.reviewPr({projectId, prNumber})` **mutation** (the only generator — never a query/effect) that mirrors `generateGuideCore`: `fetchPrDiff` → deterministic baseline findings from the skeleton's risk/priority heuristics → **local-AI findings** via the `local-ai-session.complete()` bridge with a **findings prompt** (model emits `{findings:[{severity,category,file,line?,symbol?,rationale}]}`) + a **parser/validator** that redacts text and **rejects findings whose file isn't in the diff**; compute **line anchors** by parsing `@@` hunk headers in the raw patch → NEW-side line. Persist to a new host `pr_review_findings` table keyed `(projectId, prNumber, headSha)` with a `stale` flag + per-finding `state`; head-SHA change flips `stale` only (reuse the `markGuideStaleOnHeadChange` pattern). Renderer: a **Findings** section in `PrReviewPane` (sibling of Diff/Guide), reusing `GuideSectionView`'s anchored-item rendering + `onOpenAnchor` → `resolveScrollTarget` (now with line targets). Degrades to baseline when no local agent.
Acceptance:

    bun dev
    # Open a PR → "Review PR" → grounded findings appear with severity+category, each jumping the Diff tab to the file/line.
    # Verify: open/view/tab-switch/new-commit run NO review (new commit → "stale — Re-review" button only); no new cloud model call.
    bun run typecheck && bun run lint && bun test packages/host-service

### M2 — PR filters
Scope: all repo PRs / created / tagged·review-requested.
Plan: route the PR list through `searchPullRequests` with GitHub qualifiers — created `author:@me`, tagged/review-requested `review-requested:@me`/`mentions:@me`/`assignee:@me` — resolving `@me` via `github.getUser`/`getGitHubUsername`. Filter chips in the Pull-Requests list. Read-only.
Acceptance:

    bun dev
    # The PR list offers All / Created by me / Review-requested·Tagged; each returns the right PRs.

### M3 — Opt-in commenting
Scope: post a finding to the PR as a review comment, on explicit click.
Plan: a host `github` write mutation using `ctx.github()` → `octokit.pulls.createReviewComment` (inline `{path,line,body}`) or `octokit.pulls.createReview` / `issues.createComment` (top-level). Renderer: a per-finding **"Post comment"** action; on success the finding flips to `posted`. Explicit opt-in only — no bulk auto-post; redact the body. (Adds GitHub write egress — gated per Decision Log.)
Acceptance:

    bun dev
    # Click "Post comment" on a finding → it appears on the PR on GitHub; the finding shows "posted". Nothing posts without the click.

### M4 — Manual merge + threads
Scope: a confirm-gated merge button and existing-thread display.
Plan: reuse `github.mergePR` (`octokit.pulls.merge`, PR-number based) behind a **confirm dialog** (strategy dropdown), copying the `PRStatusGroup` caller pattern; post-merge refresh. Show existing review threads (read `getPullRequestThreads`) and allow resolve/unresolve (`setReviewThreadResolution`), parameterized by `(owner,name,prNumber)` for arbitrary PRs. The reviewer never merges on its own.
Acceptance:

    bun dev
    # "Merge PR" → confirm → the PR merges on GitHub; existing review threads render and resolve.

### M5 — Reviewer onboarding/config + Refresh-context + Manage-context
Scope: onboard the reviewer per project, refresh its context on demand, and manage all projects.
Plan: a host `pr_review_reviewer_config` table keyed `(projectId)` (FK `projects.id` cascade) storing enabled state + which context layers it grounds on + a **fingerprint/version snapshot** of the context it was configured against; a `reviewer` tRPC router (mirror `ticket-context.ts`). A **"Set up AI reviewer"** setup-card gated like `config.shouldShowSetupCard`; on accept, snapshot + mark ready (grounded via `buildGroundingServices`). A **"Refresh context"** action: read current context (practice version id + index `commitSha`/`lastIndexedAt` + a settings/feature hash), diff vs the snapshot via `isFingerprintStale`; if changed, re-snapshot (optionally `reindex`/`consolidatePractice`) — **show what changed, never auto-run**. A **"Manage context" view** that enumerates `project.list` and renders a per-project context card (reuse the `{projectId}`-keyed memory hooks + the `SettingsSection` shape), each with its own Refresh. Wire `app.ts` listeners (practice-written / index-refreshed / head-changed) to mark the per-project reviewer context **stale** (flag-only).
Acceptance:

    bun dev
    # "Set up AI reviewer" on a project → ready. Edit the practice → Manage context shows that project's context "changed" → Refresh updates the snapshot. The cross-project view lists all projects.

### M6 — Observed-business-rules memory layer (the differentiator)
Scope: let the reviewer persist what it observes so grounding compounds.
Plan: a new project-scoped host SQLite store (mirroring the `memory_*` shape) for **observed business rules/invariants** the reviewer infers at review time (from PR body + diff + practice + playbook gotchas). Surface them in the reviewer's grounding (`buildGroundingServices`) and curate them via a consolidation step (reuse the wave-3 propose/accept/revert + versioning pattern). No model output stored unredacted.
Acceptance:

    bun dev
    # After reviewing several PRs, observed business rules accumulate (curated/accepted by the user) and ground later reviews; visible in Manage context.


## Concrete Steps (quick reference)

From repo root `/home/user/superset-vWorkspace` unless noted:

    bun install
    bun run typecheck
    bun run lint:fix && bun run lint
    bun run lint:check-node-imports
    bun test
    bun dev

Host SQLite migrations (M1/M5/M6), from `packages/host-service`:

    bunx drizzle-kit generate --name="pr_review_findings"   # M1 (and reviewer_config / business_rules likewise)


## Validation and Acceptance

End-to-end: connect GitHub → set up the AI reviewer on a project → open a PR (filter to "created by me" / "review-requested") → **Review PR** → grounded findings with severity+category, each jumping the Diff to the file/line → **Post** the findings you choose (they appear on GitHub) → **Merge PR** (confirm) → edit the project's practice → **Manage context** shows it changed → **Refresh context**. Verify: review is **button-only** (open/view/tab/new-commit run nothing; new commit → "stale — Re-review"); **no new Superset cloud model call**; **nothing posts or merges without an explicit click/confirm**; all storage host-local; **no cloud schema change**.

Standing gates every milestone: `bun run typecheck`, `bun run lint` (exit 0), `bun test`, `bun run lint:check-node-imports`.


## Idempotence and Recovery

- M1 findings + M2 filters are reads/idempotent; the findings cache keyed `(projectId, prNumber, headSha)` is safe to delete/regenerate; re-review overwrites for that SHA. Generation is button/mutation-only; staleness flips a flag.
- M3 comment posting is the only non-idempotent write — guard against double-post (a finding flips to `posted`; re-post requires explicit intent). M4 merge is confirm-gated and reuses the existing already-merged/closed guards.
- M5/M6 migrations are drizzle-generated, forward-only. Config/business-rules are local; deleting them re-prompts onboarding/re-derives.
- GitHub write egress is confined to M3 (comments) and M4 (merge), both explicit user actions under the existing write-scoped token; all model calls run on the user's local provider.


## Interfaces and Dependencies

No cloud schema change; no new heavyweight dependencies (Octokit + gh + `@pierre/diffs` + the wave-5 pipeline + wave-3 memory all exist). New: a host `prReview.reviewPr` mutation + findings prompt/parser/line-anchor + `pr_review_findings` table + a Findings pane section; PR-filter wiring; a host `github` comment-post mutation + per-finding post UI; a confirm-gated merge button (reusing `github.mergePR`) + thread display; a host `reviewer` config router + `pr_review_reviewer_config` table + setup-card + Refresh-context + a cross-project Manage-context view; an observed-business-rules store + consolidation. Reuse: the wave-5 reviewer engine/anchors/cache/guardrail, wave-3 memory/fingerprints/consolidation, `github.mergePR`, `searchPullRequests`, `getPullRequestThreads`/`setReviewThreadResolution`, `project.list`, the `approved_ticket_context`/`MemoryPane` precedents.


## Outcomes & Retrospective

To be filled in at completion. Compare against the Purpose: a developer can onboard an AI reviewer per project, review any repo PR on a button press with grounded severity/category findings anchored to code, post the comments they choose, merge with a confirm, filter to their own/tagged PRs, refresh and manage context across projects — all button-driven, local-AI, host-local, with commenting/merge as explicit opt-in writes and the reviewer compounding via observed business rules.


## Future (explicitly out of scope this wave)
- **Autonomous/scheduled review** (deliberately excluded — review is button-only).
- **Auto-posting all findings** or **auto-merge** (excluded — both are explicit per-action).
- **Cross-repo / org-wide review dashboards**; **org/cloud-shared reviewer config** (carry the local-only discipline).


---

### Revision note

- 2026-06-26 04:17Z — Initial wave-6 draft: a grounded agentic AI PR reviewer built on the wave-5 PR-review window + wave-3 memory. Encodes the user's asks (set-up reviewer per project; Review-PR button → grounded findings; opt-in click-to-comment; manual merge; refresh-context with change detection; cross-project manage-context; "created/tagged" PR filters) and the carried guardrails (button-only review; local AI session only / no new cloud model call; redaction; host-local storage). The one deliberate posture change — commenting + merge add GitHub write egress beyond wave-5's read-only core — is gated as explicit opt-in user actions (Decision Log). Reuses the wave-5 reviewer pipeline/anchors/cache, wave-3 memory/fingerprints/consolidation, the shipped `github.mergePR`, `searchPullRequests` + GitHub qualifiers, and the `approved_ticket_context`/`MemoryPane` precedents. The compounding differentiator (M6) persists observed business rules as a new project-scoped memory layer.
