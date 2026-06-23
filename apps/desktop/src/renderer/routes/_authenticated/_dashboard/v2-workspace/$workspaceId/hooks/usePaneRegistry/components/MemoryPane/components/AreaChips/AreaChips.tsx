import { cn } from "@superset/ui/utils";

/**
 * Render a Playbook's area tags as compact chips. `max` caps how many show
 * before collapsing the remainder into a "+N" chip (keeps list rows tidy).
 */
export function AreaChips({
	areas,
	max,
	className,
}: {
	areas: readonly string[];
	max?: number;
	className?: string;
}) {
	if (areas.length === 0) return null;
	const shown = max != null ? areas.slice(0, max) : areas;
	const overflow = areas.length - shown.length;

	return (
		<div className={cn("flex flex-wrap items-center gap-1", className)}>
			{shown.map((area) => (
				<span
					key={area}
					className="inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
				>
					{area}
				</span>
			))}
			{overflow > 0 ? (
				<span className="inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
					+{overflow}
				</span>
			) : null}
		</div>
	);
}
