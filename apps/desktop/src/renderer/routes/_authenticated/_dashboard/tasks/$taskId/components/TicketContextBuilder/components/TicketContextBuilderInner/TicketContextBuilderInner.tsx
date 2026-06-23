import { alert } from "@superset/ui/atoms/Alert";
import { Button } from "@superset/ui/button";
import { toast } from "@superset/ui/sonner";
import { Textarea } from "@superset/ui/textarea";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HiCheckCircle } from "react-icons/hi2";
import { MarkdownEditor } from "renderer/components/MarkdownEditor";
import type { UseTicketContextApprovalResult } from "../../../../hooks/useTicketContextApproval";
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
	 * Host project scope = the PRIMARY repo's projectId (from B4). Memory
	 * retrieval is ranked against it (null = global/unscoped), and it is the
	 * `(projectId, taskId)` key the approved context is stored under.
	 */
	projectId: string | null;
	/** Shared approval state (the single gate) — read + persisted here. */
	approval: UseTicketContextApprovalResult;
}

export function TicketContextBuilderInner({
	ticket,
	projectId,
	approval,
}: TicketContextBuilderInnerProps) {
	const [developerInput, setDeveloperInput] = useState("");
	const [intent, setIntent] = useState<string | null>(null);

	// SEPARATED state (fixes the B2 regenerate-clobbers-edits coupling):
	//  - `editableContent` is the developer's working copy — what gets approved.
	//    It is NEVER silently overwritten by typing in the context box.
	//  - regeneration replaces it only via the explicit, warned "Regenerate" path.
	const [editableContent, setEditableContent] = useState<string | null>(null);
	// Re-key the editor so a programmatic content swap (generate/regenerate/load
	// approved) remounts it; plain edits keep the same key (no remount).
	const [editorEpoch, setEditorEpoch] = useState(0);

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

	const setContent = useCallback((next: string) => {
		setEditableContent(next);
		setEditorEpoch((epoch) => epoch + 1);
	}, []);

	// Reopen / authoritative load: once an approved context exists, it is the
	// source of truth — show it (not a fresh draft) when we have no working copy.
	useEffect(() => {
		if (editableContent !== null) return;
		if (approval.approvedContent !== null) {
			setContent(approval.approvedContent);
		}
	}, [approval.approvedContent, editableContent, setContent]);

	// Assemble the generated draft when retrieval settles. Only the explicit
	// generate/regenerate path sets `intent`, so typing in the context box can
	// never trigger this — manual edits are safe.
	useEffect(() => {
		if (intent === null) return;
		if (retrieveQuery.isLoading) return;
		setContent(
			buildTicketContext({
				ticket,
				developerInput,
				bundle: retrieveQuery.data ?? null,
			}),
		);
		setIntent(null);
	}, [
		intent,
		retrieveQuery.isLoading,
		retrieveQuery.data,
		ticket,
		developerInput,
		setContent,
	]);

	const runGenerate = useCallback(() => {
		setIntent(ticketIntent);
	}, [ticketIntent]);

	const handleGenerate = useCallback(() => {
		// Warn before discarding edited/approved content; first generate is silent.
		if (editableContent !== null) {
			alert({
				title: "Replace the current context?",
				description:
					"Regenerating rebuilds the draft from the ticket, your input, and memory — this replaces the current edited context.",
				actions: [
					{ label: "Regenerate", variant: "destructive", onClick: runGenerate },
					{ label: "Cancel", variant: "ghost" },
				],
			});
			return;
		}
		runGenerate();
	}, [editableContent, runGenerate]);

	const handleEditorChange = useCallback((markdown: string) => {
		setEditableContent(markdown);
	}, []);

	const handleApprove = useCallback(async () => {
		if (editableContent === null) return;
		try {
			await approval.approve({ content: editableContent });
			toast.success("Context approved");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't approve the context",
			);
		}
	}, [approval, editableContent]);

	const isGenerating = intent !== null && retrieveQuery.isLoading;
	const isApproved =
		approval.approvedContent !== null &&
		approval.approvedContent === editableContent;

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

			<div className="flex flex-wrap items-center gap-2">
				<Button
					size="sm"
					variant={editableContent === null ? "default" : "outline"}
					onClick={handleGenerate}
					disabled={isGenerating}
				>
					{isGenerating
						? "Building draft..."
						: editableContent === null
							? "Generate draft context"
							: "Regenerate"}
				</Button>
				{retrieveQuery.isError && (
					<span className="text-xs text-destructive select-text cursor-text">
						Couldn't pull memory; showing the ticket and your input only.
					</span>
				)}
			</div>

			{editableContent !== null && (
				<div className="flex flex-col gap-2">
					<div className="rounded-md border border-border">
						<MarkdownEditor
							key={editorEpoch}
							content={editableContent}
							onChange={handleEditorChange}
							placeholder="Draft context..."
							features={{
								slashCommand: false,
								emoji: false,
								fileMention: false,
								bubbleMenu: true,
							}}
						/>
					</div>
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							onClick={handleApprove}
							disabled={approval.isApproving || isApproved}
						>
							{approval.isApproving
								? "Approving..."
								: isApproved
									? "Approved"
									: "Approve context"}
						</Button>
						{isApproved ? (
							<span className="flex items-center gap-1 text-xs text-emerald-500">
								<HiCheckCircle className="size-3.5" />
								Approved — this context will drive the run
							</span>
						) : (
							approval.approvedContent !== null && (
								<span className="text-xs text-muted-foreground">
									Edited since last approval — approve to save changes
								</span>
							)
						)}
					</div>
				</div>
			)}
		</div>
	);
}
