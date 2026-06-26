# Wave 7 — Host-side Linear via one-button PKCE (cloud-precedence, local fallback)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Reference: This plan follows the conventions in `AGENTS.md` (repo root) and mirrors the structure of the wave-1…6 ExecPlans on branch `claude/keen-euler-e9b3x8`. It builds directly on **wave-4** (Linear ticket → autonomous PR) and reuses the desktop's existing **host-side Anthropic OAuth** pattern (`host.auth.*`) and the host **GitHub credential** pattern (`providers.credentials.getToken("github.com")`). Read the wave-4 plan (`plans/20260623-1430-wave4-leftovers-and-linear-ticket-to-pr.md`) for the ticket→PR foundation; this plan does not repeat it.


## Purpose / Big Picture

Today Linear is **cloud-only**: a connection is an org-scoped OAuth handled by `apps/api`, with tokens in cloud Postgres, sync driven by inbound webhooks + QStash into the cloud `tasks` table, streamed to the desktop via Electric. That is great for teams but means: (a) it cannot be used at all in the local-Docker dev mode (which ships fake `LINEAR_CLIENT_ID/SECRET`), and (b) there is no way to connect Linear "just for my machine" without standing up the cloud OAuth app.

Wave 7 adds a **second, host-side Linear connection** that serves as a **fallback under cloud-precedence**, and makes everything downstream **source-agnostic**:

- **One-button local connect (PKCE)** — a "Connect Linear (this Mac)" button that runs a host-side **PKCE** OAuth (Linear supports PKCE; the client secret is optional), stores the token **locally** (encrypted / keychain), and needs **no cloud backend and no client secret**. Mirrors the desktop's existing host-side Anthropic OAuth.
- **Cloud takes precedence; local is the fallback** — the local connection can be established **only when no cloud Linear connection is active** (v1 mutual-exclusivity rule). When a cloud connection exists, it is authoritative and the local connect affordance is disabled with an explainer ("disconnect cloud Linear to connect this Mac"). A stored local connection stays dormant while cloud is active; it is never simultaneously active with cloud.
- **Cloud connect unchanged** — the existing org OAuth integration stays exactly as-is (additive change; `apps/api` Linear routes + `integration_connections` + cloud `tasks` are untouched).
- **A source-agnostic ticket layer** — a host service that resolves **the single active source** (cloud `tasks` via the existing cloud API client when cloud is connected, else the local Linear store), composed **at read time** (no persisted copy), tagging each ticket with its `source`. The desktop ticket list and the **wave-4 ticket→PR pipeline** both read this layer, so neither cares which source is active.
- **Writeback to the active source** — status/comment writeback goes to whichever source is active: cloud → `ctx.api.task.update`; local → the Linear API directly. Because cloud always takes precedence, cloud is authoritative whenever connected.

The differentiator vs. wave-4: Linear becomes usable **with zero cloud setup** (including in local dev), as an explicit, per-machine, one-button connection — without disturbing the team-grade cloud integration, which always wins when present.

**Discipline (carried from prior waves):** local storage is **host-side/local** (new host SQLite tables, drizzle-generated; **no cloud schema change**); the connection is an **explicit, opt-in, one-button user action — never auto-connect**; **tokens are never logged or stored in plaintext** (encrypted via `SECRETS_ENCRYPTION_KEY` / OS keychain); the renderer stays **browser-only** (no Node imports). The cloud path is **reused, not modified**.


## Definitions (read this first; self-contained)

- **Cloud Linear connection (existing)**: org-scoped OAuth via `apps/api/src/app/api/integrations/linear/{connect,callback,webhook,jobs}`; tokens in `integration_connections` (cloud Postgres, unique `(organizationId, provider)`); issues land in the cloud `tasks` table with `externalProvider:"linear"`, `externalKey` (e.g. `ENG-123`); refresh via a QStash cron; helpers in `packages/trpc/src/router/integration/linear/{linear,utils,refresh}.ts`.
- **Local Linear connection (new, wave 7)**: a per-machine **PKCE** OAuth run entirely host-side; access + refresh tokens stored **locally** (encrypted SQLite column and/or OS keychain via the host credential layer); reads/writes go **directly** to the Linear API with `@linear/sdk`. **Connectable only when cloud is disconnected** (cloud-precedence).
- **Cloud-precedence (v1 rule)**: at most one Linear source is active at a time; **cloud wins**. While a cloud connection is active, the active source is cloud and the local connect button is disabled. A stored local token remains but dormant. (Relaxing this to true simultaneous coexistence is a Future item.)
- **PKCE (Proof Key for Code Exchange)**: confirmed supported by Linear — the `/authorize` request carries `code_challenge`+`code_challenge_method=S256`, the `/token` exchange carries `code_verifier`, and **`client_secret` is optional** (for both exchange and refresh). This is what lets a public desktop client connect without a server-held secret.
- **Public `client_id`**: PKCE still needs a registered OAuth **application** to obtain a `client_id` and allowed redirect URIs — but the `client_id` is **not** a secret and can be bundled in the build. Production ships a Superset desktop public client; from-source dev supplies its own via `LINEAR_DESKTOP_CLIENT_ID` (no secret).
- **Source-agnostic ticket layer (new)**: a host service exposing one `tickets.*` surface that resolves the active source at read time, tags each ticket with `source:"cloud"|"local"`, and routes writeback to that source. Under cloud-precedence it surfaces exactly one source at a time (no cross-source merge in v1).
- **Wave-4 ticket→PR pipeline (reuse)**: `packages/host-service/src/trpc/router/ticket-run/ticket-run.ts` (keys on a "Cloud task id (Linear-synced `tasks.id`)"), `runtime/ticket-runs/{dispatch,pr-loop-reconciler}.ts`, `ticket-context/ticket-context.ts`; reads tickets via the cloud API client `createApiClient(config.cloudApiUrl, …)` (`app.ts:101`) and writes status back via `ctx.api.task.update`.
- **host-service / renderer / main**: as in waves 1–6. Renderer = browser (no Node); host owns git/PRs/memory/agents and (wave 7) the local Linear connection + poller + store.


## Assumptions

- A1. **Linear supports PKCE with `client_secret` optional** (verified against Linear's OAuth 2.0 docs). The local path therefore needs only a **public `client_id`** + a registered redirect URI — no secret in the desktop build.
- A2. **The desktop can capture the OAuth redirect host-side** via either a transient **loopback HTTP listener** (`http://127.0.0.1:<port>/callback`, the `gh`-style approach) or a registered **custom protocol** (`superset://…`). The repo already manipulates a dev protocol (`apps/desktop/scripts/patch-dev-protocol.ts`), so a custom-scheme path likely exists. The exact mechanism is decided during M1 (OQ1, deferred).
- A3. **The cloud path is reused unchanged and this wave is purely additive** — no edits to `apps/api` Linear routes, the `integration_connections` table, the cloud `tasks` schema, or `packages/db`/`packages/trpc` cloud schema. The cloud Linear router/helpers may be **read/ported** but not modified.
- A4. **`@linear/sdk` works host-side** with an access token (`new LinearClient({ accessToken })`) for the operations used (viewer/org, `teams()`, issue queries, issue update + comment). It is already a dependency of `packages/trpc`/`apps/api`.
- A5. **All wave-7 local storage is host-side SQLite**, drizzle-generated, keyed by stable Linear ids; **tokens are encrypted** (`SECRETS_ENCRYPTION_KEY` / OS keychain) and **never logged or returned in plaintext**. No cloud schema change.
- A6. **Cloud connection status is readable host-side** (via the cloud API client / the integration's connection query) so the local connect can be gated on cloud being disconnected, and the active source resolved.
- A7. **The wave-4 orchestrator can be parameterized to read from the source-agnostic ticket layer** while preserving its existing id contract, so a ticket→PR run works against whichever source is active.
- A8. **No inbound webhooks host-side.** The local connection stays current via **polling on an interval + a manual Refresh**; the instant-push latency tradeoff is accepted (see Decision Log).


## Open Questions

- OQ1. **Redirect capture mechanism** — transient loopback HTTP listener vs. registered `superset://` custom scheme. **Deferred to M1 implementation** (per direction): verify what the desktop already supports (`patch-dev-protocol.ts`, Electron `setAsDefaultProtocolClient`) and pick the lower-surface option. Does not block design.

(All other open questions from the initial draft are now resolved — see Decision Log.)


## Progress

- [x] M1 — Host-side PKCE connect + local encrypted token store — **done 2026-06-26T08:54Z**: `linear.auth.*` host router (`getConnection`/`startConnect`/`consumeCallback`/`completeConnect`/`cancelConnect`/`disconnect`/`refresh`) running **PKCE** OAuth (no secret), tokens stored host-local **encrypted** (AES-256-GCM, machine-derived key) in the new `linear_local_auth` SQLite table (migration **0015**); one-button "Connect Linear (this Mac)" + local status in Settings → Integrations, **gated on cloud being disconnected** (cloud-precedence, both server-side gate + disabled button w/ explainer); redirect mechanism chosen (OQ1 → **loopback HTTP listener**). Gates green: typecheck 29/29, `bun run lint` exit 0, `bun test packages/host-service` 1018 pass / 0 fail (16 new). **Note for M2:** the next migration is **0016** (M1 took 0015); `linear_tickets` should be generated as 0016, not 0015 as originally written.
- [ ] M2 — Local ticket fetch + host store + stream: host runtime poller (`@linear/sdk`) → new `linear_tickets` host SQLite table → tRPC query/subscription to the renderer; interval poll + manual Refresh; team picker (reuse `getTeams`).
- [ ] M3 — Source-agnostic ticket layer: host `tickets.*` that resolves the active source (**cloud if connected, else local**) at read time, tags `source`, routes writeback to the active source; renderer ticket list reads it with a source badge.
- [ ] M4 — Wave-4 ticket→PR on the active source: orchestrator reads the source-agnostic layer; status/comment writeback dispatched to the active source (cloud `ctx.api.task.update` / local Linear API).
- [ ] M5 — Coexistence/precedence polish: independent status for both connection types; local connect disabled-with-explainer while cloud active; per-source team filters; disconnect purges the local token; refresh/expiry handling; from-source dev `LINEAR_DESKTOP_CLIENT_ID`; docs.

Timestamp each item when checked off; split partials into done/remaining.


## Surprises & Discoveries

- Observation: connecting was never the hard part — it is one button either way; the only real work is owning the **sync** host-side.
  Evidence: the cloud "Connect Linear" button already exists and works when real `LINEAR_CLIENT_ID/SECRET` are present; it is dead in local dev only because `.env.local.example` ships fake values. The desktop already performs host-side browser OAuth + local token storage for Anthropic (`host.auth.*`), so the local connect is a mirror of an existing pattern.

- Observation: PKCE removes the client-secret blocker entirely for the local path.
  Evidence: Linear's OAuth docs state `client_secret` is **optional** when `code_challenge`/`code_verifier` are used (token exchange and refresh). So a public desktop client can connect with no server secret and no cloud broker.

- Observation: choosing **cloud-precedence (mutual exclusivity)** removes the hardest part of the original design.
  Evidence: with at most one active source, the unified layer never has to merge/dedupe two Linear feeds or arbitrate writeback authority — it just resolves the single active source. Cross-source merge becomes a Future-only concern.

- Observation: GitHub "just worked" locally because of the `gh` CLI's bundled OAuth app; Linear has no CLI equivalent, which is why it needs a registered OAuth app at all.
  Evidence: host GitHub Octokit reads `providers.credentials.getToken("github.com")` (i.e. the `gh auth login` token); there is no analogous Linear CLI, so a `client_id` must be provisioned (public, secret-free for the local PKCE path).

- Observation (M1): the host-side **OpenAI** OAuth loopback is a closer/better precedent than the Anthropic one for the local Linear connect.
  Evidence: `packages/chat/.../openai-oauth-loopback.ts` already implements exactly the loopback-capture + renderer-poll (`consumeOpenAIOAuthCallback`) + `complete*` shape we needed, including the manual-paste fallback. M1's `LinearAuthService` mirrors it (host returns the authorize URL, renderer opens it via `electronTrpcClient.external.openUrl`, polls `consumeCallback`, calls `completeConnect`).

- Observation (M1): `@linear/sdk` is **not** a `packages/host-service` dependency (it's only in `packages/trpc`/`apps/api`).
  Evidence: M1 therefore fetches viewer/workspace for the status card via a direct `https://api.linear.app/graphql` POST (fully injectable/mockable, best-effort) rather than the SDK. **M2 must add `@linear/sdk` to `packages/host-service/package.json`** before using `new LinearClient({ accessToken })` for the poller.

- Observation (M1): the precedence gate must treat an **unreachable cloud as "not connected"**, or local connect could never work in local-only dev (the primary use case).
  Evidence: `isCloudLinearConnected` calls the cloud `integration.linear.getConnection` via `ctx.api`; in local dev that throws/unauthorized, so the helper catches and returns `false`. A cloud connection counts as active only when the query returns a non-null row with `needsReconnect === false`.

- Observation (M1): host SQLite drizzle is **synchronous** (`.get()`/`.all()`/`.run()`), and host-service tests build the db with `bun:sqlite` + `drizzle-orm/bun-sqlite` (prod uses `better-sqlite3`). The new store/tests follow that.

(Add observations as work proceeds.)


## Decision Log

- Decision: Add a **host-side local Linear connection** as a **fallback under cloud-precedence**; do not replace the cloud integration.
  Rationale: User-directed; additive keeps team-grade cloud sync intact while unlocking zero-cloud local use (including local dev). Date/Author: 2026-06-26, planning session.

- Decision: **Cloud-precedence / mutual exclusivity (v1)** — the local connection is connectable **only when cloud is disconnected**; cloud is authoritative whenever active; a stored local token stays dormant while cloud is connected.
  Rationale: User direction ("only allow connect to local if cloud is disconnected"); also collapses the merge/dedupe/writeback-authority complexity. Marked v1 and reversible — true simultaneous coexistence is a Future item. Date/Author: 2026-06-26.

- Decision: The local connect uses **PKCE (no client secret)**; production ships a public desktop `client_id`, from-source dev supplies `LINEAR_DESKTOP_CLIENT_ID`.
  Rationale: Linear supports PKCE with optional secret; a public client needs no server broker (resolves OQ2 — "whatever," team-lead's call). Date/Author: 2026-06-26.

- Decision: **Read-time composition** in the host ticket layer; the local poller does **not** write into the cloud `tasks` table.
  Rationale: User answer (OQ4 "read time merge"); writing local data into cloud Postgres would couple "local" to the cloud and break the no-cloud goal. Under cloud-precedence the "merge" is a single-source resolution. Date/Author: 2026-06-26.

- Decision: **Writeback goes to the active source; cloud wins** (OQ3 "cloud"). Because cloud-precedence means cloud is the sole active source when present, this is automatically satisfied.
  Rationale: User answer; avoids double-writes; cloud is the shared/team source of truth. Date/Author: 2026-06-26.

- Decision: **PAT (paste-an-API-key) fallback is deferred** (OQ5 "deferred").
  Rationale: User direction; keeps v1 scope to the one-button PKCE flow. Moved to Future. Date/Author: 2026-06-26.

- Decision: **Redirect capture mechanism deferred to M1 implementation** (OQ1 "later").
  Rationale: User direction; decided when wiring the connect flow after verifying the desktop's existing protocol support. Date/Author: 2026-06-26.

- Decision (OQ1, RESOLVED in M1): **Transient loopback HTTP listener** (`http://127.0.0.1:<port>/callback`) over a registered `superset://` custom scheme.
  Rationale: The desktop already runs a host-side loopback HTTP listener for the **OpenAI** OAuth PKCE flow (`packages/chat/.../openai-oauth-loopback.ts`), and the host-service is a Node process that binds 127.0.0.1 — so the loopback is the lower-surface, already-proven mechanism. A custom scheme would require Electron `setAsDefaultProtocolClient` registration in the main process (packaging-specific); `apps/desktop/scripts/patch-dev-protocol.ts` only patches a dev deep-link protocol, not OAuth capture. The host `LinearAuthService` arms a one-shot listener (`HttpLinearOAuthLoopback`) on `startConnect`, stashes the captured `{ code, state }` (state-validated), and the renderer polls `linear.auth.consumeCallback` then calls `completeConnect` — mirroring the OpenAI flow exactly. Manual-paste fallback if the port can't bind. The loopback port defaults to **52718** and is overridable via `LINEAR_DESKTOP_REDIRECT_PORT`; the redirect URI must be a registered redirect on the public Linear OAuth app. Date/Author: 2026-06-26, M1 implementation.

- Decision: **Polling, not inbound webhooks**, for the local connection.
  Rationale: A local machine has no public URL to receive Linear webhooks; a 30–60s poll + manual Refresh is adequate for the ticket→PR use case. Date/Author: 2026-06-26.

- Decision: **No cloud schema change; cloud Linear routes/tables untouched.** New host SQLite tables only.
  Rationale: Carry the prior-wave discipline; keep egress/cost/risk controlled and the change additive. Date/Author: 2026-06-26.


## Context and Orientation

Affected: `apps/desktop` (renderer — Settings → Integrations connect UI + the ticket list) and `packages/host-service` (new `linear` router + runtime poller + local store + token storage + the source-agnostic `tickets` layer + wave-4 orchestrator source-swap). Untouched: `apps/api` Linear routes, `packages/db`/`packages/trpc` cloud schema, the `integration_connections` and cloud `tasks` tables (read/reused only), `packages/panes`, `packages/workspace-fs`.

Reuse anchors (all present on this branch):
- **Host OAuth + local-credential precedents**: the host-side Anthropic OAuth flow `host.auth.*` (start/complete/cancel/disconnect) and `packages/host-service/src/providers/host-auth/`; the GitHub credential factory `providers.credentials.getToken("github.com")` (`packages/host-service/src/app.ts:104-114`); OS-keychain reads in `packages/host-service/src/providers/model-providers/LocalModelProvider/utils/resolveAnthropicCredential.ts`; `SECRETS_ENCRYPTION_KEY` for encrypted-at-rest local secrets.
- **Linear HTTP/SDK helpers to port (adapt to PKCE + local token)**: `packages/trpc/src/router/integration/linear/{utils,refresh,linear}.ts` (token exchange/refresh, `callLinear`, `getTeams`, `getConnection`/`disconnect`/team-picker) and the OAuth flow shape in `apps/api/src/app/api/integrations/linear/{connect,callback}/route.ts`.
- **Cloud connection status (for the precedence gate)**: the cloud Linear `getConnection` query (`packages/trpc/src/router/integration/linear/linear.ts`) reachable via the host cloud API client (`createApiClient`, `app.ts:101`).
- **Wave-4 ticket→PR pipeline (parameterize to the source-agnostic layer)**: `packages/host-service/src/trpc/router/ticket-run/ticket-run.ts`, `runtime/ticket-runs/{dispatch,pr-loop-reconciler}.ts`, `ticket-context/ticket-context.ts`.
- **Cloud tasks shape + identity key**: `packages/db/src/schema/schema.ts` (`tasks` with `externalProvider`/`externalKey`).
- **Host runtime + tRPC-subscription streaming pattern**: the pull-requests runtime and memory runtime in `packages/host-service/src/runtime/*` (copy for the local-ticket stream).
- **Host SQLite migration style**: `packages/host-service/src/db/schema.ts` (wave-6 added migrations 0012–0014; wave-7's first is **0015**). Never hand-edit anything under `drizzle/`.
- **Desktop protocol handling (for OQ1)**: `apps/desktop/scripts/patch-dev-protocol.ts` + Electron protocol/`setAsDefaultProtocolClient` usage.
- **Integrations UI to extend**: `apps/desktop/src/renderer/routes/_authenticated/settings/integrations/components/IntegrationsSettings/*` (today: status + "open in web app"); add the local connect button + precedence-aware dual status.


## Plan of Work

Five milestones. M1 lands the one-button local connect + secure local token (the core ask), gated by cloud-precedence. M2 makes local tickets visible. M3 makes the ticket source resolution source-agnostic (active source only). M4 makes the wave-4 ticket→PR run on whichever source is active. M5 is precedence/coexistence polish. Across all: Bun only; object-param signatures; no `any`/`@ts-ignore`/empty catch; **renderer must not import Node modules** (enforced inside `bun run lint` via the biome.jsonc `apps/desktop/src/renderer/**` override — there is **no** `lint:check-node-imports` script); `bun run lint` exits 0 before any commit; tokens never logged; keep this plan's living sections updated.


### M1 — Host-side PKCE connect + local encrypted token store
Scope: a one-button local Linear connection, no secret, token stored host-local, gated on cloud being disconnected.
Plan: a host `linear.auth.*` router (mirror `host.auth.*`): `startConnect` generates a `code_verifier`/`code_challenge`, opens the system browser to `https://linear.app/oauth/authorize?...&code_challenge=…&code_challenge_method=S256&redirect_uri=<loopback|scheme>&scope=read,write,issues:create`; the host captures the redirect (OQ1, decided here) and `completeConnect` exchanges the code at `https://api.linear.app/oauth/token` with `code_verifier` and **no secret**, then stores the access+refresh tokens **encrypted** host-local. Add `getConnection` (status: connected as `<viewer> (<workspace>)` — never returns the token), `disconnect` (purges the local token), and lazy PKCE `refresh` (no secret). **Precedence gate:** `startConnect` refuses (and the UI disables the button with an explainer) when a cloud Linear connection is active. Renderer: a **"Connect Linear (this Mac)"** button + status in Settings → Integrations, beside the existing cloud connection.
Acceptance:

    bun dev
    # With cloud Linear DISCONNECTED: Settings → Integrations → "Connect Linear (this Mac)" → browser PKCE → "Connected as <you> (<workspace>)".
    # No client secret used; no cloud backend involved; token never shown/logged. Disconnect purges the local token.
    # With cloud Linear CONNECTED: the local connect button is disabled with an explainer; startConnect refuses.
    bun run typecheck && bun run lint && bun test packages/host-service

### M2 — Local ticket fetch + host store + stream
Scope: see your Linear tickets from the local connection.
Plan: a host runtime poller using `new LinearClient({ accessToken })` to fetch the viewer's issues (assigned / created / by team), a new host SQLite **`linear_tickets`** table (`bunx drizzle-kit generate --name="linear_tickets"` → **0016**, since M1 took 0015; also add `@linear/sdk` to `packages/host-service/package.json`), and a tRPC query + subscription that streams them to the renderer (copy the pull-requests/memory streaming pattern). Interval poll (configurable, default 30–60s) + a manual **Refresh**; a **team picker** (port `getTeams`). No webhooks.
Acceptance:

    bun dev
    # With the local connection active, your assigned/created Linear tickets appear (and update on Refresh / interval).
    # Team filter narrows the list. Nothing is written to the cloud DB.

### M3 — Source-agnostic ticket layer
Scope: one ticket interface that resolves the active source.
Plan: a host `tickets.*` layer that, at read time, resolves the **active source** — cloud `tasks` (via the cloud API client) when a cloud connection is active, else the local `linear_tickets` store — and tags each ticket with `source:"cloud"|"local"` plus a unified id that maps back to its source. The renderer ticket list reads this layer and shows a **source badge**. Writeback-routing is a pure helper that targets the active source. No cross-source merge/dedupe in v1 (single active source under cloud-precedence).
Acceptance:

    bun dev
    # Cloud connected → list comes from cloud, badged "Cloud". Cloud disconnected + local connected → list comes from local, badged "This Mac".
    # The renderer/ticket UI code path is identical regardless of source.

### M4 — Wave-4 ticket→PR on the active source
Scope: run the autonomous ticket→PR flow on a ticket from whichever source is active.
Plan: parameterize the wave-4 orchestrator (`ticket-run` / `dispatch` / `ticket-context`) to read the selected ticket from the **source-agnostic layer** (preserving its existing id contract), and route **status/comment writeback** to the active source: cloud → `ctx.api.task.update`; local → a direct Linear API update/comment with the host token. No change to the agent execution or never-merge guardrails.
Acceptance:

    bun dev
    # Local active: pick a ticket → run to PR → status writes back to Linear directly.
    # Cloud active: pick a ticket → run to PR → status writes back through the cloud, as today.

### M5 — Precedence / coexistence polish
Scope: make both connection types first-class and the precedence rule clear.
Plan: independent status cards for cloud + local in Settings → Integrations; the local card disabled-with-explainer while cloud is active ("disconnect cloud Linear to connect this Mac"); per-source team filters; disconnect purges only the local token; token refresh/expiry + re-auth prompts; from-source dev `LINEAR_DESKTOP_CLIENT_ID` wiring + docs (`DEVELOPMENT.md` note); a short integrations doc.
Acceptance:

    bun dev
    # Both connection types are visible; precedence is obvious in the UI; expired local token prompts a one-button re-connect.
    # Dev docs explain the public client_id (LINEAR_DESKTOP_CLIENT_ID).


## Concrete Steps (quick reference)

From repo root `/Users/ajitsingh/Documents/GitHub/superset-vWorkspace` unless noted:

    bun install
    bun run typecheck
    bun run lint:fix && bun run lint        # exit 0; renderer Node-import ban runs here (no separate script)
    bun test packages/host-service          # scoped; full-repo `bun test` aborts on a pre-existing pty-daemon panic
    bun dev

Host SQLite migrations (M2; and any later tables), from `packages/host-service` — never hand-edit `drizzle/`:

    bunx drizzle-kit generate --name="linear_tickets"     # M2 (→ 0016; M1's linear_local_auth took 0015)


## Validation and Acceptance

End-to-end: with the **cloud Linear connection disconnected**, click **"Connect Linear (this Mac)"** → browser **PKCE** → **"Connected as <you> (<workspace>)"** with **no secret and no cloud backend**; your tickets appear (polled, Refreshable); run a **ticket→PR** and confirm status writes back **directly** to Linear. Then **connect cloud Linear** (web app) → the local connect affordance becomes disabled-with-explainer, the active source flips to **cloud**, the ticket list + ticket→PR now run through the cloud path (status writes back through the cloud). **Disconnect** the local connection → its token is purged. Verify: connecting is an **explicit one-button action** (never auto-connect); the **precedence gate** blocks local while cloud is active; **no token is logged or returned in plaintext**; **all local storage is host-local**; **no cloud schema change**; the cloud Linear routes/tables are unmodified.

Standing gates every milestone: `bun run typecheck`, `bun run lint` (exit 0; includes the renderer Node-import ban), `bun test packages/host-service` + the touched renderer suites. (Do **not** gate on full-repo `bun test` — it aborts on the pre-existing `packages/pty-daemon` panic.)


## Idempotence and Recovery

- M1 connect is idempotent: re-connecting overwrites the stored local token; disconnect purges it; the PKCE `code_verifier` is single-use per attempt. Tokens are encrypted at rest; losing/clearing them just re-prompts a one-button connect. The precedence gate is a pure status check (cloud connected → refuse), with no persisted state of its own.
- M2 `linear_tickets` is a cache keyed by Linear id — safe to delete and re-poll; the poller upserts. The migration is drizzle-generated, forward-only.
- M3 source resolution is a pure read-time function over the active source — no persisted derived state to corrupt.
- M4 writeback is the only external mutation (status/comment to Linear) — user-initiated per the wave-4 flow and routed to the single active source, so no double-writes; re-runs are guarded by the existing wave-4 reconciler.
- GitHub/Linear write egress stays confined to explicit user actions; all local Linear calls run on the user's own token. The cloud path is unchanged and independently recoverable.


## Interfaces and Dependencies

No cloud schema change; no new heavyweight dependencies (`@linear/sdk`, Octokit, the host runtime/streaming stack, and the wave-4 pipeline all exist). New: a host `linear` router (`linear.auth.*` PKCE connect/disconnect/status/refresh, precedence-gated) + local encrypted token storage; a host Linear **poller** + `linear_tickets` table + a tRPC stream; a host **source-agnostic `tickets.*` layer** (active-source resolution + writeback routing); a wave-4 orchestrator **source-swap** to that layer; desktop Settings → Integrations **precedence-aware dual-connection UI** + ticket-list source badge. Reuse: the host-side Anthropic OAuth pattern (`host.auth.*`), the GitHub credential layer, the cloud Linear HTTP/SDK helpers (ported, not modified) + the cloud `getConnection` status (for the precedence gate), the wave-4 ticket→PR pipeline, the cloud `tasks` shape, and the host runtime/streaming pattern.


## Outcomes & Retrospective

To be filled in at completion. Compare against the Purpose: a developer can connect Linear **for their machine with one button** (PKCE, no secret, no cloud) — including in local dev — **whenever cloud Linear is not connected**; when cloud is connected it takes precedence and the local affordance is disabled; the ticket list and the **wave-4 ticket→PR** flow run source-agnostically against whichever source is active, with writeback to that source; disconnecting purges the local token; all local storage is host-local, tokens encrypted, and the cloud Linear integration is unchanged.


## Future (explicitly out of scope this wave)

- **True simultaneous coexistence** of both connections (merge + dedupe by `externalKey` + writeback authority) — relaxing the v1 cloud-precedence mutual-exclusivity rule.
- **PAT (paste-an-API-key) fallback** for the local connection (deferred from v1).
- **Inbound webhooks for the local connection** (would require a public URL / cloud relay; deliberately excluded — local uses polling).
- **Writing the local source into the cloud `tasks` table** (excluded — would couple local to the cloud DB).
- **MCP-sourced Linear into the wave-4 pipeline** (the existing MCP server picker already lets an *agent* talk to Linear locally; feeding MCP tickets into the structured ticket→PR pipeline is a separate effort).
- **Other providers (Jira/GitHub Issues) via the same source-agnostic ticket layer** (the layer is designed to admit more source adapters later).


---

### Revision note

- 2026-06-26 08:19Z — Initial wave-7 draft: a host-side, one-button **PKCE** Linear connection coexisting with the cloud integration behind a unified ticket layer (merge + dedupe + writeback authority). Open Questions: redirect mechanism, public `client_id`, both-source writeback authority, local→cloud writes, PAT-in-v1.
- 2026-06-26 08:26Z — Resolved the open questions per direction and **simplified to cloud-precedence**: local is connectable **only when cloud is disconnected** (v1 mutual-exclusivity; reversible — full coexistence moved to Future). Locked decisions: PKCE/no-secret with a public desktop `client_id` (`LINEAR_DESKTOP_CLIENT_ID` for dev); **read-time composition** (local never writes to cloud `tasks`); writeback to the active source with **cloud winning** (automatic under precedence); **PAT deferred** to Future; **redirect mechanism deferred to M1**. M3 reframed from "merge both sources" to "resolve the single active source"; merge/dedupe-of-both removed from scope and listed in Future. Updated Purpose/Definitions/Assumptions/Plan/Validation accordingly.
