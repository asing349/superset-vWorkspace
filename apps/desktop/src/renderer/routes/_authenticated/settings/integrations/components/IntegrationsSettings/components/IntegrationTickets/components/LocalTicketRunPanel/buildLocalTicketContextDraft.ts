// Wave-7 M5 — seed the agent context for a local-ticket → PR run.
//
// The cloud task page builds context with a memory-ranked draft (via
// `workspaceTrpc.memory.retrieve`, which needs a WorkspaceClientProvider). The
// integrations route has no such provider, so launching a run on a `local:`
// ticket uses a plain editable draft instead: the ticket's identifier/title (+
// description when present) become the starting point the developer reviews and
// approves before the run. Pure + deterministic so it is unit-testable.

export function buildLocalTicketContextDraft({
	identifier,
	title,
	description,
}: {
	identifier: string;
	title: string;
	description: string | null;
}): string {
	const lines = [`# ${identifier}: ${title}`];
	const trimmed = description?.trim();
	if (trimmed) {
		lines.push("", trimmed);
	}
	return lines.join("\n");
}
