import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@superset/ui/alert-dialog";
import { Button } from "@superset/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useState } from "react";
import { VscGitMerge } from "react-icons/vsc";
import type { PrTarget } from "../../../../utils/parsePrTarget";

type MergeMethod = "merge" | "squash" | "rebase";

const MERGE_METHODS: readonly { value: MergeMethod; label: string }[] = [
	{ value: "squash", label: "Squash and merge" },
	{ value: "merge", label: "Create a merge commit" },
	{ value: "rebase", label: "Rebase and merge" },
];

interface PrMergeButtonProps {
	/** The PR's GitHub coordinates (parsed from its URL); null hides the button. */
	target: PrTarget | null;
	prNumber: number;
	/** Refresh PR state after a successful merge (re-reads the PR list row). */
	onMerged?: () => void;
}

/**
 * The confirm-gated "Merge PR" control (Wave 6, M4) — the ONE merge surface in
 * the review pane. Reuses the shipped `github.mergePR` (`octokit.pulls.merge`),
 * copying the `PRStatusGroup` caller pattern (toast lifecycle + post-merge
 * refresh). Merge is an EXPLICIT, opt-in user action: it fires only from the
 * confirm dialog's "Confirm merge" click with a chosen strategy — the reviewer
 * never merges on its own (Assumption A4; the never-merge guardrail is
 * orchestrator-only and does not apply to this user-initiated UI merge).
 *
 * GitHub itself is the already-merged / closed guard: `octokit.pulls.merge`
 * rejects a non-open PR (405), surfaced as an error toast. The caller also hides
 * this button entirely once the PR is no longer open.
 */
export function PrMergeButton({
	target,
	prNumber,
	onMerged,
}: PrMergeButtonProps) {
	const [open, setOpen] = useState(false);
	const [method, setMethod] = useState<MergeMethod>("squash");

	const mergeMutation = workspaceTrpc.github.mergePR.useMutation({
		onMutate: () => {
			const toastId = toast.loading("Merging PR...");
			return { toastId };
		},
		onSuccess: (_data, _variables, context) => {
			toast.success("PR merged", { id: context?.toastId });
			onMerged?.();
		},
		onError: (error, _variables, context) => {
			toast.error(`Merge failed: ${error.message}`, { id: context?.toastId });
		},
	});

	if (!target) return null;

	const handleConfirm = () => {
		mergeMutation.mutate({
			owner: target.owner,
			repo: target.repo,
			pullNumber: prNumber,
			mergeMethod: method,
		});
	};

	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<Button
					size="xs"
					variant="secondary"
					className="h-auto shrink-0 gap-1 px-2 py-0.5 text-[11px]"
					disabled={mergeMutation.isPending}
				>
					<VscGitMerge className="size-3.5" />
					{mergeMutation.isPending ? "Merging…" : "Merge PR"}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent className="max-w-[400px]">
				<AlertDialogHeader>
					<AlertDialogTitle className="text-sm font-medium">
						Merge pull request #{prNumber}?
					</AlertDialogTitle>
					<AlertDialogDescription className="cursor-text select-text text-xs">
						This merges{" "}
						<span className="font-mono">
							{target.owner}/{target.repo}
						</span>{" "}
						#{prNumber} on GitHub. Choose how the commits land — the merge runs
						only when you confirm; the reviewer never merges on its own.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="py-1">
					<Select
						value={method}
						onValueChange={(value) => setMethod(value as MergeMethod)}
					>
						<SelectTrigger className="w-full text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{MERGE_METHODS.map((m) => (
								<SelectItem key={m.value} value={m.value} className="text-xs">
									{m.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel className="text-xs">Cancel</AlertDialogCancel>
					<AlertDialogAction
						className="gap-1 text-xs"
						disabled={mergeMutation.isPending}
						onClick={handleConfirm}
					>
						<VscGitMerge className="size-3.5" />
						Confirm merge
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
