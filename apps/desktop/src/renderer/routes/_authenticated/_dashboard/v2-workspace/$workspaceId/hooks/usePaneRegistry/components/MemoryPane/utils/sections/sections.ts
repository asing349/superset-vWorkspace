/**
 * The Memory panel's sections (sub-tabs). Data-driven so later milestones extend
 * the panel by adding an entry here + a body branch — NOT by rewriting the
 * header/layout:
 *   - B4b ships "playbooks" (enabled).
 *   - B5 ships "practice" (consolidation review — enabled).
 *   - B6 adds "graph"; B7 adds "settings" (the embeddings toggle).
 * The disabled placeholders are kept here to document the intended shape and to
 * keep the type stable as milestones land.
 */

export type MemorySection = "playbooks" | "practice" | "graph" | "settings";

export interface MemorySectionDef {
	id: MemorySection;
	label: string;
	/** Whether this section is shipped + selectable today. */
	enabled: boolean;
	/** The milestone that turns this section on. */
	milestone: string;
}

export const MEMORY_SECTIONS: readonly MemorySectionDef[] = [
	{ id: "playbooks", label: "Playbooks", enabled: true, milestone: "B4b" },
	{ id: "practice", label: "Practice", enabled: true, milestone: "B5" },
	{ id: "graph", label: "Graph", enabled: false, milestone: "B6" },
	{ id: "settings", label: "Settings", enabled: false, milestone: "B7" },
];

/** The default (first enabled) section. */
export const DEFAULT_MEMORY_SECTION: MemorySection = "playbooks";

/** Whether a section id is currently shipped + selectable. */
export function isEnabledSection(section: string): section is MemorySection {
	return MEMORY_SECTIONS.some((s) => s.id === section && s.enabled);
}

/**
 * Resolve a (possibly stale/persisted) section id to a selectable one, falling
 * back to the default when the stored section isn't enabled (e.g. a future
 * section persisted then the app downgraded).
 */
export function resolveSection(
	section: string | null | undefined,
): MemorySection {
	if (section && isEnabledSection(section)) return section;
	return DEFAULT_MEMORY_SECTION;
}
