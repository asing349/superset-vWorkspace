import { cn } from "@superset/ui/utils";
import { LuTrash2 } from "react-icons/lu";
import type { Playbook } from "../../utils/memoryFormat";
import { AreaChips } from "../AreaChips";
import { StatusBadge } from "../StatusBadge";

interface PlaybookListProps {
	playbooks: Playbook[];
	selectedId: string | null;
	isLoading: boolean;
	onSelect: (id: string) => void;
	onForget: (playbook: Pick<Playbook, "id" | "intent">) => void;
}

/**
 * The Playbook browser list (left column). Cache-first: renders whatever rows
 * exist; the loading vs empty distinction is only made when there are no rows.
 */
export function PlaybookList({
	playbooks,
	selectedId,
	isLoading,
	onSelect,
	onForget,
}: PlaybookListProps) {
	if (playbooks.length === 0) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground select-text">
				{isLoading
					? "Loading playbooks…"
					: "No playbooks yet. Open a PR and click “Save to memory” to capture one."}
			</div>
		);
	}

	return (
		<ul className="flex flex-col">
			{playbooks.map((playbook) => (
				<li key={playbook.id}>
					<button
						type="button"
						onClick={() => onSelect(playbook.id)}
						className={cn(
							"group flex w-full flex-col gap-1.5 border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-accent/50",
							selectedId === playbook.id && "bg-accent",
						)}
					>
						<div className="flex items-start gap-2">
							<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
								{playbook.intent}
							</span>
							<StatusBadge status={playbook.status} />
							<button
								type="button"
								aria-label={`Forget playbook: ${playbook.intent}`}
								onClick={(event) => {
									event.stopPropagation();
									onForget({ id: playbook.id, intent: playbook.intent });
								}}
								className="shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
							>
								<LuTrash2 className="size-3.5" />
							</button>
						</div>
						<AreaChips areas={playbook.areaTags} max={4} />
					</button>
				</li>
			))}
		</ul>
	);
}
