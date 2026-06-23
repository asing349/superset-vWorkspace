import { describe, expect, it } from "bun:test";
import {
	DEFAULT_MEMORY_SECTION,
	isEnabledSection,
	MEMORY_SECTIONS,
	resolveSection,
} from "./sections";

describe("memory sections", () => {
	it("ships playbooks + practice + graph enabled and reserves later milestones as disabled", () => {
		expect(MEMORY_SECTIONS.find((s) => s.id === "playbooks")?.enabled).toBe(
			true,
		);
		// B5: practice; B6: graph.
		expect(MEMORY_SECTIONS.find((s) => s.id === "practice")?.enabled).toBe(
			true,
		);
		expect(MEMORY_SECTIONS.find((s) => s.id === "graph")?.enabled).toBe(true);
		// Settings (B7) remains a disabled placeholder (the extensibility seam).
		expect(MEMORY_SECTIONS.find((s) => s.id === "settings")?.enabled).toBe(
			false,
		);
	});

	it("defaults to playbooks", () => {
		expect(DEFAULT_MEMORY_SECTION).toBe("playbooks");
	});

	it("recognizes only enabled sections", () => {
		expect(isEnabledSection("playbooks")).toBe(true);
		expect(isEnabledSection("graph")).toBe(true);
		expect(isEnabledSection("settings")).toBe(false);
		expect(isEnabledSection("nonsense")).toBe(false);
	});

	it("resolves stale/disabled/missing sections to the default", () => {
		expect(resolveSection("playbooks")).toBe("playbooks");
		expect(resolveSection("settings")).toBe("playbooks");
		expect(resolveSection(null)).toBe("playbooks");
		expect(resolveSection(undefined)).toBe("playbooks");
	});
});
