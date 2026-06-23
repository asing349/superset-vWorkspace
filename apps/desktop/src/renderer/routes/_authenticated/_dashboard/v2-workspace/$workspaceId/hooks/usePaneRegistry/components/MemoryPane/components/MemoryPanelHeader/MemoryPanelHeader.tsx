import { cn } from "@superset/ui/utils";
import { LuSparkles } from "react-icons/lu";
import { formatSavedHeadline, type SavedStat } from "../../utils/memoryFormat";
import type { MemorySection } from "../../utils/sections";
import { MEMORY_SECTIONS } from "../../utils/sections";

interface MemoryPanelHeaderProps {
	savedStats: SavedStat[];
	activeSection: MemorySection;
	onSelectSection: (section: MemorySection) => void;
	/**
	 * Header actions slot — B5's consolidation buttons mount here later. Empty
	 * today; kept as a prop so the layout doesn't change when they land.
	 */
	actions?: React.ReactNode;
}

/**
 * The Memory panel's header: the "Memory saved ~X%" headline, an actions slot
 * (B5), and the sections nav (sub-tabs). The sections list is data-driven from
 * `MEMORY_SECTIONS`, so B6 (graph) and B7 (settings/embeddings) drop in by
 * adding an entry there + a body branch — no header rewrite.
 */
export function MemoryPanelHeader({
	savedStats,
	activeSection,
	onSelectSection,
	actions,
}: MemoryPanelHeaderProps) {
	const enabledSections = MEMORY_SECTIONS.filter((s) => s.enabled);

	return (
		<div className="flex shrink-0 flex-col gap-2 border-b border-border bg-muted/30 px-3 pt-2.5">
			<div className="flex items-center gap-2">
				<LuSparkles className="size-4 shrink-0 text-muted-foreground" />
				<span className="text-sm font-semibold text-foreground select-text">
					{formatSavedHeadline(savedStats)}
				</span>
				<div className="ml-auto flex items-center gap-1">{actions}</div>
			</div>
			<nav className="flex items-center gap-1">
				{enabledSections.map((section) => (
					<button
						key={section.id}
						type="button"
						onClick={() => onSelectSection(section.id)}
						className={cn(
							"relative px-2 py-1.5 text-xs font-medium transition-colors",
							activeSection === section.id
								? "text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{section.label}
						{activeSection === section.id ? (
							<span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary" />
						) : null}
					</button>
				))}
			</nav>
		</div>
	);
}
