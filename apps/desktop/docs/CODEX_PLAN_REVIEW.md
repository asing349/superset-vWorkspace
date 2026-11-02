# Codex account and independent ticket-plan review

The existing local Superset IDE remains the common surface for agents and worktrees. The new gate applies to **ticket-to-PR runs** from both the task detail page and the local Linear ticket panel. Other terminal sessions and manual agent launches retain their existing behavior.

## Connect a ChatGPT account

1. Open Settings → Integrations → **Codex · ChatGPT account**.
2. Click **Connect ChatGPT to Codex** and complete the sign-in in your browser.
3. The card polls the official Codex app-server account state. Opening the browser is not treated as successful sign-in. Cancel sign-in or Refresh status as needed.

A current local Codex installation is required. Superset checks `SUPERSET_CODEX_EXECUTABLE` (an optional absolute executable path), the host's preserved login-shell PATH and process PATH, then installed ChatGPT/Codex macOS app bundles in system/user Applications folders (including the enclosing app bundle when applicable). The connector, planner/reviewer and default Codex coding-agent launcher share this resolution; explicit custom agent commands are preserved. Other platforms use PATH or the explicit native executable override. Superset does not install anything or modify PATH persistently. The connector uses the documented `codex app-server` stdio protocol (`initialize`, `account/read`, `account/login/start`, cancel and logout). Codex owns the browser callback and credential storage; the renderer receives account metadata, never tokens or passwords.

The account is shared with the native Codex CLI. Disconnecting it also signs that CLI out, after a confirmation. It does not change the separate Mastracode/OpenAI model login under Settings → Models.

**ChatGPT sign-in** uses the account's Codex subscription access and limits. An existing **API key** is labeled separately as usage-based access; it is not a ChatGPT subscription login. No account connection was made while implementing this feature.

Official references:
- https://learn.chatgpt.com/docs/auth
- https://learn.chatgpt.com/docs/app-server

## Plan, review, execute

1. Select the primary and optional additional repositories and approve the ticket context using the existing context editor.
2. Choose Codex or Claude Code as the execution agent. Each CLI uses its own existing account. Planning/review currently use the connected Codex CLI and its configured model.
3. Click **Prepare and review plan**. A fresh Codex session proposes the plan. A separate process and fresh session reviews it. The model receives the same ticket, repo set and coding practices. Shell access for these turns is read-only and restricted to selected repository roots plus platform defaults; configured external apps/MCP servers and hooks are disabled for the analysis thread. Interactive tool/permission requests are not approved.
4. Read the proposed plan and reviewer feedback. Routine plans can receive agent approval. Fixable issues return for revision. Ambiguity, unavailable providers, malformed replies and timeouts leave execution blocked. After three unresolved reviews, discuss the feedback with Ajit and prepare a new plan. No human-approval bypass is added.
5. Editing a plan requires review again. Changing context, repository contents/refs, coding practices, repo selection or execution agent invalidates approval. The host checks this again before launching anything.
6. **Start reviewed run** consumes approval once and dispatches the selected agent into one worktree per repo using the existing pipeline. The reviewed plan is included in the execution prompt. The pipeline's stop-at-PR and never-merge instruction remains in place; no merge API is added to this flow.

The launcher reports dispatched, failed and pending results per repository, including errors and diagnostic IDs. Dispatch does not confirm agent completion or PR creation. If a request fails after dispatch may have begun, inspect workspaces before retrying; another attempt needs a new plan approval.

Plans, reviewer feedback and session IDs are stored as local JSON artifacts in `ticket-plans/` next to the host database. Writes use an atomic replace with private file permissions. No cloud schema or migration changes are needed. The UI retains the current attempt while mounted; stored artifacts are also readable through `ticketPlan.get`.

## Validation boundary

Unit tests use fake RPC transports, fake model replies, in-memory SQLite and temporary files. They do not start Codex, authenticate, call a model, contact Linear, create worktrees or open PRs. Live OAuth/browser acceptance and the multi-repository Linear trial remain pending user-led verification.
