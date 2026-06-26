import { createNodeWebSocket } from "@hono/node-ws";
import { trpcServer } from "@hono/trpc-server";
import { Octokit } from "@octokit/rest";
import { ChatService } from "@superset/chat/server/desktop";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createApiClient } from "./api";
import { createDb, type HostDb } from "./db";
import { EventBus, GitWatcher, registerEventBusRoute } from "./events";
import type { ApiAuthProvider } from "./providers/auth";
import type { HostAuthProvider } from "./providers/host-auth";
import type { ModelProviderRuntimeResolver } from "./providers/model-providers";
import { ChatRuntimeManager } from "./runtime/chat";
import { WorkspaceFilesystemManager } from "./runtime/filesystem";
import type { GitCredentialProvider } from "./runtime/git";
import { createGitFactory } from "./runtime/git";
import {
	isCloudLinearConnected,
	LinearAuthService,
	LinearLocalAuthStore,
} from "./runtime/linear-auth";
import {
	createSdkLinearTicketClient,
	LinearTicketsRuntime,
	LinearTicketsStore,
} from "./runtime/linear-tickets";
import { runMainWorkspaceSweep } from "./runtime/main-workspace-sweep";
import {
	IndexRefreshWatcher,
	MemoryConsolidationService,
	MemoryEmbeddingsService,
	MemoryRetrieveService,
	MemoryVaultService,
	ProjectIndexService,
	reconcilePlaybooksForPr,
	regenerateMemorySkillForProject,
	regenerateMemorySkillsForAllProjects,
	registerMemoryMcpRoute,
} from "./runtime/memory";
// M6: PR-review guide-cache staleness. Imported by PATH (not via
// `./runtime/pr-review/index.ts`, which the guide generator owns) — app.ts is
// the single place that knows about both the PR runtime and the guide cache.
import { markFindingsStaleOnHeadChange } from "./runtime/pr-review/findings-cache";
import { markGuideStaleOnHeadChange } from "./runtime/pr-review/guide-cache";
// M5: per-project AI-reviewer context staleness. Imported by PATH (like the
// findings-cache hook) — app.ts is the single place wiring the PR/memory
// runtimes to the reviewer-config flag.
import { markReviewerContextStale } from "./runtime/pr-review/reviewer-config-cache";
import { PullRequestRuntimeManager } from "./runtime/pull-requests";
import {
	createApiTaskWriteback,
	reconcileTicketRunForPr,
} from "./runtime/ticket-runs";
import {
	createSqliteWorkspaceGroupStore,
	WorkspaceGroupResolver,
} from "./runtime/workspace-groups";
import { registerWorkspaceTerminalRoute } from "./terminal/terminal";
import { TerminalAgentStore } from "./terminal-agents";
import { appRouter } from "./trpc/router";
import {
	execGh as defaultExecGh,
	type ExecGh,
} from "./trpc/router/workspace-creation/utils/exec-gh";
import type { ApiClient } from "./types";

export interface CreateAppOptions {
	config: {
		organizationId: string;
		dbPath: string;
		cloudApiUrl: string;
		migrationsFolder: string;
		allowedOrigins: string[];
	};
	providers: {
		auth: ApiAuthProvider;
		hostAuth: HostAuthProvider;
		credentials: GitCredentialProvider;
		modelResolver: ModelProviderRuntimeResolver;
	};
	/**
	 * Test-harness override hooks. Production never sets these — `createApp`
	 * builds each subsystem itself when omitted. `db` is overridden so tests
	 * can swap in `bun:sqlite` (better-sqlite3 isn't loadable under Bun;
	 * prod uses it on bundled Node). `api`, `github`, `chatRuntime`, and
	 * `chatService` are overridden to keep tests off the network and out of
	 * mastra storage.
	 */
	db?: HostDb;
	api?: ApiClient;
	github?: () => Promise<Octokit>;
	execGh?: ExecGh;
	chatRuntime?: ChatRuntimeManager;
	chatService?: ChatService;
}

export interface CreateAppResult {
	app: Hono;
	injectWebSocket: ReturnType<typeof createNodeWebSocket>["injectWebSocket"];
	api: ApiClient;
	db: HostDb;
	dispose: () => Promise<void>;
}

export function createApp(options: CreateAppOptions): CreateAppResult {
	const { config, providers } = options;

	const api =
		options.api ??
		createApiClient(config.cloudApiUrl, providers.auth, config.organizationId);
	const db = options.db ?? createDb(config.dbPath, config.migrationsFolder);
	const git = createGitFactory(providers.credentials);
	const github =
		options.github ??
		(async () => {
			const token = await providers.credentials.getToken("github.com");
			if (!token) {
				throw new Error(
					"No GitHub token available. Set GITHUB_TOKEN/GH_TOKEN or authenticate via git credential manager.",
				);
			}
			return new Octokit({ auth: token });
		});
	const execGh: ExecGh = options.execGh ?? defaultExecGh;

	// Multi-root workspace ("group") storage and root resolution. The store is
	// SQLite-backed (M7) so groups survive host restarts, sitting behind the same
	// `WorkspaceGroupStore` interface the router/UI already code against; the
	// resolver maps each root to an absolute on-disk path. A single instance of
	// each is shared via the tRPC context.
	const workspaceGroupStore = createSqliteWorkspaceGroupStore(db);
	const workspaceGroupResolver = new WorkspaceGroupResolver({ db });

	const filesystem = new WorkspaceFilesystemManager({
		db,
		workspaceGroupStore,
		workspaceGroupResolver,
	});
	// GitWatcher is the single source of truth for `.git/` and worktree fs
	// activity per workspace. Both EventBus (broadcasts to clients) and the
	// pull-requests runtime (event-driven branch sync) subscribe to it.
	const gitWatcher = new GitWatcher(db, filesystem);
	gitWatcher.start();
	const pullRequestRuntime = new PullRequestRuntimeManager({
		db,
		execGh,
		git,
		github,
		gitWatcher,
		// Superset Memory (B2): confirm-on-merge / demote-on-close. When a tracked
		// PR first reaches a terminal state, reconcile the provisional Playbook(s)
		// captured for it. Idempotent + best-effort (a PR with no saved Playbook
		// is a no-op; errors are swallowed so PR sync never fails on memory work).
		onPullRequestTerminal: ({ projectId, prNumber, terminalState }) => {
			reconcilePlaybooksForPr({ db, projectId, prNumber, terminalState });
			// Wave-4 A1(b): a confirm/demote is a memory mutation — keep the
			// generated `superset-memory` skill fresh for this project. Idempotent
			// + best-effort (regen swallows its own errors).
			regenerateMemorySkillForProject({ db, projectId });
		},
		// Wave-4 B6: close the ticket→PR loop. When an autonomous run's PR is
		// first detected, match its head branch to a `ticket_runs.branch`, stamp
		// the row's `pr_url`, and write the PR url + in-review status back to the
		// cloud task (→ Linear via the existing outbound syncTask). Idempotent +
		// best-effort: a PR with no matching run row is a no-op; writeback errors
		// are swallowed inside the reconciler so PR sync never fails.
		onPullRequestLinked: ({ projectId, headBranch, url }) => {
			void reconcileTicketRunForPr({
				db,
				writeback: createApiTaskWriteback(api),
				projectId,
				headBranch,
				prUrl: url,
			});
		},
		// Wave-5 M6: when a tracked PR's head SHA advances (a new commit), mark
		// any cached PR-review guide built against the old SHA STALE so the UI can
		// offer a "Regenerate" button. This NEVER regenerates a guide on its own
		// (the never-auto-generate guardrail) — it only flips the flag. Best-effort
		// (the hook itself swallows + warns on any throw).
		onPullRequestHeadChanged: ({ projectId, prNumber, newHeadSha }) => {
			markGuideStaleOnHeadChange({ db, projectId, prNumber, newHeadSha });
			// Wave-6 M1: the same head-change flips any cached review Findings to
			// `stale` so the UI offers a "Re-review" button — flag-only, never an
			// automatic re-review (the button-only guardrail).
			markFindingsStaleOnHeadChange({ db, projectId, prNumber, newHeadSha });
			// Wave-6 M5: a new commit can move the code the reviewer grounds on, so
			// flag the project's reviewer context `stale` (flag-only — never an
			// automatic refresh; the developer clicks "Refresh context").
			markReviewerContextStale({ db, projectId });
		},
	});
	pullRequestRuntime.start();
	// Superset Memory (B3): the lightweight per-project structural + lexical
	// index, refreshed incrementally off the existing GitWatcher fs-event seam.
	const memoryIndex = new ProjectIndexService({ db });
	const indexRefreshWatcher = new IndexRefreshWatcher({
		db,
		indexService: memoryIndex,
		gitWatcher,
		// Wave-6 M5: when the project index moves, flag the per-project reviewer
		// context `stale` (flag-only — the developer clicks "Refresh context").
		onProjectIndexRefreshed: ({ projectId }) => {
			markReviewerContextStale({ db, projectId });
		},
	});
	indexRefreshWatcher.start();
	// Superset Memory (B7): optional local semantic embeddings. OFF BY DEFAULT;
	// when off OR no local model is detected, ZERO network calls occur.
	const memoryEmbeddings = new MemoryEmbeddingsService({ db });
	// Superset Memory (B4): retrieval-bundle assembly + token-savings telemetry.
	// Blends semantic recall from `memoryEmbeddings` only when enabled+available.
	const memoryRetrieve = new MemoryRetrieveService({
		db,
		embeddings: memoryEmbeddings,
	});
	// Superset Memory (B5): Coding-Practice consolidation — propose/accept/revert.
	// Wave-4 A1(b): regenerate the `superset-memory` skill after a project-scoped
	// practice write so the pushed SKILL.md tracks the latest consolidation.
	const memoryConsolidation = new MemoryConsolidationService({
		db,
		onProjectPracticeWritten: ({ projectId }) => {
			regenerateMemorySkillForProject({ db, projectId });
			// Wave-6 M5: a practice write changes what the reviewer grounds on —
			// flag the per-project reviewer context `stale` (flag-only; the developer
			// clicks "Refresh context"). Never an automatic refresh.
			markReviewerContextStale({ db, projectId });
		},
	});
	// Superset Memory (B6): Obsidian vault generation + knowledge-graph data.
	const memoryVault = new MemoryVaultService({ db });
	const chatRuntime =
		options.chatRuntime ??
		new ChatRuntimeManager({
			db,
			runtimeResolver: providers.modelResolver,
		});
	// Provider auth (Anthropic / OpenAI OAuth + API keys) is per-machine, not
	// per-workspace. ChatService is a long-lived singleton wrapping mastra's
	// auth storage; the `host.auth.*` router proxies to it.
	const chatService = options.chatService ?? new ChatService();

	// Wave-7 M1: host-local Linear connection (one-button PKCE, NO client
	// secret), gated by cloud-precedence. The public client id is read from
	// `LINEAR_DESKTOP_CLIENT_ID` (absent → no live connect; documented for
	// from-source dev). The precedence gate reads the authoritative cloud Linear
	// status via the cloud API client; an unreachable cloud (e.g. local-only
	// dev) counts as "not connected" so local connect still works offline. The
	// loopback redirect port is overridable via `LINEAR_DESKTOP_REDIRECT_PORT`.
	const linearRedirectPortRaw = process.env.LINEAR_DESKTOP_REDIRECT_PORT;
	const linearRedirectPort = linearRedirectPortRaw
		? Number.parseInt(linearRedirectPortRaw, 10)
		: undefined;
	const linearAuthStore = new LinearLocalAuthStore({ db });
	const linearAuth = new LinearAuthService({
		store: linearAuthStore,
		checkCloudConnected: () =>
			isCloudLinearConnected({ api, organizationId: config.organizationId }),
		clientId: process.env.LINEAR_DESKTOP_CLIENT_ID,
		redirect:
			linearRedirectPort !== undefined && Number.isFinite(linearRedirectPort)
				? { port: linearRedirectPort }
				: undefined,
	});

	// Wave-7 M2: host-local Linear ticket poller. Polls the viewer's issues with
	// the M1 token (a strict no-op when no local token is present), upserts them
	// into the host-local `linear_tickets` cache, and streams via
	// `linear.tickets.*`. `ensureFreshToken` runs M1's lazy PKCE refresh before
	// each poll. NOTHING is written to the cloud DB.
	const linearTickets = new LinearTicketsRuntime({
		store: new LinearTicketsStore({ db }),
		auth: linearAuthStore,
		createClient: createSdkLinearTicketClient,
		ensureFreshToken: async () => {
			await linearAuth.refresh();
		},
	});

	const runtime = {
		auth: chatService,
		chat: chatRuntime,
		filesystem,
		pullRequests: pullRequestRuntime,
		linearAuth,
		linearTickets,
		memoryIndex,
		memoryRetrieve,
		memoryConsolidation,
		memoryVault,
		memoryEmbeddings,
	};
	// Wave-7 M2: begin interval polling of the local Linear tickets (immediate
	// first poll is token-gated, so this is a no-op until a local token exists).
	linearTickets.start();
	const app = new Hono();
	const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

	app.use(
		"*",
		cors({
			origin: config.allowedOrigins,
			allowHeaders: [
				"Content-Type",
				"Authorization",
				"trpc-accept",
				"x-superset-client-machine-id",
			],
		}),
	);

	const eventBus = new EventBus({ db, filesystem, gitWatcher });
	eventBus.start();

	const terminalAgentStore = new TerminalAgentStore();

	// Backfill `kind='main'` v2 workspaces for projects already set up before
	// this column shipped. Idempotent; runs in the background so it doesn't
	// block server startup.
	void runMainWorkspaceSweep({
		api,
		db,
		git,
		organizationId: config.organizationId,
	}).catch((err) => {
		console.warn("[host-service] main-workspace sweep failed:", err);
	});

	// Superset Memory (wave-4 A1(b)): regenerate the generated `superset-memory`
	// skill for every known project on startup so the pushed SKILL.md is fresh
	// the moment the host comes up. Idempotent (overwrites in place) and
	// best-effort; runs synchronously here because each write is a tiny local
	// file op (the helper swallows its own per-project errors).
	try {
		regenerateMemorySkillsForAllProjects({ db });
	} catch (err) {
		console.warn("[host-service] startup memory-skill regen failed:", err);
	}

	const wsAuth: MiddlewareHandler = async (c, next) => {
		const token = c.req.query("token");
		const authorized =
			(await providers.hostAuth.validate(c.req.raw)) ||
			(token && (await providers.hostAuth.validateToken(token)));
		if (!authorized) return c.json({ error: "Unauthorized" }, 401);
		return next();
	};
	app.use("/terminal/*", wsAuth);
	app.use("/events", wsAuth);

	registerEventBusRoute({ app, eventBus, upgradeWebSocket });
	registerWorkspaceTerminalRoute({
		app,
		db,
		eventBus,
		upgradeWebSocket,
	});

	// Superset Memory (wave-4 A1(a)): serve the LOCAL "superset-memory" MCP server
	// over a loopback Streamable-HTTP endpoint so an EXTERNAL CLI agent (Claude
	// Code, Codex, …) on this machine can pull memory. Mounted on the existing
	// host app — which binds 127.0.0.1 only — and intentionally NOT behind
	// `wsAuth`: the server is local + egress-free (reads only host SQLite), so it
	// needs no host secret. Discovery: the host endpoint is published in the
	// host manifest (`~/.superset/host/<orgId>/manifest.json`); the memory server
	// lives at `<endpoint>/mcp/memory`, and the generated SKILL.md documents it.
	registerMemoryMcpRoute({ app, db, retrieve: memoryRetrieve });

	app.use(
		"/trpc/*",
		trpcServer({
			router: appRouter,
			createContext: async (_opts, c) => {
				const isAuthenticated = await providers.hostAuth.validate(c.req.raw);
				return {
					git,
					credentials: providers.credentials,
					github,
					execGh,
					api,
					db,
					runtime,
					eventBus,
					terminalAgentStore,
					workspaceGroupStore,
					workspaceGroupResolver,
					organizationId: config.organizationId,
					isAuthenticated,
					clientMachineId:
						c.req.header("x-superset-client-machine-id") ?? undefined,
				} as Record<string, unknown>;
			},
		}),
	);

	const ownsDb = options.db === undefined;
	const dispose = async (): Promise<void> => {
		// Each step is best-effort and isolated: a throw in one cleanup must
		// not skip the others, otherwise a flaky `.stop()` could leak the
		// open SQLite handle for the rest of the process lifetime.
		try {
			pullRequestRuntime.stop();
		} catch (err) {
			console.warn("[host-service] pullRequestRuntime.stop failed:", err);
		}
		try {
			// Tear down any in-flight Linear loopback redirect listener (W7 M1).
			linearAuth.cancelConnect();
		} catch (err) {
			console.warn("[host-service] linearAuth.cancelConnect failed:", err);
		}
		try {
			// Stop the W7 M2 local Linear ticket poll interval.
			linearTickets.stop();
		} catch (err) {
			console.warn("[host-service] linearTickets.stop failed:", err);
		}
		try {
			eventBus.close();
		} catch (err) {
			console.warn("[host-service] eventBus.close failed:", err);
		}
		try {
			indexRefreshWatcher.stop();
		} catch (err) {
			console.warn("[host-service] indexRefreshWatcher.stop failed:", err);
		}
		try {
			gitWatcher.close();
		} catch (err) {
			console.warn("[host-service] gitWatcher.close failed:", err);
		}
		if (ownsDb) {
			try {
				(db as unknown as { $client?: { close: () => void } }).$client?.close();
			} catch {
				// best-effort close; tests should not fail on teardown
			}
		}
	};

	return { app, injectWebSocket, api, db, dispose };
}
