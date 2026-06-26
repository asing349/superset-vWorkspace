import { cn } from "@superset/ui/utils";
import type { GuideAnchor, GuideItem, PrReviewGuide } from "../../types";

interface GuideSectionViewProps {
	guide: PrReviewGuide;
	/** Jump to a code anchor (M5 wires the scroll/open). */
	onOpenAnchor?: (anchor: GuideAnchor) => void;
}

const SEVERITY_CLASS: Record<NonNullable<GuideItem["severity"]>, string> = {
	info: "text-muted-foreground",
	warning: "text-amber-600",
	danger: "text-red-600",
};

/**
 * Renders a generated `PrReviewGuide` — its ordered sections and each section's
 * claims (Wave 5, M2). Code-anchored claims render as clickable; the anchor
 * scroll/open is a no-op until M5 wires `onOpenAnchor` to the sibling Diff tab +
 * the editor. External-link claims (`href`) open in a new tab.
 *
 * M2 never produces a guide (the generator is M4), so this view is exercised
 * once M4 lands; it is built now so the Guide tab is render-ready and the M5
 * anchor wiring has a clear seam (`onOpenAnchor`).
 */
export function GuideSectionView({
	guide,
	onOpenAnchor,
}: GuideSectionViewProps) {
	return (
		<div className="flex flex-col gap-4 p-3">
			{guide.sections.map((section) => (
				<section key={section.id} className="space-y-1.5">
					<h3 className="cursor-text select-text text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{section.title}
					</h3>
					<ul className="space-y-1">
						{section.items.map((item, index) => (
							<li
								// Items have no stable id in the contract; index within a
								// section is stable for a given guide render.
								key={`${section.id}:${index}`}
								className="text-sm text-foreground"
							>
								<GuideItemLine item={item} onOpenAnchor={onOpenAnchor} />
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

/**
 * Renders one guide/finding claim line: a clickable anchored button (jumps to
 * the Diff tab via `onOpenAnchor`), an external link (`href`), or plain text —
 * with the severity colour applied. Exported so the wave-6 Findings view reuses
 * the EXACT anchored-item rendering + `onOpenAnchor` → `resolveScrollTarget`
 * flow rather than re-implementing it.
 */
export function GuideItemLine({
	item,
	onOpenAnchor,
}: {
	item: GuideItem;
	onOpenAnchor?: (anchor: GuideAnchor) => void;
}) {
	const severityClass = item.severity
		? SEVERITY_CLASS[item.severity]
		: undefined;

	if (item.anchor) {
		const anchor = item.anchor;
		return (
			<button
				type="button"
				onClick={() => onOpenAnchor?.(anchor)}
				className={cn(
					"text-left underline-offset-2 hover:underline",
					severityClass,
				)}
				title={anchor.file}
			>
				<span className="cursor-text select-text">{item.text}</span>
			</button>
		);
	}

	if (item.href) {
		return (
			<a
				href={item.href}
				target="_blank"
				rel="noreferrer"
				className={cn("underline-offset-2 hover:underline", severityClass)}
			>
				{item.text}
			</a>
		);
	}

	return (
		<span className={cn("cursor-text select-text", severityClass)}>
			{item.text}
		</span>
	);
}
