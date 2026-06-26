import { eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { workspaces } from "../../db/schema.ts";
import type { GitChangedEvent, GitWatcher } from "../../events/git-watcher.ts";
import type { ProjectIndexService } from "./index-service.ts";

/**
 * Incremental index refresh hook (B3).
 *
 * Reuses the existing host fs-event seam — `GitWatcher.onChanged` — rather than
 * adding a second native watcher. GitWatcher already debounces worktree fs
 * activity per workspace and carries the changed worktree-relative `paths`. We
 * map the workspace back to its project and refresh only those index entries;
 * when the batch is a broad change (no `paths`, e.g. a branch switch / commit),
 * we skip the targeted refresh (a future `reindex` covers full rebuilds).
 *
 * Egress-free; no workspace-fs modification.
 */
export class IndexRefreshWatcher {
	private readonly db: HostDb;
	private readonly indexService: ProjectIndexService;
	private readonly gitWatcher: GitWatcher;
	private readonly onProjectIndexRefreshed?: (input: {
		projectId: string;
	}) => void;
	private unsubscribe: (() => void) | null = null;

	constructor(options: {
		db: HostDb;
		indexService: ProjectIndexService;
		gitWatcher: GitWatcher;
		/**
		 * Wave-6 M5: fired AFTER a targeted index refresh for a project, so the
		 * app.ts wiring can flag any per-project AI-reviewer context `stale`
		 * (flag-only — never an automatic refresh). Optional; best-effort.
		 */
		onProjectIndexRefreshed?: (input: { projectId: string }) => void;
	}) {
		this.db = options.db;
		this.indexService = options.indexService;
		this.gitWatcher = options.gitWatcher;
		this.onProjectIndexRefreshed = options.onProjectIndexRefreshed;
	}

	start(): void {
		if (this.unsubscribe) return;
		this.unsubscribe = this.gitWatcher.onChanged((event) => {
			void this.handle(event).catch((error) => {
				console.warn("[memory:index-refresh] refresh failed:", error);
			});
		});
	}

	stop(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	private async handle(event: GitChangedEvent): Promise<void> {
		// Broad change (commit/branch/fetch) → no per-path list. Targeted refresh
		// needs concrete paths; broad changes are left for an explicit reindex.
		if (!event.paths || event.paths.length === 0) return;

		const projectId = this.resolveProjectId(event.workspaceId);
		if (!projectId) return;

		// Only refresh entries this project already indexed — a workspace worktree
		// shares the project's structure, so worktree-relative paths line up with
		// the project's repo-relative index keys.
		await this.indexService.refreshPaths({
			projectId,
			paths: event.paths,
		});

		// Wave-6 M5: the index just moved for this project — let the host flag the
		// per-project reviewer context `stale` (flag-only; the listener swallows
		// its own errors, so a hook throw can't break the refresh).
		this.onProjectIndexRefreshed?.({ projectId });
	}

	private resolveProjectId(workspaceId: string): string | null {
		try {
			const row = this.db
				.select({ projectId: workspaces.projectId })
				.from(workspaces)
				.where(eq(workspaces.id, workspaceId))
				.get();
			return row?.projectId ?? null;
		} catch {
			return null;
		}
	}
}
