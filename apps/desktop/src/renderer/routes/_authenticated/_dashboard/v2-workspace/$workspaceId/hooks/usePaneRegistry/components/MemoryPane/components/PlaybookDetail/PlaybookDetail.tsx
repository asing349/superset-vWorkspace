import { Button } from "@superset/ui/button";
import { LuExternalLink, LuTrash2, LuTriangleAlert } from "react-icons/lu";
import {
	confidenceLabel,
	isAntiPattern,
	type Playbook,
	provenanceLabel,
} from "../../utils/memoryFormat";
import { AreaChips } from "../AreaChips";
import { StatusBadge } from "../StatusBadge";

interface PlaybookDetailProps {
	playbook: Playbook | null;
	isLoading: boolean;
	onForget: (playbook: Pick<Playbook, "id" | "intent">) => void;
}

/** A labelled section that only renders when it has content. */
function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<section className="flex flex-col gap-1">
			<h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</h4>
			{children}
		</section>
	);
}

/**
 * Playbook detail (right column): intent, status/confidence, areas, the
 * captured commands/gotcha/diff-shape/validation, and provenance (PR link).
 */
export function PlaybookDetail({
	playbook,
	isLoading,
	onForget,
}: PlaybookDetailProps) {
	if (!playbook) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground select-text">
				{isLoading ? "Loading…" : "Select a playbook to see how it was done."}
			</div>
		);
	}

	const prLabel = provenanceLabel(playbook.provenance);
	const flaggedAntiPattern = isAntiPattern(playbook);

	return (
		<div className="flex h-full flex-col gap-4 overflow-y-auto p-4 select-text">
			<header className="flex flex-col gap-2">
				<div className="flex items-start gap-2">
					<h3 className="min-w-0 flex-1 text-sm font-semibold text-foreground">
						{playbook.intent}
					</h3>
					<Button
						variant="ghost"
						size="xs"
						onClick={() =>
							onForget({ id: playbook.id, intent: playbook.intent })
						}
						aria-label="Forget this playbook"
					>
						<LuTrash2 className="size-3.5" />
						Forget
					</Button>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<StatusBadge status={playbook.status} />
					<span className="text-[11px] text-muted-foreground">
						{confidenceLabel(playbook.confidence)}
					</span>
					{prLabel ? (
						<a
							href={playbook.provenance.url ?? undefined}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
						>
							{prLabel}
							<LuExternalLink className="size-3" />
						</a>
					) : null}
				</div>
				{flaggedAntiPattern ? (
					<div className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
						<LuTriangleAlert className="size-3.5 shrink-0" />
						Anti-pattern — captured from a PR that was closed without merging.
					</div>
				) : null}
			</header>

			<AreaChips areas={playbook.areaTags} />

			{playbook.commands.length > 0 ? (
				<Field label="Commands">
					<ul className="flex flex-col gap-1">
						{playbook.commands.map((command) => (
							<li
								key={command}
								className="rounded bg-muted px-2 py-1 font-mono text-[11px] text-foreground"
							>
								{command}
							</li>
						))}
					</ul>
				</Field>
			) : null}

			{playbook.gotcha ? (
				<Field label="Gotcha">
					<p className="text-xs text-foreground whitespace-pre-wrap">
						{playbook.gotcha}
					</p>
				</Field>
			) : null}

			{playbook.diffShape ? (
				<Field label="Diff shape">
					<p className="text-xs text-foreground whitespace-pre-wrap">
						{playbook.diffShape}
					</p>
				</Field>
			) : null}

			{playbook.validation ? (
				<Field label="Validation">
					<p className="text-xs text-foreground whitespace-pre-wrap">
						{playbook.validation}
					</p>
				</Field>
			) : null}

			{playbook.touchedPaths.length > 0 ? (
				<Field label={`Touched paths (${playbook.touchedPaths.length})`}>
					<ul className="flex flex-col gap-0.5">
						{playbook.touchedPaths.map((path) => (
							<li
								key={path}
								className="truncate font-mono text-[11px] text-muted-foreground"
								title={path}
							>
								{path}
							</li>
						))}
					</ul>
				</Field>
			) : null}
		</div>
	);
}
