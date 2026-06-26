import { cn } from "@superset/ui/utils";
import type { Finding, FindingAnchor } from "../../types";
import { GuideItemLine } from "../GuideSectionView";

interface FindingsSectionViewProps {
	findings: Finding[];
	/** Jump a finding's anchor to the sibling Diff tab (M1 → resolveScrollTarget). */
	onOpenAnchor?: (anchor: FindingAnchor) => void;
}

/** Severity render order — most severe first — and its section heading. */
const SEVERITY_ORDER: readonly Finding["severity"][] = [
	"danger",
	"warning",
	"info",
];
const SEVERITY_LABEL: Record<Finding["severity"], string> = {
	danger: "Danger",
	warning: "Warning",
	info: "Info",
};

/** Human label for each finding category (shown as a badge per finding). */
const CATEGORY_LABEL: Record<Finding["category"], string> = {
	correctness: "correctness",
	"business-logic": "business logic",
	convention: "convention",
	security: "security",
	perf: "perf",
};

/**
 * Renders a PR's review Findings (Wave 6, M1), grouped by severity. Each finding
 * shows its category badge and its rationale; the rationale line REUSES the
 * guide's `GuideItemLine` so a code-anchored finding renders as a clickable jump
 * (severity-coloured) wired through the SAME `onOpenAnchor` →
 * `resolveScrollTarget` flow the Guide tab uses. A baseline finding with no
 * concrete file (repo-wide flag) renders as plain, non-clickable text.
 */
export function FindingsSectionView({
	findings,
	onOpenAnchor,
}: FindingsSectionViewProps) {
	const groups = SEVERITY_ORDER.map((severity) => ({
		severity,
		items: findings.filter((f) => f.severity === severity),
	})).filter((g) => g.items.length > 0);

	return (
		<div className="flex flex-col gap-4 p-3">
			{groups.map((group) => (
				<section key={group.severity} className="space-y-1.5">
					<h3 className="cursor-text select-text text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{SEVERITY_LABEL[group.severity]} ({group.items.length})
					</h3>
					<ul className="space-y-2">
						{group.items.map((finding) => (
							<li key={finding.id} className="flex items-start gap-2 text-sm">
								<span
									className={cn(
										"mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
									)}
								>
									{CATEGORY_LABEL[finding.category]}
								</span>
								<div className="min-w-0 text-foreground">
									<GuideItemLine
										item={{
											text: finding.rationale,
											// Repo-wide baseline flags carry an empty file — render those
											// as plain text (no jump target).
											anchor: finding.anchor.file ? finding.anchor : undefined,
											severity: finding.severity,
										}}
										onOpenAnchor={onOpenAnchor}
									/>
								</div>
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}
