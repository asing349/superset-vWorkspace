import { cn } from "@superset/ui/utils";
import type { ConsolidationProposal } from "../../utils/practiceReview";

type LineDiff = ConsolidationProposal["diff"];

const OP_CLASS: Record<LineDiff["lines"][number]["op"], string> = {
	add: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
	remove: "bg-red-500/10 text-red-800 dark:text-red-200 line-through/0",
	equal: "text-muted-foreground",
};

const OP_PREFIX: Record<LineDiff["lines"][number]["op"], string> = {
	add: "+",
	remove: "-",
	equal: " ",
};

/**
 * Render a current→proposed line diff for the consolidation review. Read-only;
 * editing happens in the textarea alongside it.
 */
export function PracticeDiff({ diff }: { diff: LineDiff }) {
	if (diff.lines.length === 0) {
		return (
			<p className="p-3 text-xs text-muted-foreground select-text">
				No differences — the proposed practice matches the current doc.
			</p>
		);
	}

	return (
		<div className="flex flex-col">
			<div className="border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
				<span className="text-emerald-600 dark:text-emerald-400">
					+{diff.added}
				</span>{" "}
				<span className="text-red-600 dark:text-red-400">-{diff.removed}</span>
			</div>
			<pre className="overflow-x-auto p-0 font-mono text-[11px] leading-relaxed select-text">
				{diff.lines.map((line, i) => (
					<div
						// Diff lines have no stable id; index is correct for a static render.
						key={`${line.op}-${i}-${line.text}`}
						className={cn("px-3", OP_CLASS[line.op])}
					>
						<span className="select-none opacity-60">
							{OP_PREFIX[line.op]}{" "}
						</span>
						{line.text || " "}
					</div>
				))}
			</pre>
		</div>
	);
}
