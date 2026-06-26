import { Badge } from "@superset/ui/badge";
import { Button } from "@superset/ui/button";
import { LuCheck, LuScale, LuUndo2, LuX } from "react-icons/lu";
import { useBusinessRules } from "../../hooks/useBusinessRules";
import type { ObservedRule } from "../../types";
import { summarizeBusinessRules } from "../../utils/summarizeBusinessRules";

interface BusinessRulesSectionProps {
	/** The project whose observed business rules this curates. */
	projectId: string;
}

/**
 * Observed business rules curation (Wave 6, M6) — surfaced on each project's
 * Manage-context card. Shows the ACCEPTED rules (the compounding grounding the
 * reviewer wrote) plus PENDING proposals the reviewer inferred at review time,
 * each with explicit accept/revert curation. Rules are PROPOSED only during a
 * Review-PR run (never here); this is the curation surface. Reverted rules are
 * hidden (kept host-side for audit).
 */
export function BusinessRulesSection({ projectId }: BusinessRulesSectionProps) {
	const { rules, isLoading, accept, revert, pendingRuleId } = useBusinessRules({
		projectId,
	});
	const summary = summarizeBusinessRules(rules);

	// Hide reverted rules; show pending proposals first (they need curation).
	const visible = rules
		.filter((rule) => rule.state !== "reverted")
		.sort((a, b) => rankRule(a) - rankRule(b));

	return (
		<div className="flex flex-col gap-1.5 border-t border-border pt-2">
			<div className="flex items-center gap-2">
				<LuScale className="size-3.5 text-muted-foreground" />
				<span className="text-xs font-medium text-foreground">
					Observed business rules
				</span>
				<Badge variant="secondary" className="text-[10px]">
					{summary.badgeLabel}
				</Badge>
			</div>

			{isLoading && rules.length === 0 ? (
				<p className="cursor-text select-text text-xs text-muted-foreground">
					Loading rules…
				</p>
			) : null}

			{!isLoading && visible.length === 0 ? (
				<p className="cursor-text select-text text-xs text-muted-foreground">
					No rules yet — they accumulate as you review this project's PRs, then
					you curate which become active grounding.
				</p>
			) : null}

			{visible.length > 0 ? (
				<ul className="flex flex-col gap-1">
					{visible.map((rule) => (
						<BusinessRuleRow
							key={rule.id}
							rule={rule}
							busy={pendingRuleId === rule.id}
							onAccept={() => accept(rule.id)}
							onRevert={() => revert(rule.id)}
						/>
					))}
				</ul>
			) : null}
		</div>
	);
}

/** Pending proposals sort before accepted rules (they need attention first). */
function rankRule(rule: ObservedRule): number {
	return rule.state === "proposed" ? 0 : 1;
}

interface BusinessRuleRowProps {
	rule: ObservedRule;
	busy: boolean;
	onAccept: () => void;
	onRevert: () => void;
}

function BusinessRuleRow({
	rule,
	busy,
	onAccept,
	onRevert,
}: BusinessRuleRowProps) {
	const isProposed = rule.state === "proposed";
	return (
		<li className="flex items-start gap-2 rounded border border-border/60 bg-muted/30 px-2 py-1.5">
			<div className="min-w-0 flex-1">
				<p className="cursor-text select-text text-xs text-foreground">
					{rule.rule}
				</p>
				<div className="mt-0.5 flex flex-wrap items-center gap-1">
					<Badge
						variant={isProposed ? "outline" : "default"}
						className="text-[10px]"
					>
						{isProposed ? "Pending" : "Active"}
					</Badge>
					<span className="cursor-text select-text text-[10px] text-muted-foreground">
						{rule.category}
						{rule.sourcePrNumber !== null
							? ` · PR #${rule.sourcePrNumber}`
							: ""}
					</span>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-1">
				{isProposed ? (
					<>
						<Button
							size="xs"
							variant="secondary"
							onClick={onAccept}
							disabled={busy}
							title="Accept — ground later reviews on this rule"
						>
							<LuCheck className="size-3.5" />
						</Button>
						<Button
							size="xs"
							variant="ghost"
							onClick={onRevert}
							disabled={busy}
							title="Dismiss this proposal"
						>
							<LuX className="size-3.5" />
						</Button>
					</>
				) : (
					<Button
						size="xs"
						variant="ghost"
						onClick={onRevert}
						disabled={busy}
						title="Revert — stop grounding reviews on this rule"
					>
						<LuUndo2 className="size-3.5" />
					</Button>
				)}
			</div>
		</li>
	);
}
