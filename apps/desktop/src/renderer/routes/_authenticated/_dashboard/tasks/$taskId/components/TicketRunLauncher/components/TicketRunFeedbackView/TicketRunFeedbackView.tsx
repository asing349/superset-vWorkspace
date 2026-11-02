import type { TicketRunFeedback } from "../../utils/ticketRunFeedback/ticketRunFeedback";

export function TicketRunFeedbackView({
	feedback,
}: {
	feedback: TicketRunFeedback;
}) {
	return (
		<section
			aria-label="Repository dispatch results"
			aria-live="polite"
			className="rounded-md border p-3 text-xs select-text cursor-text"
		>
			<p className="font-medium">{feedback.message}</p>
			<p className="mt-1 text-muted-foreground">
				Dispatch results only. Agent work and PR creation are not confirmed.
			</p>
			<ul className="mt-2 space-y-2">
				{feedback.runs.map((run) => (
					<li key={run.runId} className="break-words">
						<p>
							<strong>{run.projectName}</strong>:{" "}
							{run.status === "dispatched"
								? "Dispatched"
								: run.status === "failed"
									? "Failed"
									: "Pending"}
						</p>
						{run.error && (
							<p className="whitespace-pre-wrap text-destructive">
								{run.error}
							</p>
						)}
						{run.status === "failed" && !run.error && (
							<p className="text-destructive">No error details returned.</p>
						)}
						{run.branch && <p>Branch: {run.branch}</p>}
						<details className="text-muted-foreground">
							<summary>Run details</summary>
							<p>Run: {run.runId}</p>
							<p>Project: {run.projectId}</p>
							{run.workspaceId && <p>Workspace: {run.workspaceId}</p>}
						</details>
					</li>
				))}
			</ul>
		</section>
	);
}
