export { useEventBus } from "./hooks/useEventBus";
export { useGitChangeEvents } from "./hooks/useGitChangeEvents";
export {
	type AgentIdentity,
	type AgentLifecyclePayload,
	type EventBusHandle,
	type FsGroupAddress,
	type FsGroupEventsPayload,
	type GitChangedPayload,
	getEventBus,
	type PortChangedPayload,
	type TerminalLifecyclePayload,
} from "./lib/eventBus";
export { primeRelayAffinity } from "./lib/primeRelayAffinity";
export {
	useWorkspaceClient,
	useWorkspaceHostUrl,
	useWorkspaceWsUrl,
	type WorkspaceClientContextValue,
	WorkspaceClientProvider,
} from "./providers/WorkspaceClientProvider";
export { workspaceTrpc } from "./workspace-trpc";
