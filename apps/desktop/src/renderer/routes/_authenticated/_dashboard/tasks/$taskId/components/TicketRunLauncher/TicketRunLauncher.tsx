import { alert } from "@superset/ui/atoms/Alert";
import { Button } from "@superset/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@superset/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { toast } from "@superset/ui/sonner";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { HiCheck, HiMiniPlay } from "react-icons/hi2";
import { env } from "renderer/env.renderer";
import { authClient } from "renderer/lib/auth-client";
import { showHostServiceUnavailableToast } from "renderer/lib/host-service-unavailable";
import { useSelectedHostProjectIds } from "renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/components/DashboardNewWorkspaceModalContent/hooks/useSelectedHostProjectIds";
import { ProjectThumbnail } from "renderer/routes/_authenticated/components/ProjectThumbnail";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { useV2WorkspaceCreateDefaultsStore } from "renderer/stores/v2-workspace-create-defaults";
import { MOCK_ORG_ID } from "shared/constants";
import { useTicketRunStart } from "../../hooks/useTicketRunStart";
import {
	buildTicketRunRequest,
	multiRepoConfirmMessage,
} from "../../utils/buildTicketRunRequest";

interface TicketRunLauncherProps {
	/** Cloud task id (Linear-synced `tasks.id`). */
	taskId: string;
	/** Human ticket key, e.g. "SUPER-172" (slug fallback). */
	ticketKey: string;
	/**
	 * Lifted up so B3-renderer keys the approved context under the same primary
	 * project `(projectId, taskId)`. `null` until a primary repo resolves.
	 */
	onPrimaryProjectChange?: (projectId: string | null) => void;
}

interface RecentProject {
	id: string;
	name: string;
	iconUrl: string | null;
	needsSetup: boolean | null;
}

export function TicketRunLauncher({
	taskId,
	ticketKey,
	onPrimaryProjectChange,
}: TicketRunLauncherProps) {
	const collections = useCollections();
	const hostService = useLocalHostService();
	const { machineId, activeHostUrl } = hostService;
	const { data: session } = authClient.useSession();
	const activeOrganizationId = env.SKIP_ENV_VALIDATION
		? MOCK_ORG_ID
		: (session?.session?.activeOrganizationId ?? null);

	const lastProjectId = useV2WorkspaceCreateDefaultsStore(
		(state) => state.lastProjectId,
	);
	const setLastProjectId = useV2WorkspaceCreateDefaultsStore(
		(state) => state.setLastProjectId,
	);

	const setUpProjectIds = useSelectedHostProjectIds(machineId);
	const { start, isStarting } = useTicketRunStart({ hostUrl: activeHostUrl });

	const { data: v2Projects } = useLiveQuery(
		(q) =>
			q
				.from({ projects: collections.v2Projects })
				.where(({ projects }) =>
					eq(projects.organizationId, activeOrganizationId ?? ""),
				)
				.select(({ projects }) => ({ ...projects })),
		[collections, activeOrganizationId],
	);

	// Cache-first: render whatever projects we have; needsSetup stays null until
	// the host's project list resolves (gates submission, not rendering).
	const recentProjects = useMemo<RecentProject[]>(
		() =>
			(v2Projects ?? []).map((project) => ({
				id: project.id,
				name: project.name,
				iconUrl: project.iconUrl ?? null,
				needsSetup:
					setUpProjectIds === null ? null : !setUpProjectIds.has(project.id),
			})),
		[v2Projects, setUpProjectIds],
	);

	const seededProjectId =
		lastProjectId &&
		recentProjects.some((project) => project.id === lastProjectId)
			? lastProjectId
			: (recentProjects[0]?.id ?? null);
	const [primaryProjectId, setPrimaryProjectId] = useState<string | null>(
		seededProjectId,
	);
	useEffect(() => {
		if (
			primaryProjectId &&
			recentProjects.some((project) => project.id === primaryProjectId)
		) {
			return;
		}
		setPrimaryProjectId(seededProjectId);
	}, [seededProjectId, primaryProjectId, recentProjects]);

	useEffect(() => {
		onPrimaryProjectChange?.(primaryProjectId);
	}, [primaryProjectId, onPrimaryProjectChange]);

	// Additional repos for a multi-repo run (never includes the primary).
	const [additionalProjectIds, setAdditionalProjectIds] = useState<string[]>(
		[],
	);
	useEffect(() => {
		// Drop any additional repo that no longer exists or became the primary.
		setAdditionalProjectIds((ids) =>
			ids.filter(
				(id) =>
					id !== primaryProjectId &&
					recentProjects.some((project) => project.id === id),
			),
		);
	}, [primaryProjectId, recentProjects]);

	const [primaryPickerOpen, setPrimaryPickerOpen] = useState(false);
	const [additionalPickerOpen, setAdditionalPickerOpen] = useState(false);

	const primaryProject = recentProjects.find(
		(project) => project.id === primaryProjectId,
	);
	const additionalProjects = useMemo(
		() =>
			additionalProjectIds
				.map((id) => recentProjects.find((project) => project.id === id))
				.filter((project): project is RecentProject => project !== undefined),
		[additionalProjectIds, recentProjects],
	);

	const handleSelectPrimary = (projectId: string) => {
		setPrimaryProjectId(projectId);
		setLastProjectId(projectId);
		setPrimaryPickerOpen(false);
	};

	const toggleAdditional = (projectId: string) => {
		setAdditionalProjectIds((ids) =>
			ids.includes(projectId)
				? ids.filter((id) => id !== projectId)
				: [...ids, projectId],
		);
	};

	const submitBlocker = useMemo<string | null>(() => {
		if (!primaryProjectId) return "Select a repo";
		if (!activeHostUrl) return "Host service is not running";
		if (setUpProjectIds === null) return "Checking host…";
		if (primaryProject?.needsSetup === true) {
			return "Repo not set up on this host";
		}
		const unsetAdditional = additionalProjects.find(
			(project) => project.needsSetup === true,
		);
		if (unsetAdditional) {
			return `Repo "${unsetAdditional.name}" not set up on this host`;
		}
		return null;
	}, [
		primaryProjectId,
		primaryProject?.needsSetup,
		additionalProjects,
		setUpProjectIds,
		activeHostUrl,
	]);

	const launch = () => {
		if (!primaryProjectId) return;
		const request = buildTicketRunRequest({
			taskId,
			ticketKey,
			primaryProjectId,
			additionalProjectIds,
		});
		const promise = start(request);
		toast.promise(promise, {
			loading: "Starting autonomous run…",
			success: () => "Autonomous run started — opening a PR per repo",
			error: (err) => (err instanceof Error ? err.message : String(err)),
		});
	};

	const handleStart = () => {
		if (submitBlocker) {
			if (!activeHostUrl) {
				showHostServiceUnavailableToast(hostService, {
					action: "start the autonomous run",
				});
			} else {
				toast.error(submitBlocker);
			}
			return;
		}
		// Exactly one confirm, and only when the run spans more than one repo.
		if (additionalProjects.length > 0 && primaryProject) {
			const names = [
				primaryProject.name,
				...additionalProjects.map((project) => project.name),
			];
			alert({
				title: "Run across multiple repos?",
				description: multiRepoConfirmMessage(names),
				actions: [
					{ label: "Proceed", variant: "default", onClick: launch },
					{ label: "Cancel", variant: "ghost" },
				],
			});
			return;
		}
		launch();
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1.5">
				<span className="text-sm font-medium text-foreground">Repo</span>
				<Popover open={primaryPickerOpen} onOpenChange={setPrimaryPickerOpen}>
					<PopoverTrigger asChild>
						<Button
							variant="outline"
							size="sm"
							className="w-full justify-between font-normal h-8 min-w-0"
						>
							<span className="flex items-center gap-2 truncate">
								{primaryProject ? (
									<>
										<ProjectThumbnail
											projectName={primaryProject.name}
											iconUrl={primaryProject.iconUrl}
											className="size-4"
										/>
										<span className="truncate">{primaryProject.name}</span>
									</>
								) : (
									<span className="text-muted-foreground">Select repo</span>
								)}
							</span>
							<ChevronDownIcon className="size-4 opacity-50 shrink-0" />
						</Button>
					</PopoverTrigger>
					<PopoverContent align="start" className="w-60 p-0">
						<Command>
							<CommandInput placeholder="Search repos..." />
							<CommandList>
								<CommandEmpty>No repos found.</CommandEmpty>
								<CommandGroup>
									{recentProjects.map((project) => (
										<CommandItem
											key={project.id}
											value={project.name}
											onSelect={() => handleSelectPrimary(project.id)}
										>
											<ProjectThumbnail
												projectName={project.name}
												iconUrl={project.iconUrl}
												className="size-4"
											/>
											<span className="flex-1 truncate">{project.name}</span>
											{project.needsSetup === true && (
												<span className="text-[10px] text-amber-500 shrink-0">
													not set up
												</span>
											)}
											{project.id === primaryProjectId && (
												<HiCheck className="size-3.5 shrink-0" />
											)}
										</CommandItem>
									))}
								</CommandGroup>
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>
			</div>

			<div className="flex flex-col gap-1.5">
				<span className="text-sm font-medium text-foreground">
					Additional repos{" "}
					<span className="font-normal text-muted-foreground">(optional)</span>
				</span>
				<Popover
					open={additionalPickerOpen}
					onOpenChange={setAdditionalPickerOpen}
				>
					<PopoverTrigger asChild>
						<Button
							variant="outline"
							size="sm"
							className="w-full justify-between font-normal h-8 min-w-0"
						>
							<span className="truncate text-muted-foreground">
								{additionalProjects.length === 0
									? "Add repos for a cross-repo change"
									: `${additionalProjects.length} additional repo${
											additionalProjects.length === 1 ? "" : "s"
										}`}
							</span>
							<ChevronDownIcon className="size-4 opacity-50 shrink-0" />
						</Button>
					</PopoverTrigger>
					<PopoverContent align="start" className="w-60 p-0">
						<Command>
							<CommandInput placeholder="Search repos..." />
							<CommandList>
								<CommandEmpty>No repos found.</CommandEmpty>
								<CommandGroup>
									{recentProjects
										.filter((project) => project.id !== primaryProjectId)
										.map((project) => (
											<CommandItem
												key={project.id}
												value={project.name}
												onSelect={() => toggleAdditional(project.id)}
											>
												<ProjectThumbnail
													projectName={project.name}
													iconUrl={project.iconUrl}
													className="size-4"
												/>
												<span className="flex-1 truncate">{project.name}</span>
												{additionalProjectIds.includes(project.id) && (
													<HiCheck className="size-3.5 shrink-0" />
												)}
											</CommandItem>
										))}
								</CommandGroup>
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>
			</div>

			<Button
				size="sm"
				className="h-8 gap-1.5"
				disabled={!!submitBlocker || isStarting}
				onClick={handleStart}
			>
				<HiMiniPlay className="size-3.5" />
				{isStarting ? "Starting…" : "Start autonomous run"}
			</Button>
		</div>
	);
}
