import { Button } from "@superset/ui/button";
import { Textarea } from "@superset/ui/textarea";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MarkdownEditor } from "renderer/components/MarkdownEditor";
import {
	buildTicketContext,
	type TicketContextSource,
} from "../../../../utils/buildTicketContext";

/**
 * No-cap retrieval: ask the host `memory.retrieve` for the maximum the
 * procedure allows so the draft is never truncated for review (B-plan: no token
 * cap on the assembled context — the model's context window is the only bound).
 */
const NO_CAP_RETRIEVE_LIMITS = {
	topKPlaybooks: 50,
	topKIndexSlices: 50,
	maxTokens: 20_000,
} as const;

interface TicketContextBuilderInnerProps {
	ticket: TicketContextSource;
	/**
	 * Host project scope for memory retrieval. B2 is project-agnostic (a Linear
	 * ticket is org-scoped); pass `null` for global + unscoped memory. Repo
	 * scoping is B4's job.
	 */
	projectId: string | null;
}

export function TicketContextBuilderInner({
	ticket,
	projectId,
}: TicketContextBuilderInnerProps) {
	const [developerInput, setDeveloperInput] = useState("");
	const [draft, setDraft] = useState<string | null>(null);
	const [intent, setIntent] = useState<string | null>(null);

	// The retrieval intent the host ranks memory against: ticket title +
	// description + the developer's optional input. `enabled` gates on a
	// generate action (intent !== null) so we don't fetch on mount.
	const retrieveQuery = workspaceTrpc.memory.retrieve.useQuery(
		{
			projectId,
			intent: intent ?? "",
			...NO_CAP_RETRIEVE_LIMITS,
		},
		{ enabled: intent !== null, staleTime: 5_000 },
	);

	const ticketIntent = useMemo(() => {
		const parts = [ticket.title, ticket.description ?? "", developerInput];
		return parts
			.map((part) => part.trim())
			.filter(Boolean)
			.join("\n\n");
	}, [ticket.title, ticket.description, developerInput]);

	const handleGenerate = useCallback(() => {
		setIntent(ticketIntent);
	}, [ticketIntent]);

	// Cache-first: render whatever the bundle returns; assemble the draft when
	// retrieval settles (or immediately with a bundle-less draft on error so the
	// developer still gets the ticket + their input).
	useEffect(() => {
		if (intent === null) return;
		if (retrieveQuery.isLoading) return;
		setDraft(
			buildTicketContext({
				ticket,
				developerInput,
				bundle: retrieveQuery.data ?? null,
			}),
		);
	}, [
		intent,
		retrieveQuery.isLoading,
		retrieveQuery.data,
		ticket,
		developerInput,
	]);

	const isGenerating = intent !== null && retrieveQuery.isLoading;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1.5">
				<label
					htmlFor="ticket-context-input"
					className="text-sm font-medium text-foreground"
				>
					Add any context for this ticket?{" "}
					<span className="font-normal text-muted-foreground">(optional)</span>
				</label>
				<Textarea
					id="ticket-context-input"
					value={developerInput}
					onChange={(event) => setDeveloperInput(event.target.value)}
					placeholder="Anything the agent should know — constraints, links, prior attempts. Leave empty to use the ticket + memory only."
					className="min-h-20"
				/>
			</div>

			<div className="flex items-center gap-2">
				<Button size="sm" onClick={handleGenerate} disabled={isGenerating}>
					{isGenerating ? "Building draft..." : "Generate draft context"}
				</Button>
				{retrieveQuery.isError && (
					<span className="text-xs text-destructive select-text cursor-text">
						Couldn't pull memory; showing the ticket and your input only.
					</span>
				)}
			</div>

			{draft !== null && (
				<div className="rounded-md border border-border">
					<MarkdownEditor
						content={draft}
						placeholder="Draft context..."
						features={{
							slashCommand: false,
							emoji: false,
							fileMention: false,
							bubbleMenu: true,
						}}
					/>
				</div>
			)}
		</div>
	);
}
