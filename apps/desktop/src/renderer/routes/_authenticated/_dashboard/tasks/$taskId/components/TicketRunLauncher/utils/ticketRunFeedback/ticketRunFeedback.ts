import type { TicketRunStartResult } from "../../../../hooks/useTicketRunStart";

export interface TicketRunFeedback {
	severity: "success" | "warning" | "error";
	message: string;
	runs: (TicketRunStartResult["runs"][number] & { projectName: string })[];
}

/** Dispatch success says nothing about subsequent agent work or PR creation. */
export function ticketRunFeedback({
	result,
	projects,
}: {
	result: TicketRunStartResult;
	projects: { id: string; name: string }[];
}): TicketRunFeedback {
	const runs = result.runs.map((run) => ({
		...run,
		projectName:
			projects.find((project) => project.id === run.projectId)?.name ??
			run.projectId,
	}));
	const dispatched = runs.filter((run) => run.status === "dispatched").length;
	const failed = runs.filter((run) => run.status === "failed").length;
	const pending = runs.length - dispatched - failed;
	if (runs.length === 0) {
		return {
			severity: "error",
			message:
				"No repository run results returned. Check workspaces before retrying.",
			runs,
		};
	}
	if (dispatched === runs.length) {
		return {
			severity: "success",
			message: `Run dispatched for ${dispatched} of ${runs.length} repos.`,
			runs,
		};
	}
	if (failed === runs.length) {
		return {
			severity: "error",
			message: `Dispatch failed for all ${runs.length} repos.`,
			runs,
		};
	}
	return {
		severity: "warning",
		message: `Dispatched: ${dispatched}; failed: ${failed}; pending: ${pending}.`,
		runs,
	};
}
