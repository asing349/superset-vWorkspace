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

- [ ] M1 — Review engine + Findings tab: `prReview.reviewPr` (button-only mutation) → deterministic baseline + local-AI findings (severity + category + line anchors + anti-hallucination guard), host-SQLite findings cache + head-SHA staleness; Findings section in the pane (anchors → Diff).
- [ ] M2 — PR filters: all repo PRs / created (`author:@me`) / tagged·review-requested (`review-requested:@me`/`mentions:@me`/`assignee:@me`) via `searchPullRequests` + viewer `@me`.
- [ ] M3 — Opt-in commenting: a host `github` write mutation (`createReview`/`createReviewComment`/`issues.createComment`) + per-finding "Post comment" (explicit click); findings flip to `posted`.
- [ ] M4 — Manual merge + threads: a confirm-gated "Merge PR" button (reuse `github.mergePR`); show/resolve existing review threads (parameterized by `(owner,name,prNumber)`).
- [ ] M5 — Reviewer onboarding/config + Refresh-context + cross-project Manage-context view (host config table; setup-card gate; fingerprint/version snapshot staleness; `project.list`-driven manage view).
- [ ] M6 — Observed-business-rules memory layer: persist what the reviewer infers as a new project-scoped memory store, curated by consolidation, feeding future grounding (the differentiator).

Timestamp each item when checked off; split partials into done/remaining.


## Surprises & Discoveries

- Observation: the AI reviewer is ~70% assembly of wave-5/wave-3 parts; merge already ships and the never-merge rule is orchestrator-only.
  Evidence: the wave-5 `generateGuideCore` pipeline + `local-ai-session.complete()` + `buildGroundingServices` transfer to a `reviewPr` sibling; `github.mergePR` (`octokit.pulls.merge`) is already called by the v2 `PRStatusGroup`; `never-merge.test.ts` greps only the ticket-run orchestrator, not UI.

- Observation: "business logic" has no store today — the project index is structural ("where X lives"), not behavioral.
  Evidence: `packages/memory/src/structural-map` summarizes exported symbols; `distillDiffShape` is paths+churn only. So observed business rules are net-new (M6).

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
