import { describe, expect, it } from "bun:test";
import {
	DEFAULT_MEMORY_SECTION,
	isEnabledSection,
	MEMORY_SECTIONS,
	resolveSection,
} from "./sections";

describe("memory sections", () => {
	it("ships all four sections enabled (B4b/B5/B6/B7b)", () => {
		expect(MEMORY_SECTIONS.find((s) => s.id === "playbooks")?.enabled).toBe(
			true,
		);
		expect(MEMORY_SECTIONS.find((s) => s.id === "practice")?.enabled).toBe(
			true,
		);
		expect(MEMORY_SECTIONS.find((s) => s.id === "graph")?.enabled).toBe(true);
		// B7b: settings (embeddings toggle) is now enabled.
		expect(MEMORY_SECTIONS.find((s) => s.id === "settings")?.enabled).toBe(
			true,
		);
	});

	it("defaults to playbooks", () => {
		expect(DEFAULT_MEMORY_SECTION).toBe("playbooks");
	});

	it("recognizes only enabled sections", () => {
		expect(isEnabledSection("playbooks")).toBe(true);
		expect(isEnabledSection("graph")).toBe(true);
		expect(isEnabledSection("settings")).toBe(true);
		expect(isEnabledSection("nonsense")).toBe(false);
	});

	it("resolves stale/missing sections to the default", () => {
		expect(resolveSection("playbooks")).toBe("playbooks");
		expect(resolveSection("settings")).toBe("settings");
		expect(resolveSection("nonsense")).toBe("playbooks");
		expect(resolveSection(null)).toBe("playbooks");
		expect(resolveSection(undefined)).toBe("playbooks");
	});
});
