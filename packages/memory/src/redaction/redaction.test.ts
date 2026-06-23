import { describe, expect, it } from "bun:test";
import { redactAll, redactText } from "./redaction";

describe("redactText — positive cases (secrets are scrubbed)", () => {
	it("redacts AWS access key ids", () => {
		const r = redactText("key=AKIAIOSFODNN7EXAMPLE rest");
		expect(r.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
		expect(r.redacted).toBe(true);
		expect(r.rulesFired).toContain("aws-access-key-id");
	});

	it("redacts GitHub tokens", () => {
		const token = `ghp_${"a".repeat(36)}`;
		const r = redactText(
			`git remote set-url origin https://${token}@github.com`,
		);
		expect(r.text).not.toContain(token);
		expect(r.rulesFired).toContain("github-token");
	});

	it("redacts provider (Anthropic/OpenAI-style) keys", () => {
		const r = redactText(`export KEY=sk-ant-${"x".repeat(40)}`);
		expect(r.text).not.toContain("x".repeat(40));
		expect(r.redacted).toBe(true);
	});

	it("redacts PEM private key blocks", () => {
		const pem = [
			"-----BEGIN RSA PRIVATE KEY-----",
			"MIIEowIBAAKCAQEA1234567890abcdef",
			"-----END RSA PRIVATE KEY-----",
		].join("\n");
		const r = redactText(`here is a key\n${pem}\ndone`);
		expect(r.text).not.toContain("MIIEowIBAAKCAQEA");
		expect(r.text).toContain("here is a key");
		expect(r.text).toContain("done");
		expect(r.rulesFired).toContain("private-key-block");
	});

	it("redacts the VALUE of an env-style secret assignment but keeps the key", () => {
		const r = redactText('DATABASE_PASSWORD="hunter2-super-secret"');
		expect(r.text).not.toContain("hunter2-super-secret");
		expect(r.text).toContain("DATABASE_PASSWORD=");
		expect(r.rulesFired).toContain("env-secret-assignment");
	});

	it("redacts API_KEY assignments case-insensitively and unquoted", () => {
		const r = redactText("api_key=abcdef123456ghijkl");
		expect(r.text).not.toContain("abcdef123456ghijkl");
		expect(r.text.toLowerCase()).toContain("api_key=");
	});

	it("redacts bearer tokens but keeps the Bearer prefix", () => {
		const r = redactText("Authorization: Bearer abcdef1234567890XYZ");
		expect(r.text).toContain("Bearer ");
		expect(r.text).not.toContain("abcdef1234567890XYZ");
		expect(r.rulesFired).toContain("bearer-token");
	});

	it("redacts JWTs", () => {
		const jwt =
			"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
		const r = redactText(`token ${jwt}`);
		expect(r.text).not.toContain(jwt);
		expect(r.rulesFired).toContain("jwt");
	});

	it("redacts multiple secrets in one string", () => {
		const r = redactText(
			`AKIAIOSFODNN7EXAMPLE and ghp_${"b".repeat(36)} together`,
		);
		expect(r.rulesFired).toContain("aws-access-key-id");
		expect(r.rulesFired).toContain("github-token");
	});

	it("optionally redacts emails when asked", () => {
		const r = redactText("ping me at dev@example.com", { redactEmails: true });
		expect(r.text).not.toContain("dev@example.com");
		expect(r.rulesFired).toContain("email");
	});
});

describe("redactText — negative cases (ordinary text is untouched)", () => {
	it("leaves normal prose alone", () => {
		const input = "Ran the host-service test suite; 757 pass, 0 fail.";
		const r = redactText(input);
		expect(r.text).toBe(input);
		expect(r.redacted).toBe(false);
		expect(r.rulesFired).toEqual([]);
	});

	it("leaves a non-secret KEY=VALUE alone", () => {
		const input = "NODE_ENV=production PORT=3000";
		const r = redactText(input);
		expect(r.text).toBe(input);
		expect(r.redacted).toBe(false);
	});

	it("does NOT redact emails by default", () => {
		const input = "author: dev@example.com";
		const r = redactText(input);
		expect(r.text).toBe(input);
		expect(r.redacted).toBe(false);
	});

	it("handles empty input", () => {
		const r = redactText("");
		expect(r.text).toBe("");
		expect(r.redacted).toBe(false);
	});
});

describe("redactAll", () => {
	it("redacts each string in a list", () => {
		const out = redactAll(["bun test", `export TOKEN=ghp_${"c".repeat(36)}`]);
		expect(out[0]).toBe("bun test");
		expect(out[1]).not.toContain("c".repeat(36));
	});
});
