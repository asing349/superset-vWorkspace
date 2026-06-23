# Wave 4 — wave-1/2/3 leftovers + Linear ticket → autonomous PR

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Reference: This plan follows conventions from `AGENTS.md` (repo root) and the ExecPlan template in `.agents/skills/create-plan/SKILL.md`. It is the **fourth wave** on branch `claude/keen-euler-e9b3x8`, on top of `plans/20260619-0604-multi-root-workspaces.md` (wave 1), `plans/20260619-2359-multi-repo-worktrees-and-gap-closure.md` (wave 2), and `plans/20260623-0306-wave3-gap-closure-and-superset-memory.md` (wave 3), all already implemented on this branch. Read those for the multi-root + memory foundation; this plan does not repeat them.


## Purpose / Big Picture

Two parts, in order.

**Part A — close the residual partials from waves 1–3.** Independent audits found waves 1–3 substantially complete, with two recurring/disclosed gaps and one cosmetic nit: (1) the **interactive end-to-end run was never actually executed** in any wave (only automated gates + a human handoff); (2) wave-3's **local memory MCP server and skill auto-regeneration are built and tested but not wired into the running host** — so an external CLI agent cannot *pull* memory from a live local server yet, and the generated `superset-memory` skill is committed but not auto-refreshed; (3) a stale docstring in `MemoryGraphView.tsx`. Part A finishes these so the foundation Part B relies on is genuinely live.

**Part B — Linear ticket → autonomous PR.** The capstone that wires waves 1–3 into a one-button workflow. A developer signs in, sees **their** Linear tickets, picks one, optionally adds context; an agent reads the ticket + the developer's input + the wave-3 memory layers and **builds a draft context**; the developer **approves it (the only human gate)**; then the agent runs **fully autonomously through to PR *creation* — and stops, never merging.** It creates the worktree(s) (one repo by default; if the change spans repos it **asks once**, then creates a worktree per repo), makes the changes, commits, pushes, and opens the PR(s) with an **agent-written description**, finally writing the PR link + status back to Linear.

Context precedence (most → least power): **developer-approved ticket context > project Coding Practice (wave-3) > global Coding Practice (wave-3)**. The assembled context has **no artificial token cap** — it is bounded only by the model's own context window; wave-3 memory is used to make the large context *relevant*, not to shrink it.

**Discipline carried forward:** reuse existing primitives wholesale (Linear sync, `workspaces.create({agents:[…]})`, the `dispatchAutomation` orchestration pattern, the `create-pr` skill, the multi-root group as the execution surface, wave-3 memory). No new git/clone plumbing. The ticket-scoped approved context is stored **host-side/local** (cloud schema stays frozen, consistent with wave-3 A7).


## Definitions (read this first; self-contained)

- **Linear integration (exists)**: org-scoped OAuth (`integration_connections` row holds tokens), two-way sync (initial-sync + webhook inbound; `sync-task` outbound). Linear issues land in the cloud `tasks` table with `externalProvider:"linear"`, `externalKey` ("SUPER-172"), title/description/assignee/url.
- **Task ↔ workspace link (exists)**: `v2_workspaces.taskId` → `tasks.id`; set at create or via `v2Workspace.setTask`.
- **`workspaces.create({agents:[…]})` (exists)**: the host one-shot that creates a worktree on a **new branch from a base** *and* launches a headless CLI agent with a prompt (`packages/host-service/src/trpc/router/workspaces/workspaces.ts`, new-branch path; `dispatchSugarAgents` → `agents.run`/`runAgentInWorkspace`). Prompt delivered argv or stdin (`buildAgentCommandString`).
- **`dispatchAutomation` (exists)**: the precedent orchestrator — stored prompt → resolve host → create workspace → launch agent → record a run row (`packages/trpc/src/router/automation/dispatch.ts`). Wave 4's orchestrator mirrors it, seeded by a *ticket*.
- **`create-pr` skill (exists)**: agent-driven PR — `git commit` → `git push -u` → `gh pr create --base … --title … --body …`, the agent **writing** the title/body from the diff. It **stops at PR open** (no merge). (`.agents/commands/pr/create-pr.md`, `.agents/commands/create-pr.md`.)
- **`PullRequestRuntimeManager` (exists)**: observes/links the opened PR by head ref to the workspace (`packages/host-service/src/runtime/pull-requests/`).
- **Coding Practice / Playbooks / Project Index / memory MCP (wave 3)**: the local memory layers + the `memory` tRPC `retrieve` + the local memory MCP server (`@superset/mcp/memory`). Project practice overrides global (existing user<project precedence).
- **Driver = the multi-root group (waves 1–3)**: the execution surface. Single root for a one-repo ticket; a multi-root group (worktree per repo) for a cross-repo ticket; the combined agent sees every root.
- **host-service / renderer / main**: as in waves 1–3. Renderer = browser (no Node); native pickers via Electron IPC; host owns paths/git/agents/PRs/memory.


## Assumptions

Part A:
- A1. The interactive GUI run needs a human (or a built e2e driver); an agent cannot drive dev sign-in / native pickers / a real agent launch headlessly. Part A treats *running-and-recording* it as the deliverable, and may build a minimal Playwright-electron smoke driver as an additive spike.
- A2. Wave-3's `generateMemorySkill` + `createHostMemoryMcpServer` are correct and tested; Part A only **wires** them into the running host (a transport binding + a regenerate trigger), changing no memory logic.

Part B (Linear ticket → autonomous PR):
- A3. **Exactly one human gate: context approval.** After approval the run is autonomous **through PR creation only — never merge.**
- A4. **One ticket = one repo by default.** If the approved context implies multiple repos, the agent **asks once** ("changes needed in X, Y, Z — proceed?"), then creates a **worktree per repo** and opens a **PR per repo**, all linked to the one ticket.
- A5. **No token cap on the assembled context** — bounded only by the model's context window; the agent pulls as much as it needs; wave-3 memory improves relevance, not size.
- A6. **Secrets are redacted** (reuse wave-3 `redactAll`) in the assembled prompt, the stored context, and the PR body.
- A7. **Context precedence:** developer-approved ticket context (authoritative) > project practice > global practice. Assembled most-powerful-last, explicitly marked authoritative.
- A8. **The approved ticket context is stored host-side/local** (a new table beside the wave-3 memory tables); **no cloud schema change** (carry wave-3's discipline). Showing tickets reuses the existing cloud `tasks` Electric collection read-only.
- A9. **Reuse, don't reinvent:** Linear sync, `synthesizeTaskPrompt`/`agent-prompt-template`, `workspaces.create({agents:[…]})`, the `dispatchAutomation` pattern, the `create-pr` skill, `PullRequestRuntimeManager`, the multi-root group, and wave-3 memory. No new git/clone code.
- A10. **The orchestrator runs host-side** (mirroring `dispatchAutomation`), so it works whether the trigger is the desktop UI or (later) a headless dispatch.


## Open Questions

None blocking — design decisions are in the Decision Log per the user's "no more questions; make assumptions" direction. Deferred-by-choice (org/cloud memory tier; a second pre-PR gate) are noted as future, not open questions.


## Progress

Part A — leftovers:
- [ ] A1 — Wire wave-3 B4a delivery into the running host: bind the local memory MCP server to a (loopback) transport so external CLI agents can pull; auto-regenerate `.agents/skills/superset-memory/SKILL.md` on memory change; fix the stale `MemoryGraphView` docstring.
- [ ] A2 — Execute + record the waves-1/2/3 interactive end-to-end (human handoff); optional additive Playwright-electron smoke driver.
- [ ] A3 (optional) — Group/folder terminal restart durability (respawnable, not only adoptable) — low priority; include only if cheap.

Part B — Linear ticket → autonomous PR:
- [ ] B1 — "Your Linear tickets" on login (assigned-to-me preset + landing).
- [ ] B2 — Ticket context builder (no cap) + ask-for-context prompt (optional/empty).
- [ ] B3 — The one gate: review/edit/approve UI + persist the ticket-scoped approved context (host-side, top precedence).
- [ ] B4 — Repo scoping + multi-repo confirm (default single; ask once if multi; assemble the multi-root group).
- [ ] B5 — The ticket→PR orchestrator: assemble layered prompt → `workspaces.create({agents:[…]})` per repo → agent edits/commits/pushes/opens PR → STOP at PR open, NEVER merge; run row for status/error.
- [ ] B6 — Close the loop: link PR↔workspace, write `prUrl` + move Linear status; multi-repo links all PRs to the one ticket.
- [ ] B7 (optional) — `mcpScope` forwarding so the autonomous agent has Superset MCP tools (update ticket / query memory).

Timestamp each item when checked off; split partials into done/remaining.


## Surprises & Discoveries

- Observation: the whole ticket→PR execution spine already exists — wave 4 is orchestration, not new git plumbing.
  Evidence: `workspaces.create({agents:[…]})` already does ticket→worktree(new branch from base)→headless agent in one call; `dispatchAutomation` already sequences create+launch+run-row; the `create-pr` skill already commits/pushes/opens-PR with an agent-written body and stops at open; `PullRequestRuntimeManager` already links the opened PR.

(Add observations as work proceeds.)


## Decision Log

- Decision: Wave 4 closes the waves-1/2/3 partials (Part A) and then builds Linear ticket → autonomous PR (Part B), on this branch.
  Rationale: User-directed; the foundation (multi-root + memory) must be genuinely live before layering the ticket pipeline.
  Date/Author: 2026-06-23, planning session.

- Decision: Exactly one human gate (context approval); after it, autonomous **to PR creation only — never merge**.
  Rationale: User decision. Hard stop at PR open; the `create-pr` skill already stops there, and no merge step is ever invoked.
  Date/Author: 2026-06-23, planning session.

- Decision: One ticket = one repo by default; if the approved context spans repos, **ask once**, then worktree-per-repo + PR-per-repo, all linked to the one ticket.
  Rationale: User decision.
  Date/Author: 2026-06-23, planning session.

- Decision: No artificial token cap on the assembled context; the model's context window is the only bound; memory improves relevance, not size.
  Rationale: User decision — favor autonomous completeness over token thrift.
  Date/Author: 2026-06-23, planning session.

- Decision: Context precedence = developer-approved ticket context > project practice > global practice; approved context stored host-side/local (no cloud schema change).
  Rationale: User decision + carry wave-3's local-only discipline (A7/A8).
  Date/Author: 2026-06-23, planning session.

- Decision: Reuse the existing Linear sync, worktree+agent launch, `dispatchAutomation` pattern, `create-pr` skill, PR runtime, multi-root group, and wave-3 memory; write no new git/clone code.
  Rationale: Audits confirm the spine exists; wave 4 is the glue.
  Date/Author: 2026-06-23, planning session.


## Context and Orientation

Affected: `apps/desktop` (renderer), `packages/host-service`, and a thin read of the cloud `tasks`/Linear surface (no cloud schema change). Untouched: `packages/panes`, `packages/workspace-fs`, the cloud schema (`packages/db`/`packages/trpc`).

Part-A anchors:
- B4a wiring: `packages/host-service/src/runtime/memory/push-generator.ts` (`generateMemorySkill`), `.../runtime/memory/mcp-provider.ts` (`createHostMemoryMcpServer`, `HostMemoryDataProvider`), `packages/mcp/src/memory/server.ts` (`createMemoryMcpServer`), the committed `.agents/skills/superset-memory/SKILL.md`, and `packages/host-service/src/app.ts` (where services are constructed/started — the missing caller).
- Stale docstring: `apps/desktop/.../MemoryPane/components/.../MemoryGraphView.tsx` (says it imports the force layout from `@superset/memory`; it uses the renderer-local copy).
- Interactive acceptance script: the "Validation and Acceptance" sections of waves 1–3.

Part-B anchors (all present):
- Linear + tasks: `apps/api/src/app/api/integrations/linear/*`, cloud `tasks` schema + `task.list` (`assigneeMe`), the desktop `tasks/TasksView` + `useTasksData` + `AssigneeFilter`, `integration_connections`.
- Ticket → prompt + workspace: `RunInWorkspacePopoverV2` (`synthesizeTaskPrompt`, `submit({agents:[…]})`), `deriveBranchName`, `packages/shared/src/agent-prompt-template.ts`, `v2Workspace.create`/`setTask`.
- Execution: host `workspaces.create` (new-branch-from-base + `agents[]`), `agents.run`/`runAgentInWorkspace`, the `dispatchAutomation` orchestrator (`automation/dispatch.ts`), `automation_runs` (run-row shape to mirror).
- PR: `.agents/commands/pr/create-pr.md` + `.agents/commands/create-pr.md` (agent-written body, stops at open), `PullRequestRuntimeManager`.
- Memory context: the `memory` tRPC `retrieve` + the local memory MCP server (wired live by Part A), project/global practice docs.


## Plan of Work

Part A (A1–A3) first, then Part B (B1–B7). Across both: Bun only; object-param signatures; no `any`/`@ts-ignore`/empty catch; **renderer must not import Node modules** (`bun run lint:check-node-imports`); run `bun run lint:fix` and ensure `bun run lint` exits 0 before any commit; keep this plan's living sections updated.


### Part A — finish the waves-1/2/3 leftovers

#### A1 — Wire wave-3 memory delivery into the running host
Scope: make the local memory **pull** path live and keep the pushed skill fresh.
Plan: in `packages/host-service/src/app.ts`, (a) construct `createHostMemoryMcpServer(HostMemoryDataProvider(db))` and bind it to a **loopback** transport so external CLI agents (Claude Code, Codex) can connect to `memory_search`/`memory_get_playbook`/`memory_get_practice`; (b) call `generateMemorySkill` on startup and on memory mutations (capture/consolidate) so `.agents/skills/superset-memory/SKILL.md` stays current (idempotent write); (c) fix the stale `MemoryGraphView` docstring. No memory *logic* changes.
Acceptance:

    bun dev
    # An external CLI agent can reach the local memory MCP server (loopback) and call memory_search.
    # After a capture/consolidation, SKILL.md reflects the change.
    bun run typecheck && bun run lint && bun test packages/host-service

#### A2 — Run + record the interactive end-to-end
Scope: actually exercise waves 1–3 in the running app and record it (never done in any wave).
Plan: a human (or a driver) runs the combined acceptance — multi-root compose two repos + worktrees, edit across them incl. a folder root, live refresh, combined agent + clickable paths, content-search line focus, memory capture at PR time, retrieval + consolidation buttons, the graph — and records pass/fail per step in **Outcomes & Retrospective**. Optional additive spike: a minimal Playwright-electron smoke driver (no production code change) for repeatability.
Acceptance: Outcomes records the run with pass/fail per step; failures filed as follow-ups.

#### A3 (optional) — Group/folder terminal restart durability
Scope: make workspace-less group/folder terminals respawnable after a host restart (today adoptable only).
Plan: persist enough cwd/env to respawn; only if cheap and low-risk.
Acceptance: after a host restart, a group/folder terminal can be respawned, not just adopted.


### Part B — Linear ticket → autonomous PR

#### B1 — "Your Linear tickets" on login
Scope: surface the developer's assigned Linear tickets right after sign-in.
Plan: add an "assigned to me" preset to the desktop `TasksView` (`tasks.assigneeId === session.user.id`, with an email fallback for unmatched Linear assignees that live in `assigneeExternal*`) + a post-login landing into it. Reuses the org-scoped `tasks` Electric collection and `task.list`'s existing `assigneeMe`.
Acceptance:

    bun dev
    # After sign-in (Linear connected), a "My tickets" view lists tickets assigned to me.

#### B2 — Ticket context builder (no cap) + ask-for-context
Scope: turn a ticket into a rich, model-built draft context.
Plan: a prompt "Add any context for this ticket? (optional)" (may be empty); then a context-builder agent step that expands the ticket (title/description) + the developer input + wave-3 memory (project index + top Playbooks via the now-live `memory` retrieve / MCP) into a **full draft context** — **no token cap**; the model pulls as much as it needs. Redact secrets (`redactAll`). Reuses `agent-prompt-template.ts` primitives.
Acceptance:

    bun dev
    # Pick a ticket, (optionally) add context -> a draft context is generated, pulling relevant memory, redacted.

#### B3 — The one gate: review/approve + persist
Scope: the single human checkpoint.
Plan: show the draft context in the task detail panel (the `MarkdownEditor` already mounts there); let the developer **edit / change / approve**. Persist the approved context **host-side** in a new local table beside the wave-3 memory tables (cloud schema frozen), keyed by `(projectId, taskId)`. This becomes the **top-precedence** context layer.
Acceptance:

    bun dev
    # Edit + approve the context -> it's saved; reopening the ticket shows the approved context.

#### B4 — Repo scoping + multi-repo confirm
Scope: decide which repo(s) the run touches.
Plan: default to the ticket's one repo (one worktree, one PR). If the approved context implies multiple repos, surface the set and get **one confirm**; on yes, assemble a multi-root group with a worktree per repo (reuse wave-2/3 create-worktree-in-group + import/promote), so the combined agent coordinates across them.
Acceptance:

    bun dev
    # Single-repo ticket -> one repo selected. Multi-repo context -> one confirm -> a group with a worktree per repo.

#### B5 — The ticket→PR orchestrator (stop at PR open)
Scope: the autonomous run.
Plan: a host-side orchestrator modeled on `dispatchAutomation`: assemble the **layered prompt** (developer-approved ticket context > project practice > global practice; no cap; redacted; ending with "commit, push, run `/pr/create-pr`, then stop"), resolve project + host, and per repo call `workspaces.create({ projectId, baseBranch, taskId, agents:[{ agent:"claude", prompt }] })` (worktree new-branch-from-base + headless launch). The agent edits → commits → pushes → opens the PR with an agent-written body. **Hard stop at PR creation — never invoke merge.** Record a run row (status/error, modeled on `automation_runs`).
Acceptance:

    bun dev
    # Approve a context -> the agent autonomously creates the worktree(s), changes, commits, pushes, and OPENS a PR
    # per repo with an agent-written description, then STOPS. No merge occurs. The run row shows success/error.

#### B6 — Close the loop
Scope: reflect the result back on the ticket.
Plan: when `PullRequestRuntimeManager` detects the PR, write `prUrl` back to the task and move the Linear status (→ in-review) via the existing Superset→Linear `sync-task`; for multi-repo, link **all** PRs to the one ticket (shared ticket key in branch name + PR body + writeback).
Acceptance:

    bun dev
    # After the PR opens, the ticket shows the PR link and moves to in-review; multi-repo links all PRs to the ticket.

#### B7 (optional) — `mcpScope` forwarding
Scope: give the autonomous agent Superset MCP tools.
Plan: thread `mcpScope` into the `agents.run`/`workspaces.create` relay (declared on automations today but not forwarded in dispatch) so the agent can update ticket status / query memory mid-run.
Acceptance: the autonomous agent can call the scoped Superset MCP tools during the run.


## Concrete Steps (quick reference)

From repo root `/home/user/superset-vWorkspace` unless noted:

    bun install
    bun run typecheck                 # after each milestone
    bun run lint:fix && bun run lint  # lint MUST exit 0
    bun run lint:check-node-imports   # renderer must not import Node modules
    bun test
    bun dev

If B3/B5 add a host table (approved context / run rows) — change `packages/host-service/src/db/schema.ts` then `cd packages/host-service && bunx drizzle-kit generate --name="ticket_context"` (never hand-edit migrations).


## Validation and Acceptance

Part A: the live memory MCP pull path works from an external agent + a fresh SKILL.md (A1); and the waves-1/2/3 interactive run is recorded with pass/fail per step (A2).

Part B end-to-end: sign in → "My tickets" → pick one → (optionally) add context → a no-cap draft context is built from ticket + memory, redacted → **edit + approve (the only gate)** → (if multi-repo, one confirm) → the agent autonomously creates worktree(s), makes changes, commits, pushes, and **opens a PR per repo with an agent-written body, then stops — no merge** → the ticket shows the PR link(s) and moves to in-review. Verify the assembled prompt orders context as developer-approved > project > global, and that **no merge** is ever invoked.

Standing gates every milestone: `bun run typecheck` (no errors), `bun run lint` (exit 0), `bun test` (all pass), `bun run lint:check-node-imports` (renderer clean).


## Idempotence and Recovery

- A1 is a wiring change; binding the MCP server + regenerating an idempotent SKILL.md is safe to repeat.
- B5's per-repo `workspaces.create` reuses the existing idempotent worktree path; a failed `addRoot`/launch leaves a recoverable worktree. The run row records partial state (e.g. repo 2 failed after repo 1's PR) rather than failing silently.
- **"Never merge" is a hard guardrail**: the orchestrator never calls a merge tool and the prompt forbids it; the `create-pr` skill stops at PR open by design.
- Any new host table (B3/B5) uses a drizzle-generated migration (forward-only; fix schema + regenerate if the diff is wrong; never edit historical migrations). The approved context is local/host-side; deleting it is safe (the developer re-approves).


## Interfaces and Dependencies

No cloud schema change; no new heavyweight dependencies. Reuse: Linear sync + cloud `tasks`/`task.list`; `RunInWorkspacePopoverV2`/`synthesizeTaskPrompt`/`agent-prompt-template`; host `workspaces.create({agents:[…]})` + `agents.run`; the `dispatchAutomation` pattern + `automation_runs` shape; the `create-pr` skill + `PullRequestRuntimeManager`; the multi-root group; wave-3 memory (`retrieve` + the now-live memory MCP server + practice docs). New: a host-side ticket→PR **orchestrator**, a local **approved-ticket-context** store (+ table), the **"my tickets"** view, the **context build + approve** UI, and the **writeback** step.


## Outcomes & Retrospective

To be filled in at completion. Compare against the Purpose: the memory pull path is live and the interactive run recorded (Part A); and a developer can go from a Linear ticket to an open PR with a single approval gate — autonomous to PR creation, never merging — with one-repo-default / ask-then-fan-out for multi-repo, a no-cap context ordered developer > project > global, redacted throughout, and the PR(s) written back to the ticket.


## Future (explicitly out of scope this wave)
- **Org/cloud memory tier** (wave-3 B-future): org-scoped shared practice/playbooks. Still deferred.
- **A second pre-PR review gate** (today there is exactly one gate, at context approval).
- **Auto-merge / merge-queue handoff** — deliberately excluded; the flow stops at PR creation.


---

### Revision note

- 2026-06-23 14:30Z — Initial wave-4 draft. Part A closes the audited waves-1/2/3 partials (wire the wave-3 memory MCP server + skill auto-regeneration into the running host; fix the stale `MemoryGraphView` docstring; run + record the interactive E2E; optional terminal restart durability). Part B specifies Linear ticket → autonomous PR, encoding the user's decisions: one gate (context approval) then autonomous **to PR creation, never merge**; one-repo default with an **ask-once** multi-repo fan-out (worktree-per-repo, PR-per-repo, linked to the ticket); **no token cap** on the assembled context; precedence developer-approved > project > global; secrets redacted; approved context stored host-side/local (no cloud schema change). Reuses Linear sync, `workspaces.create({agents:[…]})`, the `dispatchAutomation` pattern, the `create-pr` skill, the PR runtime, the multi-root group, and wave-3 memory. Assumptions A1–A10 listed; no open questions per user direction.
