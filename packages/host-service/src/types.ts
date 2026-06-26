import type { Octokit } from "@octokit/rest";
import type { ChatService } from "@superset/chat/server/desktop";
import type { AppRouter } from "@superset/trpc";
import type { TRPCClient } from "@trpc/client";
import type { HostDb } from "./db";
import type { EventBus } from "./events";
import type { ChatRuntimeManager } from "./runtime/chat";
import type { WorkspaceFilesystemManager } from "./runtime/filesystem";
import type { GitCredentialProvider, GitFactory } from "./runtime/git";
import type { LinearAuthService } from "./runtime/linear-auth";
import type {
	MemoryConsolidationService,
	MemoryEmbeddingsService,
	MemoryRetrieveService,
	MemoryVaultService,
	ProjectIndexService,
} from "./runtime/memory";
import type { PullRequestRuntimeManager } from "./runtime/pull-requests";
import type {
	WorkspaceGroupResolver,
	WorkspaceGroupStore,
} from "./runtime/workspace-groups";
import type { TerminalAgentStore } from "./terminal-agents";
import type { ExecGh } from "./trpc/router/workspace-creation/utils/exec-gh";

export type ApiClient = TRPCClient<AppRouter>;

export interface HostServiceRuntime {
	auth: ChatService;
	chat: ChatRuntimeManager;
	filesystem: WorkspaceFilesystemManager;
	pullRequests: PullRequestRuntimeManager;
	/** Host-local Linear connection: one-button PKCE connect + token store (W7 M1). */
	linearAuth: LinearAuthService;
	/** Lightweight per-project structural + lexical index (Superset Memory B3). */
	memoryIndex: ProjectIndexService;
	/** Retrieval-bundle assembly + telemetry stats (Superset Memory B4). */
	memoryRetrieve: MemoryRetrieveService;
	/** Coding-Practice consolidation: propose/accept/revert (Superset Memory B5). */
	memoryConsolidation: MemoryConsolidationService;
	/** Obsidian vault generation + knowledge-graph data (Superset Memory B6). */
	memoryVault: MemoryVaultService;
	/** Optional local semantic embeddings (off by default; Superset Memory B7). */
	memoryEmbeddings: MemoryEmbeddingsService;
}

export interface HostServiceContext {
	git: GitFactory;
	credentials: GitCredentialProvider;
	github: () => Promise<Octokit>;
	execGh: ExecGh;
	api: ApiClient;
	db: HostDb;
	runtime: HostServiceRuntime;
	eventBus: EventBus;
	terminalAgentStore: TerminalAgentStore;
	/** In-memory (M1) store of multi-root workspace definitions. */
	workspaceGroupStore: WorkspaceGroupStore;
	/** Resolves group roots to absolute on-disk paths using host-local data. */
	workspaceGroupResolver: WorkspaceGroupResolver;
	organizationId: string;
	isAuthenticated: boolean;
	clientMachineId?: string;
}
