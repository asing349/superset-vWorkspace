import { describe, expect, it } from "bun:test";
import {
	DEFAULT_MEMORY_SECTION,
	isEnabledSection,
	MEMORY_SECTIONS,
	resolveSection,
} from "./sections";

describe("memory sections", () => {
	it("ships playbooks enabled and reserves later milestones as disabled", () => {
		const playbooks = MEMORY_SECTIONS.find((s) => s.id === "playbooks");
		expect(playbooks?.enabled).toBe(true);
		// Future sections exist as disabled placeholders (the extensibility seam).
		expect(MEMORY_SECTIONS.find((s) => s.id === "practice")?.enabled).toBe(
			false,
		);
		expect(MEMORY_SECTIONS.find((s) => s.id === "graph")?.enabled).toBe(false);
		expect(MEMORY_SECTIONS.find((s) => s.id === "settings")?.enabled).toBe(
			false,
		);
	});

	it("defaults to playbooks", () => {
		expect(DEFAULT_MEMORY_SECTION).toBe("playbooks");
	});

	it("recognizes only enabled sections", () => {
		expect(isEnabledSection("playbooks")).toBe(true);
		expect(isEnabledSection("graph")).toBe(false);
		expect(isEnabledSection("nonsense")).toBe(false);
	});

	it("resolves stale/disabled/missing sections to the default", () => {
		expect(resolveSection("playbooks")).toBe("playbooks");
		expect(resolveSection("graph")).toBe("playbooks");
		expect(resolveSection(null)).toBe("playbooks");
		expect(resolveSection(undefined)).toBe("playbooks");
	});
});
