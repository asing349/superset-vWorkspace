# Linear — host-local connection (this Mac)

Wave 7 adds a **second, host-side Linear connection** that runs entirely on the
developer's machine via **PKCE** OAuth, alongside the existing org-scoped **cloud**
Linear integration. It is a **fallback under cloud-precedence**: connectable only
when no cloud Linear connection is active.

This doc covers what the local connection is, the **cloud-precedence** rule, and
the **from-source dev config** (`LINEAR_DESKTOP_CLIENT_ID`) you need to use it
when building Superset from source.

## What it is

- **One-button connect, no secret.** Settings → Integrations → **"Connect Linear
  (this Mac)"** runs a host-side PKCE flow (`code_challenge`/`code_verifier`, no
  `client_secret`). The host opens the system browser to Linear's authorize page,
  captures the redirect on a transient **loopback HTTP listener**
  (`http://127.0.0.1:<port>/callback`), exchanges the code, and stores the
  access + refresh tokens **encrypted, host-local** (the `linear_local_auth`
  SQLite table). No cloud backend is involved and the token never reaches the
  renderer or the logs.
- **Source-agnostic downstream.** The unified ticket list and the wave-4
  ticket→PR pipeline read a single `tickets.*` layer that resolves the active
  source at read time. A `local:` ticket can be launched to a PR directly from
  the unified list (Settings → Integrations → Tickets → **Run → PR**); writeback
  (PR-link comment + in-review state) goes straight to Linear with the local
  token.

## Cloud-precedence (v1 rule)

At most **one** Linear source is active at a time, and **cloud always wins**:

- While a **cloud** Linear connection is active, it is the authoritative source.
  The local connect control is **disabled with an explainer** ("Disconnect cloud
  Linear to connect this Mac"), and any stored local token is shown as **Dormant**.
  The host gate (`startConnect`) independently refuses while cloud is connected —
  the disabled button is belt-and-suspenders, not the only guard.
- When **no** cloud connection is active (including local-only Docker dev, where
  cloud Linear ships fake credentials), the local connection becomes the active
  source and its tickets/ticket→PR run through the local path.

Disconnecting the local connection purges **only** the local token; the cloud
connection (if any) is untouched. An expired local access token surfaces a
one-button **Reconnect** (the host runs a lazy PKCE refresh first; if the refresh
token is gone/rejected the host purges the token and the card falls back to a
fresh one-button connect).

## From-source dev config

PKCE still needs a registered OAuth **application** to obtain a public
`client_id` and an allowed redirect URI — but the `client_id` is **not** a secret
and can be bundled in the build. Production ships a Superset desktop public client
id; **from-source builds must supply their own**:

1. Create a Linear OAuth application (Linear → Settings → API → OAuth
   applications). Public client, **no secret needed** for PKCE.
2. Add the loopback redirect URI to the app's allowed redirect URIs:
   `http://127.0.0.1:52718/callback` (or `http://127.0.0.1:<port>/callback` if
   you override the port — see below).
3. Set the env var before `bun run dev`:

   ```bash
   # The public Linear OAuth client id (NOT a secret). Required for the local
   # "Connect Linear (this Mac)" button to do anything; absent → no live connect.
   LINEAR_DESKTOP_CLIENT_ID=lin_oauth_xxx

   # Optional — override the loopback redirect port (default 52718). The redirect
   # URI registered on the Linear app must match: http://127.0.0.1:<port>/callback
   LINEAR_DESKTOP_REDIRECT_PORT=52718
   ```

   These are read host-side in `packages/host-service/src/app.ts`
   (`process.env.LINEAR_DESKTOP_CLIENT_ID` / `LINEAR_DESKTOP_REDIRECT_PORT`).

If `LINEAR_DESKTOP_CLIENT_ID` is unset, the button is present but `startConnect`
returns a clear "client id is required" error rather than attempting a connect.

## Boundaries

- **No cloud schema change.** All local state is host-local SQLite; the cloud
  Linear routes, `integration_connections`, and the cloud `tasks` table are
  read/reused only, never modified.
- **No webhooks.** The local connection stays current via polling (default 45s)
  plus a manual **Refresh** — a local machine has no public URL for inbound
  Linear webhooks.
- **Tokens are encrypted at rest** (AES-256-GCM, machine-derived key) and are
  never logged or returned over tRPC (the status surface carries no token
  material).
