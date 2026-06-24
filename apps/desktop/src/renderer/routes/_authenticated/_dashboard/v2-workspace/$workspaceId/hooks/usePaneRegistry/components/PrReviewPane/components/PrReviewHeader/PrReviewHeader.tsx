import { cn } from "@superset/ui/utils";
import { LuExternalLink } from "react-icons/lu";
import { PR_REVIEW_SECTIONS, type PrReviewSection } from "../../utils/sections";

interface PrReviewHeaderProps {
	prNumber: number;
	/** PR title, when known from the list row; falls back to "PR #N". */
	title?: string;
	/** PR html_url, when known — renders an "open on GitHub" affordance. */
	url?: string;
	activeSection: PrReviewSection;
	onSelectSection: (section: PrReviewSection) => void;
}

/**
 * The PR-review window header: the PR identity + an external link, and the
 * Diff | Guide segmented control (sub-tabs). The segmented control is the
 * Memory panel's `MemoryPanelHeader` pattern (underline-on-active nav), kept in
 * lockstep with `PR_REVIEW_SECTIONS`.
 */
export function PrReviewHeader({
	prNumber,
	title,
	url,
	activeSection,
	onSelectSection,
}: PrReviewHeaderProps) {
	return (
		<div className="flex shrink-0 flex-col gap-2 border-b border-border bg-muted/30 px-3 pt-2.5">
			<div className="flex min-w-0 items-center gap-2">
				<span className="shrink-0 text-xs font-medium text-muted-foreground">
					#{prNumber}
				</span>
				<span
					className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground select-text"
					title={title ?? `PR #${prNumber}`}
				>
					{title ?? `PR #${prNumber}`}
				</span>
				{url ? (
					<a
						href={url}
						target="_blank"
						rel="noreferrer"
						className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
						title="Open on GitHub"
					>
						<LuExternalLink className="size-3.5" />
					</a>
				) : null}
			</div>
			<nav className="flex items-center gap-1">
				{PR_REVIEW_SECTIONS.map((section) => (
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
