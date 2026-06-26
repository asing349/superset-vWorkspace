import { router } from "../index";
import { agentsRouter } from "./agents";
import { attachmentsRouter } from "./attachments";
import { authRouter } from "./auth";
import { businessRulesRouter } from "./business-rules";
import { chatRouter } from "./chat";
import { cloudRouter } from "./cloud";
import { configRouter } from "./config";
import { filesystemRouter } from "./filesystem";
import { gitRouter } from "./git";
import { githubRouter } from "./github";
import { healthRouter } from "./health";
import { hostRouter } from "./host";
import { issuesRouter } from "./issues";
import { linearRouter } from "./linear";
import { memoryRouter } from "./memory";
import { notificationsRouter } from "./notifications";
import { portsRouter } from "./ports";
import { prReviewRouter } from "./pr-review";
import { projectRouter } from "./project";
import { pullRequestsRouter } from "./pull-requests";
import { reviewerRouter } from "./reviewer";
import { settingsRouter } from "./settings";
import { terminalRouter } from "./terminal";
import { terminalAgentsRouter } from "./terminal-agents";
import { ticketContextRouter } from "./ticket-context";
import { ticketRunRouter } from "./ticket-run";
import { workspaceRouter } from "./workspace";
import { workspaceCleanupRouter } from "./workspace-cleanup";
import { workspaceCreationRouter } from "./workspace-creation";
import { workspaceGroupRouter } from "./workspace-group";
import { workspacesRouter } from "./workspaces";

export const appRouter = router({
	agents: agentsRouter,
	attachments: attachmentsRouter,
	auth: authRouter,
	businessRules: businessRulesRouter,
	health: healthRouter,
	host: hostRouter,
	chat: chatRouter,
	config: configRouter,
	filesystem: filesystemRouter,
	git: gitRouter,
	github: githubRouter,
	cloud: cloudRouter,
	issues: issuesRouter,
	linear: linearRouter,
	memory: memoryRouter,
	notifications: notificationsRouter,
	prReview: prReviewRouter,
	reviewer: reviewerRouter,
	pullRequests: pullRequestsRouter,
	project: projectRouter,
	ports: portsRouter,
	settings: settingsRouter,
	terminal: terminalRouter,
	terminalAgents: terminalAgentsRouter,
	ticketContext: ticketContextRouter,
	ticketRun: ticketRunRouter,
	workspace: workspaceRouter,
	workspaces: workspacesRouter,
	workspaceGroup: workspaceGroupRouter,
	workspaceCleanup: workspaceCleanupRouter,
	workspaceCreation: workspaceCreationRouter,
});

export type AppRouter = typeof appRouter;
