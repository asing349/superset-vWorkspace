import { describe, expect, it } from "bun:test";
import {
	deriveLinearLocalStatus,
	deriveLocalConnectAffordance,
	formatLinearLocalStatusLabel,
	isLocalActiveSource,
} from "./linearLocalConnectionState";

const NOW = 1_700_000_000_000;

describe("deriveLinearLocalStatus", () => {
	it("is disconnected with no connection", () => {
		expect(deriveLinearLocalStatus({ connection: undefined, now: NOW })).toBe(
			"disconnected",
		);
		expect(deriveLinearLocalStatus({ connection: null, now: NOW })).toBe(
			"disconnected",
		);
	});

	it("is disconnected when not connected", () => {
		expect(
			deriveLinearLocalStatus({ connection: { connected: false }, now: NOW }),
		).toBe("disconnected");
	});

	it("is connected when there is no known expiry", () => {
		expect(
			deriveLinearLocalStatus({
				connection: { connected: true, viewer: "Ada" },
				now: NOW,
			}),
		).toBe("connected");
	});

	it("is connected when expiry is in the future", () => {
		expect(
			deriveLinearLocalStatus({
				connection: { connected: true, expiresAt: NOW + 60_000 },
				now: NOW,
			}),
		).toBe("connected");
	});

	it("is expired when the access token is at/past expiry", () => {
		expect(
			deriveLinearLocalStatus({
				connection: { connected: true, expiresAt: NOW },
				now: NOW,
			}),
		).toBe("expired");
		expect(
			deriveLinearLocalStatus({
				connection: { connected: true, expiresAt: NOW - 1 },
				now: NOW,
			}),
		).toBe("expired");
	});
});

describe("formatLinearLocalStatusLabel", () => {
	it("falls back to 'Connected' without a viewer", () => {
		expect(
			formatLinearLocalStatusLabel({ connection: { connected: true } }),
		).toBe("Connected");
	});

	it("shows the viewer and workspace", () => {
		expect(
			formatLinearLocalStatusLabel({
				connection: { connected: true, viewer: "Ada", workspace: "Acme" },
			}),
		).toBe("Connected as Ada (Acme)");
	});

	it("shows the viewer without a workspace", () => {
		expect(
			formatLinearLocalStatusLabel({
				connection: { connected: true, viewer: "Ada" },
			}),
		).toBe("Connected as Ada");
	});
});

describe("isLocalActiveSource", () => {
	it("is active only when local is connected and cloud is not", () => {
		expect(
			isLocalActiveSource({ cloudConnected: false, localStatus: "connected" }),
		).toBe(true);
	});

	it("is dormant while cloud is connected (cloud-precedence)", () => {
		expect(
			isLocalActiveSource({ cloudConnected: true, localStatus: "connected" }),
		).toBe(false);
	});

	it("is not active while expired or disconnected", () => {
		expect(
			isLocalActiveSource({ cloudConnected: false, localStatus: "expired" }),
		).toBe(false);
		expect(
			isLocalActiveSource({
				cloudConnected: false,
				localStatus: "disconnected",
			}),
		).toBe(false);
	});
});

describe("deriveLocalConnectAffordance", () => {
	it("disables with the precedence explainer while cloud is active", () => {
		expect(
			deriveLocalConnectAffordance({
				cloudConnected: true,
				busy: false,
				hostAvailable: true,
			}),
		).toEqual({
			disabled: true,
			reason: "Disconnect cloud Linear to connect this Mac.",
		});
	});

	it("cloud-precedence wins even when the host is down or busy", () => {
		expect(
			deriveLocalConnectAffordance({
				cloudConnected: true,
				busy: true,
				hostAvailable: false,
			}).reason,
		).toBe("Disconnect cloud Linear to connect this Mac.");
	});

	it("disables (with explainer) when the host service is unavailable", () => {
		expect(
			deriveLocalConnectAffordance({
				cloudConnected: false,
				busy: false,
				hostAvailable: false,
			}),
		).toEqual({ disabled: true, reason: "Host service is not running." });
	});

	it("disables without an explainer while a connect is in flight", () => {
		expect(
			deriveLocalConnectAffordance({
				cloudConnected: false,
				busy: true,
				hostAvailable: true,
			}),
		).toEqual({ disabled: true, reason: null });
	});

	it("enables connect when cloud is disconnected and the host is up", () => {
		expect(
			deriveLocalConnectAffordance({
				cloudConnected: false,
				busy: false,
				hostAvailable: true,
			}),
		).toEqual({ disabled: false, reason: null });
	});
});
