import { Button } from "@superset/ui/button";
import { LuLayers } from "react-icons/lu";
import type { UsePracticeConsolidationResult } from "../../hooks/usePracticeConsolidation";
import { PRACTICE_SCOPES } from "../../utils/practiceReview";

/**
 * The two consolidation buttons that mount in the Memory header's actions slot
 * when the Practice section is active: "Update this project's coding practice"
 * (project) and "Update my global coding practice" (global). Per the Decision
 * Log, global practice is reached ONLY via this button (PR-time capture stays
 * project-scoped).
 */
export function PracticeActions({
	consolidation,
}: {
	consolidation: UsePracticeConsolidationResult;
}) {
	const { propose, isProposing, activeScope } = consolidation;
	return (
		<>
			{PRACTICE_SCOPES.map(({ scope, label }) => (
				<Button
					key={scope}
					variant={scope === "project" ? "secondary" : "ghost"}
					size="xs"
					onClick={() => propose(scope)}
					disabled={isProposing}
					title={label}
				>
					<LuLayers className="size-3.5" />
					{scope === "project" ? "Project" : "Global"}
					{activeScope === scope ? " •" : ""}
				</Button>
			))}
		</>
	);
}
