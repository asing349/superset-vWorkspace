import { Button } from "@superset/ui/button";
import { Textarea } from "@superset/ui/textarea";
import { useEffect, useState } from "react";
import { LuCheck, LuRotateCcw, LuX } from "react-icons/lu";
import type { UsePracticeConsolidationResult } from "../../hooks/usePracticeConsolidation";
import { canAccept, proposalHasChanges } from "../../utils/practiceReview";
import { PracticeDiff } from "../PracticeDiff";

interface PracticeSectionProps {
	consolidation: UsePracticeConsolidationResult;
}

/**
 * The consolidation review body. When no proposal is active it shows the
 * current practice doc + a hint; once a scope button (header) is clicked it
 * shows the editable proposed doc, the current→proposed diff, and Accept /
 * Cancel / Revert. The two scope buttons live in the header-actions slot.
 */
export function PracticeSection({ consolidation }: PracticeSectionProps) {
	const {
		proposal,
		activeScope,
		isAccepting,
		isReverting,
		revertAvailable,
		latestProvenance,
		practiceContent,
		accept,
		revert,
		cancel,
	} = consolidation;

	const [edited, setEdited] = useState<string>("");

	// Seed the editor when a new proposal arrives; reset when it clears.
	useEffect(() => {
		setEdited(proposal?.proposedDoc ?? "");
	}, [proposal]);

	if (!proposal || !activeScope) {
		const projectDoc = practiceContent("project");
		const globalDoc = practiceContent("global");
		return (
			<div className="flex h-full flex-col gap-4 overflow-y-auto p-4 select-text">
				<p className="text-xs text-muted-foreground">
					Consolidate confirmed playbooks into durable coding-practice rules.
					Use a button above to propose an update; you'll review a diff before
					anything is written.
				</p>
				<CurrentDoc
					label="Project practice (AGENTS.md managed block)"
					content={projectDoc}
				/>
				<CurrentDoc
					label="Global practice (~/.superset/practice.md)"
					content={globalDoc}
				/>
				{revertAvailable ? (
					<div>
						<Button
							variant="outline"
							size="xs"
							onClick={revert}
							disabled={isReverting}
						>
							<LuRotateCcw className="size-3.5" />
							Revert last change
						</Button>
					</div>
				) : null}
			</div>
		);
	}

	const acceptEnabled =
		canAccept({ proposal, editedContent: edited }) && !isAccepting;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
				<span className="text-xs font-medium text-foreground">
					Reviewing {activeScope === "global" ? "global" : "project"} practice
				</span>
				{latestProvenance ? (
					<span className="truncate text-[11px] text-muted-foreground">
						· current: {latestProvenance}
					</span>
				) : null}
				<span className="ml-auto truncate text-[11px] text-muted-foreground">
					{proposal.provenance}
				</span>
			</div>

			<div className="flex min-h-0 flex-1">
				<div className="flex w-1/2 min-w-[16rem] flex-col border-r border-border">
					<div className="shrink-0 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						Edit proposed practice
					</div>
					<Textarea
						value={edited}
						onChange={(e) => setEdited(e.target.value)}
						spellCheck={false}
						className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-[11px] focus-visible:ring-0"
					/>
				</div>
				<div className="flex w-1/2 min-w-[16rem] flex-col overflow-y-auto">
					<div className="shrink-0 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						{proposalHasChanges(proposal)
							? "Changes vs current"
							: "No changes vs current"}
					</div>
					<PracticeDiff diff={proposal.diff} />
				</div>
			</div>

			<div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
				<Button
					variant="secondary"
					size="xs"
					onClick={() => accept(edited)}
					disabled={!acceptEnabled}
				>
					<LuCheck className="size-3.5" />
					Accept
				</Button>
				<Button
					variant="ghost"
					size="xs"
					onClick={cancel}
					disabled={isAccepting}
				>
					<LuX className="size-3.5" />
					Cancel
				</Button>
				{revertAvailable ? (
					<Button
						variant="ghost"
						size="xs"
						className="ml-auto"
						onClick={revert}
						disabled={isReverting}
					>
						<LuRotateCcw className="size-3.5" />
						Revert last
					</Button>
				) : null}
			</div>
		</div>
	);
}

function CurrentDoc({ label, content }: { label: string; content: string }) {
	return (
		<section className="flex flex-col gap-1">
			<h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</h4>
			{content.trim().length > 0 ? (
				<pre className="overflow-x-auto rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground whitespace-pre-wrap">
					{content}
				</pre>
			) : (
				<p className="text-xs text-muted-foreground">Not consolidated yet.</p>
			)}
		</section>
	);
}
