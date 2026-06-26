import { Button } from "@superset/ui/button";
import { toast } from "@superset/ui/sonner";
import { Textarea } from "@superset/ui/textarea";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HiCheckCircle } from "react-icons/hi2";
// Reuse the cloud-page launcher + approval gate WITHOUT touching the protected
// cloud task page (its imports are unchanged). The host pipeline + the launcher
// contract are already fully source-agnostic, so a `local:` unifiedId run works
// identically end-to-end — this is purely the deferred renderer surface (M4 → M5).
import { TicketRunLauncher } from "renderer/routes/_authenticated/_dashboard/tasks/$taskId/components/TicketRunLauncher";
import { useTicketContextApproval } from "renderer/routes/_authenticated/_dashboard/tasks/$taskId/hooks/useTicketContextApproval";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { buildLocalTicketContextDraft } from "./buildLocalTicketContextDraft";

// Wave-7 M5 — launch the wave-4 ticket→PR run from a `local:` ticket in the
// unified list. Mirrors the cloud task page's wiring (lifted primary repo →
// approval keyed `(projectId, taskId)` → gated launcher), but:
//  - `taskId` and `unifiedId` are BOTH the source-tagged `local:<issueId>` so the
//    host routes run→PR writeback to the local Linear source (direct, M1 token).
//  - context is a plain editable draft (no memory retrieval) since the
//    integrations route has no WorkspaceClientProvider.
// The cloud path is unchanged: cloud tickets keep launching from the cloud page.

interface LocalTicketRunPanelProps {
	/** Source-tagged unified id of the local ticket (`local:<issueId>`). */
	unifiedId: string;
	/** Linear issue key, e.g. "ENG-123". */
	identifier: string;
	title: string;
	description: string | null;
	/** Collapse the panel. */
	onClose: () => void;
}

export function LocalTicketRunPanel({
	unifiedId,
	identifier,
	title,
	description,
	onClose,
}: LocalTicketRunPanelProps) {
	const { activeHostUrl } = useLocalHostService();
	const [primaryProjectId, setPrimaryProjectId] = useState<string | null>(null);

	// The approval gate is keyed `(primaryProjectId, taskId)`. For a local run the
	// taskId IS the unified id (`local:<issueId>`) — the same value the launcher
	// stores as the writeback handle — so the gate and the run agree on the source.
	const approval = useTicketContextApproval({
		hostUrl: activeHostUrl,
		projectId: primaryProjectId,
		taskId: unifiedId,
	});

	const draftDefault = useMemo(
		() => buildLocalTicketContextDraft({ identifier, title, description }),
		[identifier, title, description],
	);

	const [content, setContent] = useState(draftDefault);
	const [edited, setEdited] = useState(false);

	// Authoritative load: once an approved context exists, prefer it as the
	// working copy — unless the developer has edited since opening the panel.
	useEffect(() => {
		if (edited) return;
		if (approval.approvedContent !== null) setContent(approval.approvedContent);
	}, [approval.approvedContent, edited]);

	const handleChange = useCallback(
		(event: React.ChangeEvent<HTMLTextAreaElement>) => {
			setContent(event.target.value);
			setEdited(true);
		},
		[],
	);

	const handleApprove = useCallback(async () => {
		try {
			await approval.approve({ content });
			toast.success("Context approved");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't approve the context",
			);
		}
	}, [approval, content]);

	const isApproved =
		approval.approvedContent !== null && approval.approvedContent === content;
	const needsRepo = primaryProjectId === null;

	return (
		<div className="mt-2 rounded-md border border-border bg-muted/30 p-3">
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs font-medium text-foreground">
					Run → PR · {identifier}
				</span>
				<Button variant="ghost" size="sm" className="h-6" onClick={onClose}>
					Close
				</Button>
			</div>

			<div className="mt-2 flex flex-col gap-1.5">
				<span className="text-xs font-medium text-foreground">
					Context for the agent
				</span>
				<Textarea
					aria-label="Agent context for this local ticket"
					value={content}
					onChange={handleChange}
					className="min-h-24 text-xs"
				/>
				<div className="flex items-center gap-2">
					<Button
						size="sm"
						className="h-7"
						onClick={() => {
							void handleApprove();
						}}
						disabled={approval.isApproving || isApproved || needsRepo}
						title={needsRepo ? "Select a repo below first" : undefined}
					>
						{approval.isApproving
							? "Approving…"
							: isApproved
								? "Approved"
								: "Approve context"}
					</Button>
					{isApproved ? (
						<span className="flex items-center gap-1 text-[11px] text-emerald-500">
							<HiCheckCircle className="size-3.5" />
							Approved — this context will drive the run
						</span>
					) : needsRepo ? (
						<span className="text-[11px] text-muted-foreground">
							Select a repo below, then approve.
						</span>
					) : (
						approval.approvedContent !== null && (
							<span className="text-[11px] text-muted-foreground">
								Edited since last approval — approve to save changes.
							</span>
						)
					)}
				</div>
			</div>

			<div className="mt-3">
				<TicketRunLauncher
					taskId={unifiedId}
					unifiedId={unifiedId}
					ticketKey={identifier}
					onPrimaryProjectChange={setPrimaryProjectId}
					approval={approval}
				/>
			</div>
		</div>
	);
}
