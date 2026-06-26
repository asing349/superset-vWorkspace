import type {
	TicketSource,
	TicketWritebackTarget,
	UnifiedTicket,
} from "./types";

// Wave-7 M3 — pure helpers for the unified ticket id + writeback routing.
//
// The unified id is `${source}:${sourceId}`. `source` is a fixed token
// (`cloud` | `local`) with no `:`, so we split on the FIRST colon and treat the
// remainder as the (opaque) source id — Linear urls/keys never appear here, only
// stable ids (a cloud `tasks.id` UUID or a Linear issue id), neither of which
// the producer ever embeds a leading-segment collision into.

const SOURCES: readonly TicketSource[] = ["cloud", "local"];

function isTicketSource(value: string): value is TicketSource {
	return (SOURCES as readonly string[]).includes(value);
}

/** Build the stable unified id (`${source}:${sourceId}`). */
export function makeUnifiedTicketId({
	source,
	sourceId,
}: {
	source: TicketSource;
	sourceId: string;
}): string {
	return `${source}:${sourceId}`;
}

/** Parse a unified id back into its `{ source, sourceId }`. Throws if malformed. */
export function parseUnifiedTicketId(unifiedId: string): {
	source: TicketSource;
	sourceId: string;
} {
	const separator = unifiedId.indexOf(":");
	if (separator <= 0) {
		throw new Error(`Malformed unified ticket id: ${unifiedId}`);
	}
	const source = unifiedId.slice(0, separator);
	const sourceId = unifiedId.slice(separator + 1);
	if (!isTicketSource(source) || sourceId.length === 0) {
		throw new Error(`Malformed unified ticket id: ${unifiedId}`);
	}
	return { source, sourceId };
}

/**
 * Map a unified ticket (or a bare `{ source, sourceId }`) to its writeback
 * target. PURE — M4 dispatches on the returned `kind` to send status/comment
 * writeback to the active source.
 */
export function resolveWritebackTarget(
	ticket: Pick<UnifiedTicket, "source" | "sourceId">,
): TicketWritebackTarget {
	return ticket.source === "cloud"
		? { kind: "cloud", taskId: ticket.sourceId }
		: { kind: "local", issueId: ticket.sourceId };
}
