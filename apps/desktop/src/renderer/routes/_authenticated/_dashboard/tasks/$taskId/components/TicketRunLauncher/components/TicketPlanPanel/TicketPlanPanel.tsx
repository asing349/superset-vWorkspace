import { Button } from "@superset/ui/button";
import { Textarea } from "@superset/ui/textarea";
import { useId } from "react";
import type { useTicketPlan } from "../../../../hooks/useTicketPlan/useTicketPlan";

export function TicketPlanPanel({
	plan,
	disabled,
}: {
	plan: ReturnType<typeof useTicketPlan>;
	disabled: boolean;
}) {
	const id = useId();
	return (
		<section
			aria-label="Independent plan review"
			className="rounded-md border p-3 space-y-2"
		>
			<h3 className="text-sm font-medium">
				Plan first · independent agent review
			</h3>
			<p className="text-xs text-muted-foreground">
				A Codex planner proposes the work. A separate Codex session reviews it
				before execution. Connect Codex in Settings → Integrations. Runs stop at
				PR creation; they never merge.
			</p>
			<Button
				size="sm"
				variant="outline"
				disabled={disabled || plan.pending}
				onClick={() => {
					void plan.prepare();
				}}
			>
				{plan.pending ? "Planning / reviewing…" : "Prepare and review plan"}
			</Button>
			{plan.record && (
				<>
					<label htmlFor={id} className="block text-xs font-medium">
						Implementation plan
					</label>
					<Textarea
						id={id}
						value={plan.content}
						onChange={(event) => plan.setContent(event.target.value)}
						disabled={plan.pending}
						className="min-h-40 text-xs"
					/>
					<p className="text-xs font-medium" aria-live="polite">
						{plan.approvedPlanId
							? "Approved by independent reviewer"
							: plan.record.state === "consumed"
								? "Plan approval used — prepare a new plan before another run"
								: plan.record.state === "escalated"
									? "Needs discussion with Ajit — execution blocked"
									: plan.record.state === "revise"
										? "Revision requested — execution blocked"
										: "Plan needs review — execution blocked"}
					</p>
					<ul className="text-xs list-disc pl-4 select-text cursor-text">
						{plan.record.feedback.map((item, index) => (
							<li key={`${index}-${item}`}>{item}</li>
						))}
					</ul>
					<Button
						size="sm"
						variant="outline"
						disabled={
							disabled ||
							plan.pending ||
							!plan.content.trim() ||
							plan.record.reviewAttempts >= 3 ||
							plan.record.state === "consumed"
						}
						onClick={() => {
							void plan.review();
						}}
					>
						Review revised plan
					</Button>
					<p className="text-xs text-muted-foreground">
						Editing the plan or changing the ticket context, repos or executor
						requires another review. After three unresolved reviews, discuss the
						feedback and prepare a new plan.
					</p>
				</>
			)}
			{plan.error && (
				<p
					role="alert"
					className="text-xs text-destructive select-text cursor-text"
				>
					{plan.error}
				</p>
			)}
		</section>
	);
}
