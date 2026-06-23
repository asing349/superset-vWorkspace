import type { AppRouter } from "@superset/host-service";
import type { inferRouterOutputs } from "@trpc/server";

/**
 * Pure presentation/decision logic for the embeddings settings section (B7b).
 * No React, no I/O — status-copy selection, toggle/reindex enablement, and
 * reindex-result summarization live here so the component stays declarative and
 * the behavior is unit-testable (no DOM harness, like B4b/B5/B6).
 */

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type EmbeddingsStatus = RouterOutputs["memory"]["embeddingsStatus"];
export type ReindexResult = RouterOutputs["memory"]["reindexEmbeddings"];

/**
 * The detection-status line. Honors A5 (semantic embeddings are off until a
 * LOCAL model is detected, and never leave the machine):
 *  - available → "Local embedding model detected at {endpoint}{ · model}"
 *  - not       → "No local embedding model detected"
 */
export function detectionStatusCopy(
	status: Pick<EmbeddingsStatus, "available" | "endpoint" | "model">,
): string {
	if (!status.available) return "No local embedding model detected";
	const model = status.model ? ` · ${status.model}` : "";
	return `Local embedding model detected at ${status.endpoint}${model}`;
}

/** Guidance shown beneath the status line — optional + local-only (A5). */
export function detectionHint(
	status: Pick<EmbeddingsStatus, "available">,
): string {
	return status.available
		? "Embeddings are optional and stay on your machine — nothing is sent to the cloud."
		: "Optional: run a local embedding model (e.g. Ollama on 127.0.0.1) to enable semantic recall. Local-only — no network calls when off.";
}

/**
 * Whether the "Reindex embeddings" button should be enabled: embeddings must be
 * toggled on AND a local model must be available (otherwise reindex is a no-op).
 */
export function canReindex(
	status: Pick<EmbeddingsStatus, "enabled" | "available">,
): boolean {
	return status.enabled && status.available;
}

/**
 * Summarize a `reindexEmbeddings` result for the UI. `skipped` (disabled /
 * unavailable) gets a clear "nothing to do" note rather than a misleading zero.
 */
export function reindexSummary(result: ReindexResult): string {
	if (result.skipped) {
		return "Nothing to do — embeddings are off or no local model is available.";
	}
	const parts = [`${result.embedded} embedded`];
	if (result.evicted > 0) parts.push(`${result.evicted} evicted`);
	return `Reindexed: ${parts.join(", ")}.`;
}

/** The embedded-file count line, shown only when embeddings are enabled. */
export function embeddedCountCopy(
	status: Pick<EmbeddingsStatus, "enabled" | "embeddedCount">,
): string | null {
	if (!status.enabled) return null;
	const n = status.embeddedCount;
	return `${n} file${n === 1 ? "" : "s"} embedded`;
}
