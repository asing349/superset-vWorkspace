// Wave-7 M1 — Linear OAuth endpoints + config for the host-local PKCE flow.
// These mirror the cloud Linear integration's endpoints/scopes, but the local
// flow runs entirely host-side with PKCE and NO client secret.

export const LINEAR_AUTHORIZE_URL = "https://linear.app/oauth/authorize";
export const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
export const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

// Scopes match the cloud integration (apps/api linear/connect route).
export const LINEAR_OAUTH_SCOPES = "read,write,issues:create";

// Refresh the access token when it is within this window of expiry.
export const LINEAR_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Token exchange / GraphQL request timeout.
export const LINEAR_REQUEST_TIMEOUT_MS = 15 * 1000;

// Loopback redirect target for OQ1 (redirect capture). The desktop already
// runs a host-side loopback HTTP listener for the OpenAI OAuth PKCE flow, so we
// reuse that lower-surface mechanism rather than registering a custom
// `superset://` scheme. The redirect URI is
// `http://127.0.0.1:<port>/callback` and MUST be registered as an allowed
// redirect on the public Linear OAuth application. The port is overridable via
// `LINEAR_DESKTOP_REDIRECT_PORT` for from-source dev.
export const DEFAULT_REDIRECT_HOST = "127.0.0.1";
export const DEFAULT_REDIRECT_PORT = 52718;
export const DEFAULT_REDIRECT_PATH = "/callback";
