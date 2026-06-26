import { Button } from "@superset/ui/button";
import { cn } from "@superset/ui/utils";
import { LuCheck, LuMessageSquarePlus } from "react-icons/lu";
import type { Finding, FindingAnchor } from "../../types";
import { GuideItemLine } from "../GuideSectionView";

interface FindingsSectionViewProps {
	findings: Finding[];
	/** Jump a finding's anchor to the sibling Diff tab (M1 → resolveScrollTarget). */
	onOpenAnchor?: (anchor: FindingAnchor) => void;
	/**
	 * Post ONE finding to the PR as a review comment (Wave 6, M3) — an explicit,
	 * per-finding click. Omit it to hide the post UI entirely (e.g. read-only
	 * contexts). Never bulk: there is no "post all".
	 */
	onPostComment?: (finding: Finding) => void;
	/** The id of the finding currently being posted (its button shows pending). */
	postingFindingId?: string | null;
	/** Whether posting is possible right now (PR coordinates + commit resolved). */
	canPost?: boolean;
}

/** Severity render order — most severe first — and its section heading. */
const SEVERITY_ORDER: readonly Finding["severity"][] = [
	"danger",
	"warning",
	"info",
];
const SEVERITY_LABEL: Record<Finding["severity"], string> = {
	danger: "Danger",
	warning: "Warning",
	info: "Info",
};

/** Human label for each finding category (shown as a badge per finding). */
const CATEGORY_LABEL: Record<Finding["category"], string> = {
	correctness: "correctness",
	"business-logic": "business logic",
	convention: "convention",
	security: "security",
	perf: "perf",
};

/**
 * Renders a PR's review Findings (Wave 6, M1), grouped by severity. Each finding
 * shows its category badge and its rationale; the rationale line REUSES the
 * guide's `GuideItemLine` so a code-anchored finding renders as a clickable jump
 * (severity-coloured) wired through the SAME `onOpenAnchor` →
 * `resolveScrollTarget` flow the Guide tab uses. A baseline finding with no
 * concrete file (repo-wide flag) renders as plain, non-clickable text.
 */
export function FindingsSectionView({
	findings,
	onOpenAnchor,
	onPostComment,
	postingFindingId,
	canPost = true,
}: FindingsSectionViewProps) {
	const groups = SEVERITY_ORDER.map((severity) => ({
		severity,
		items: findings.filter((f) => f.severity === severity),
	})).filter((g) => g.items.length > 0);

	return (
		<div className="flex flex-col gap-4 p-3">
			{groups.map((group) => (
				<section key={group.severity} className="space-y-1.5">
					<h3 className="cursor-text select-text text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{SEVERITY_LABEL[group.severity]} ({group.items.length})
					</h3>
					<ul className="space-y-2">
						{group.items.map((finding) => (
							<li key={finding.id} className="flex items-start gap-2 text-sm">
								<span
									className={cn(
										"mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
									)}
								>
									{CATEGORY_LABEL[finding.category]}
								</span>
								<div className="min-w-0 flex-1 text-foreground">
									<GuideItemLine
										item={{
											text: finding.rationale,
											// Repo-wide baseline flags carry an empty file — render those
											// as plain text (no jump target).
											anchor: finding.anchor.file ? finding.anchor : undefined,
											severity: finding.severity,
										}}
										onOpenAnchor={onOpenAnchor}
									/>
									{onPostComment ? (
										<FindingPostAction
											finding={finding}
											onPostComment={onPostComment}
											isPosting={postingFindingId === finding.id}
											canPost={canPost}
										/>
									) : null}
								</div>
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

/**
 * The per-finding "Post comment" control (Wave 6, M3). Explicit, per-finding,
 * opt-in — there is no "post all". A finding's `posted` state drives the
 * double-post guard: once posted it shows a "Posted" badge and the button
 * becomes a quieter "Post again" so a re-post takes a second, deliberate click.
 */
function FindingPostAction({
	finding,
	onPostComment,
	isPosting,
	canPost,
}: {
	finding: Finding;
	onPostComment: (finding: Finding) => void;
	isPosting: boolean;
	canPost: boolean;
}) {
	const posted = finding.state === "posted";
	return (
		<div className="mt-1 flex items-center gap-2">
			{posted ? (
				<>
					<span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
						<LuCheck className="size-3" />
						Posted
					</span>
					<Button
						size="xs"
						variant="ghost"
						className="h-auto px-1.5 py-0.5 text-[11px] text-muted-foreground"
						disabled={!canPost || isPosting}
						onClick={() => onPostComment(finding)}
					>
						{isPosting ? "Posting…" : "Post again"}
					</Button>
				</>
			) : (
				<Button
					size="xs"
					variant="secondary"
					className="h-auto px-2 py-0.5 text-[11px]"
					disabled={!canPost || isPosting}
					onClick={() => onPostComment(finding)}
				>
					<LuMessageSquarePlus className="size-3" />
					{isPosting ? "Posting…" : "Post comment"}
				</Button>
			)}
		</div>
	);
}
