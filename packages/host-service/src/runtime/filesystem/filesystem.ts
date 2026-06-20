import {
	createFsHostService,
	type FsHostService,
	FsWatcherManager,
	getSearchIndex,
} from "@superset/workspace-fs/host";
import { eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { projects, workspaces } from "../../db/schema.ts";
import type {
	WorkspaceGroupResolver,
	WorkspaceGroupStore,
} from "../workspace-groups/index.ts";

export interface WorkspaceFilesystemManagerOptions {
	db: HostDb;
	workspaceGroupStore: WorkspaceGroupStore;
	workspaceGroupResolver: WorkspaceGroupResolver;
}

export class WorkspaceFilesystemManager {
	private readonly db: HostDb;
	private readonly workspaceGroupStore: WorkspaceGroupStore;
	private readonly workspaceGroupResolver: WorkspaceGroupResolver;
	private readonly watcherManager = new FsWatcherManager();
	private readonly serviceCache = new Map<string, FsHostService>();

	constructor(options: WorkspaceFilesystemManagerOptions) {
		this.db = options.db;
		this.workspaceGroupStore = options.workspaceGroupStore;
		this.workspaceGroupResolver = options.workspaceGroupResolver;
	}

	resolveWorkspaceRoot(workspaceId: string): string {
		const workspace = this.db.query.workspaces
			.findFirst({ where: eq(workspaces.id, workspaceId) })
			.sync();

		if (!workspace) {
			throw new Error(`Workspace not found: ${workspaceId}`);
		}

		return workspace.worktreePath;
	}

	resolveProjectRoot(projectId: string): string {
		const project = this.db.query.projects
			.findFirst({ where: eq(projects.id, projectId) })
			.sync();

		if (!project) {
			throw new Error(`Project not found: ${projectId}`);
		}

		return project.repoPath;
	}

	getServiceForWorkspace(workspaceId: string): FsHostService {
		return this.getServiceForRootPath(this.resolveWorkspaceRoot(workspaceId));
	}

	getServiceForProject(projectId: string): FsHostService {
		return this.getServiceForRootPath(this.resolveProjectRoot(projectId));
	}

	/**
	 * Resolve a multi-root workspace ("group") root to an absolute path and
	 * return its FS service. Folder roots have no `workspaceId`, so this is the
	 * only addressing that can serve them. Reuses the per-root-path cache, so a
	 * `kind: "workspace"` root and a direct `getServiceForWorkspace` call for the
	 * same worktree share one cached service.
	 */
	getServiceForRootId(input: {
		groupId: string;
		rootId: string;
	}): FsHostService {
		return this.getServiceForRootPath(this.resolveRootPath(input));
	}

	/**
	 * Resolve a `{groupId, rootId}` group root to its absolute on-disk path —
	 * the group-addressing analogue of {@link resolveWorkspaceRoot}. Used by the
	 * event bus's group-addressed `fs:events` watch (Wave-2 M6) so folder roots
	 * (which have no `workspaceId`) can live-refresh. Throws when the group or
	 * root is unknown, or the path doesn't resolve to an existing directory.
	 */
	resolveRootPath(input: { groupId: string; rootId: string }): string {
		const group = this.workspaceGroupStore.get(input.groupId);
		if (!group) {
			throw new Error(`Workspace group not found: ${input.groupId}`);
		}
		return this.workspaceGroupResolver.resolveRootPathById({
			group,
			rootId: input.rootId,
		});
	}

	private getServiceForRootPath(rootPath: string): FsHostService {
		let service = this.serviceCache.get(rootPath);
		if (!service) {
			service = createFsHostService({
				rootPath,
				watcherManager: this.watcherManager,
			});
			this.serviceCache.set(rootPath, service);
			// Pre-warm search index so first search is instant
			getSearchIndex({ rootPath, includeHidden: false }).catch(() => {});
		}
		return service;
	}

	async close(): Promise<void> {
		this.serviceCache.clear();
		await this.watcherManager.close();
	}
}
