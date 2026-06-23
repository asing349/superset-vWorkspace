/**
 * Best-effort secret redaction (PURE LOGIC, Assumption A9).
 *
 * Memory captures free text (intents, commands, gotchas) that may inadvertently
 * contain secrets. This pass scrubs the common shapes BEFORE anything is
 * persisted to SQLite / the vault. It is INTENTIONALLY imperfect: regexes catch
 * well-known formats, not arbitrary secrets. Treat redacted output as "lower
 * risk", never "safe to publish" — flagged as a real risk before any future
 * sharing (the cloud/org tier is explicitly deferred this wave).
 *
 * No Node deps: usable from host (Node) and renderer (browser) alike.
 */

/** A named secret pattern. `replace` produces the masked substitution. */
interface RedactionRule {
	name: string;
	pattern: RegExp;
	replace: (match: string, ...groups: string[]) => string;
}

const PLACEHOLDER = "[REDACTED]";

/**
 * Ordered redaction rules. Most-specific token shapes first so a generic
 * KEY=VALUE rule doesn't swallow a value a precise rule would have masked with
 * more context. Every `pattern` is global (`g`) so all occurrences are scrubbed.
 */
const RULES: readonly RedactionRule[] = [
	// PEM private key blocks (multi-line) — collapse the whole block.
	{
		name: "private-key-block",
		pattern:
			/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
		replace: () => `${PLACEHOLDER}-PRIVATE-KEY`,
	},
	// AWS access key id.
	{
		name: "aws-access-key-id",
		pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
		replace: () => `${PLACEHOLDER}-AWS-KEY`,
	},
	// GitHub tokens (classic + fine-grained + oauth/app/refresh).
	{
		name: "github-token",
		pattern: /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/g,
		replace: () => `${PLACEHOLDER}-GITHUB-TOKEN`,
	},
	// Slack tokens.
	{
		name: "slack-token",
		pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
		replace: () => `${PLACEHOLDER}-SLACK-TOKEN`,
	},
	// Stripe secret/live keys.
	{
		name: "stripe-key",
		pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
		replace: () => `${PLACEHOLDER}-STRIPE-KEY`,
	},
	// Google API keys.
	{
		name: "google-api-key",
		pattern: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
		replace: () => `${PLACEHOLDER}-GOOGLE-KEY`,
	},
	// OpenAI / Anthropic-style provider keys.
	{
		name: "provider-key",
		pattern: /\b(?:sk-ant-|sk-)[A-Za-z0-9\-_]{20,}\b/g,
		replace: () => `${PLACEHOLDER}-PROVIDER-KEY`,
	},
	// JWTs (three base64url segments).
	{
		name: "jwt",
		pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
		replace: () => `${PLACEHOLDER}-JWT`,
	},
	// Bearer tokens in Authorization headers / curl.
	{
		name: "bearer-token",
		pattern: /\b([Bb]earer\s+)[A-Za-z0-9._-]{12,}/g,
		replace: (_m, prefix) => `${prefix}${PLACEHOLDER}`,
	},
	// .env-style KEY=VALUE where the KEY name signals a secret. Keeps the key
	// for context, masks the value (quoted or bare, to end of line). Matches
	// only `=` assignments (not `:`) so HTTP headers like "Authorization: ..."
	// and prose like "author: foo" are left to the dedicated rules / untouched.
	{
		name: "env-secret-assignment",
		pattern:
			/\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL)[A-Z0-9_]*)\s*=\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s"'\n]+)/gi,
		replace: (_m, key) => `${key}=${PLACEHOLDER}`,
	},
];

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

export interface RedactOptions {
	/**
	 * Also redact email addresses. Off by default (emails are often legitimate
	 * context like a commit author); callers that share externally turn it on.
	 */
	redactEmails?: boolean;
}

export interface RedactionResult {
	/** The scrubbed text. */
	text: string;
	/** Whether any rule matched (useful for flagging captures for review). */
	redacted: boolean;
	/** Names of the rules that fired, for telemetry/debugging. */
	rulesFired: string[];
}

/**
 * Redact a string, returning the scrubbed text plus metadata about what fired.
 * Best-effort and order-stable; safe on empty input.
 */
export function redactText(
	text: string,
	options: RedactOptions = {},
): RedactionResult {
	const rulesFired: string[] = [];
	let result = text;

	for (const rule of RULES) {
		// `replace` with the global pattern scrubs every occurrence; we detect a
		// hit with a separate non-consuming test to record which rule fired.
		if (rule.pattern.test(result)) {
			rulesFired.push(rule.name);
		}
		rule.pattern.lastIndex = 0;
		result = result.replace(rule.pattern, (match, ...groups) =>
			// `groups` ends with offset + full string; pass through to the rule,
			// which only reads the leading capture groups it declared.
			rule.replace(match, ...(groups as string[])),
		);
	}

	if (options.redactEmails) {
		if (EMAIL_PATTERN.test(result)) rulesFired.push("email");
		EMAIL_PATTERN.lastIndex = 0;
		result = result.replace(EMAIL_PATTERN, `${PLACEHOLDER}-EMAIL`);
	}

	return { text: result, redacted: rulesFired.length > 0, rulesFired };
}

/** Convenience: redact each string in a list (e.g. a Playbook's `commands`). */
export function redactAll(
	values: readonly string[],
	options: RedactOptions = {},
): string[] {
	return values.map((value) => redactText(value, options).text);
}
