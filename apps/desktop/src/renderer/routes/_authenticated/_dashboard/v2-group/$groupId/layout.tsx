import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { WorkspaceGroupProvider } from "./providers/WorkspaceGroupProvider";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/v2-group/$groupId",
)({
	component: V2GroupLayout,
});

function V2GroupLayout() {
	const { groupId } = Route.useParams();
	// Multi-root workspaces ("groups") are a local-only, same-host grouping
	// (Decision Log: local-only scope; A1: all roots on the same host). The
	// in-memory group store lives on the local host, so the group connects to
	// the local host URL. `workspaceGroup.get` is then queried inside the single
	// connection opened by WorkspaceGroupProvider.
	const { activeHostUrl } = useLocalHostService();

	if (!activeHostUrl) {
		return <div className="flex h-full w-full" />;
	}

	return (
		<WorkspaceGroupProvider
			groupId={groupId}
			hostUrl={activeHostUrl}
			renderLoading={() => <div className="flex h-full w-full" />}
			renderNotFound={() => (
				<div className="flex h-full w-full flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground select-text">
					Multi-root workspace not found.
				</div>
			)}
		>
			<Outlet />
		</WorkspaceGroupProvider>
	);
}
