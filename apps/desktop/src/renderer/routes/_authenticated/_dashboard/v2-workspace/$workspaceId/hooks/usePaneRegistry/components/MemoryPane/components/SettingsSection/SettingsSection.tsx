import { Button } from "@superset/ui/button";
import { Switch } from "@superset/ui/switch";
import { LuRefreshCw, LuTriangleAlert } from "react-icons/lu";
import type { UseEmbeddingsSettingsResult } from "../../hooks/useEmbeddingsSettings";
import {
	canReindex,
	detectionHint,
	detectionStatusCopy,
	embeddedCountCopy,
	reindexSummary,
} from "../../utils/embeddingsView";

/**
 * The embeddings settings section (B7b). A single off-by-default toggle for
 * optional local semantic embeddings (A5), the loopback detection status, the
 * embedded-file count when on, and a "Reindex embeddings" action. Everything is
 * driven by the host `memory` procedures via {@link UseEmbeddingsSettingsResult}.
 */
export function SettingsSection({
	embeddings,
}: {
	embeddings: UseEmbeddingsSettingsResult;
}) {
	const { status, isLoading, isUpdating, isReindexing, lastReindex } =
		embeddings;

	if (!status) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground select-text">
				{isLoading
					? "Loading embeddings status…"
					: "Embeddings status unavailable."}
			</div>
		);
	}

	const countCopy = embeddedCountCopy(status);
	const reindexEnabled = canReindex(status) && !isReindexing;

	return (
		<div className="flex h-full flex-col gap-4 overflow-y-auto p-4 select-text">
			<section className="flex flex-col gap-2">
				<div className="flex items-center gap-3">
					<Switch
						checked={status.enabled}
						onCheckedChange={(next) => embeddings.setEnabled(next)}
						disabled={isUpdating}
						aria-label="Enable local semantic embeddings"
					/>
					<div className="flex flex-col">
						<span className="text-sm font-medium text-foreground">
							Semantic embeddings
						</span>
						<span className="text-[11px] text-muted-foreground">
							Off by default · local-only
						</span>
					</div>
				</div>
			</section>

			<section className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 px-3 py-2">
				<span className="text-xs font-medium text-foreground">
					{detectionStatusCopy(status)}
				</span>
				<span className="text-[11px] text-muted-foreground">
					{detectionHint(status)}
				</span>
				{countCopy ? (
					<span className="text-[11px] text-muted-foreground">{countCopy}</span>
				) : null}
				{status.lastError ? (
					<span className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
						<LuTriangleAlert className="size-3.5 shrink-0" />
						{status.lastError}
					</span>
				) : null}
			</section>

			<section className="flex flex-col gap-2">
				<div>
					<Button
						variant="secondary"
						size="xs"
						onClick={embeddings.reindex}
						disabled={!reindexEnabled}
						title={
							canReindex(status)
								? "Re-embed changed files for this project"
								: "Enable embeddings with a local model running to reindex"
						}
					>
						<LuRefreshCw className="size-3.5" />
						Reindex embeddings
					</Button>
				</div>
				{lastReindex ? (
					<span className="text-[11px] text-muted-foreground">
						{reindexSummary(lastReindex)}
					</span>
				) : null}
			</section>
		</div>
	);
}
