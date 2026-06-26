import { workspaceTrpc } from "@superset/workspace-client";
import { getBaseName } from "renderer/lib/pathBasename";
import { ReviewerContextCard } from "./components/ReviewerContextCard";

/**
 * The cross-project "Manage context" view (Wave 6, M5) — the MemoryPane's
 * "Reviewer" section body. Enumerates every local project (host
 * `reviewer.listContextStatus`, which walks the same `projects` table as
 * `project.list`) and stacks a {@link ReviewerContextCard} per project, each
 * with its OWN set-up / refresh action and changed/stale indicator. Read-only +
 * cache-first; nothing here onboards or refreshes on its own.
 */
export function ReviewerContextManager() {
	const statusesQuery = workspaceTrpc.reviewer.listContextStatus.useQuery(
		undefined,
		{ staleTime: 60_000 },
	);
	const statuses = statusesQuery.data ?? [];

	if (statuses.length === 0) {
		if (statusesQuery.isLoading) {
			return (
				<div className="flex h-full w-full cursor-text select-text items-center justify-center text-sm text-muted-foreground">
					Loading projects…
				</div>
			);
		}
		return (
			<div className="flex h-full w-full cursor-text select-text items-center justify-center px-6 text-center text-sm text-muted-foreground">
				No local projects yet. Import a project to set up its AI reviewer.
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
			<div className="border-b border-border px-3 py-2">
				<p className="cursor-text select-text text-xs text-muted-foreground">
					Onboard and refresh the AI reviewer per project. Each reviewer grounds
					on that project's coding practice, project index, and playbooks; a
					changed badge means the context moved since setup — refresh to
					re-ground (it never refreshes on its own).
				</p>
			</div>
			<div className="flex flex-col gap-2 p-3">
				{statuses.map((status) => (
					<ReviewerContextCard
						key={status.projectId}
						projectId={status.projectId}
						name={
							status.repoPath ? getBaseName(status.repoPath) : status.projectId
						}
						status={status}
					/>
				))}
			</div>
		</div>
	);
}
