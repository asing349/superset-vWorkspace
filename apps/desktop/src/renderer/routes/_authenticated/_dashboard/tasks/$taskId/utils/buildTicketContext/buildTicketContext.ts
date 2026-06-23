import type { AppRouter } from "@superset/host-service";
import type { inferRouterOutputs } from "@trpc/server";

/**
 * The exact output of the host `memory.retrieve` tRPC query — the wave-3 memory
 * bundle (practices + ranked playbooks + project-index slices + semantic
 * slices). Derived type-only from the host AppRouter, so the renderer stays
 * browser-safe and never runtime-imports `@superset/memory`.
 */
export type MemoryBundle = inferRouterOutputs<AppRouter>["memory"]["retrieve"];

/** The ticket fields the draft context is assembled from. */
export interface TicketContextSource {
	slug: string | null;
	title: string;
	description: string | null;
	externalKey: string | null;
	externalUrl: string | null;
}

interface BuildTicketContextParams {
	ticket: TicketContextSource;
	/** The developer's optional free-text context (may be empty/whitespace). */
	developerInput: string;
	/** The wave-3 memory bundle, or null when retrieval hasn't returned yet. */
	bundle: MemoryBundle | null;
}

function section(heading: string, body: string): string {
	return `## ${heading}\n\n${body.trim()}`;
}

function renderTicket(ticket: TicketContextSource): string {
	const lines: string[] = [];
	const label = ticket.externalKey ?? ticket.slug;
	lines.push(label ? `**${label}** — ${ticket.title}` : ticket.title);
	if (ticket.externalUrl) lines.push(`Link: ${ticket.externalUrl}`);
	lines.push("");
	lines.push(
		ticket.description?.trim()
			? ticket.description.trim()
			: "_No description provided._",
	);
	return lines.join("\n");
}

function renderDeveloperInput(developerInput: string): string | null {
	const trimmed = developerInput.trim();
	if (!trimmed) return null;
	return section("Developer-provided context", trimmed);
}

function renderPractices(bundle: MemoryBundle): string | null {
	if (bundle.practices.length === 0) return null;
	const body = bundle.practices
		.map((practice) => {
			const version =
				practice.version !== null ? ` (v${practice.version})` : "";
			return `### ${practice.scope} practice${version}\n\n${practice.content.trim()}`;
		})
		.join("\n\n");
	return section("Coding practices", body);
}

function renderPlaybooks(bundle: MemoryBundle): string | null {
	if (bundle.playbooks.length === 0) return null;
	const body = bundle.playbooks
		.map((playbook) => {
			const parts: string[] = [`### ${playbook.intent}`];
			if (playbook.areaTags.length > 0) {
				parts.push(`Areas: ${playbook.areaTags.join(", ")}`);
			}
			if (playbook.commands.length > 0) {
				const commands = playbook.commands
					.map((command) => `- \`${command}\``)
					.join("\n");
				parts.push(`Commands that worked:\n${commands}`);
			}
			if (playbook.gotcha) parts.push(`Gotcha: ${playbook.gotcha}`);
			if (playbook.diffShape) parts.push(`Change shape: ${playbook.diffShape}`);
			if (playbook.validation) parts.push(`Validation: ${playbook.validation}`);
			return parts.join("\n\n");
		})
		.join("\n\n");
	return section("Relevant playbooks", body);
}

function renderIndexSlices(bundle: MemoryBundle): string | null {
	if (bundle.indexSlices.length === 0) return null;
	const body = bundle.indexSlices
		.map((slice) =>
			slice.summary
				? `- \`${slice.path}\` — ${slice.summary}`
				: `- \`${slice.path}\``,
		)
		.join("\n");
	return section("Project index", body);
}

function renderSemanticSlices(bundle: MemoryBundle): string | null {
	if (bundle.semanticSlices.length === 0) return null;
	const body = bundle.semanticSlices
		.map((slice) =>
			slice.summary
				? `- \`${slice.path}\` — ${slice.summary}`
				: `- \`${slice.path}\``,
		)
		.join("\n");
	return section("Related code (semantic recall)", body);
}

/**
 * Assemble the no-cap draft ticket context (Markdown) for human review.
 *
 * Order: ticket → developer input → wave-3 memory (practices, playbooks,
 * project index, semantic recall). EVERYTHING retrieved is included; nothing is
 * truncated (B-plan: no token cap on the assembled context).
 *
 * SECURITY: this draft is assembled in the renderer purely for human review and
 * is intentionally NOT redacted here — `redactAll` lives in `@superset/memory`
 * and cannot run in the browser. Authoritative secret-redaction is enforced
 * host-side: at persistence (B3 `saveApproved`) and at prompt assembly (B5).
 */
export function buildTicketContext({
	ticket,
	developerInput,
	bundle,
}: BuildTicketContextParams): string {
	const blocks: string[] = [section("Ticket", renderTicket(ticket))];

	const developerBlock = renderDeveloperInput(developerInput);
	if (developerBlock) blocks.push(developerBlock);

	if (bundle) {
		const memoryBlocks = [
			renderPractices(bundle),
			renderPlaybooks(bundle),
			renderIndexSlices(bundle),
			renderSemanticSlices(bundle),
		].filter((block): block is string => block !== null);
		blocks.push(...memoryBlocks);
	}

	return blocks.join("\n\n");
}
