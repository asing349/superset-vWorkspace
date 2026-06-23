import type { RendererContext } from "@superset/panes";
import { useCallback } from "react";
import type { MemoryPaneData, PaneViewerData } from "../../../../types";
import { GraphSection } from "./components/GraphSection";
import { MemoryPanelHeader } from "./components/MemoryPanelHeader";
import { PlaybookDetail } from "./components/PlaybookDetail";
import { PlaybookList } from "./components/PlaybookList";
import { PracticeActions } from "./components/PracticeActions";
import { PracticeSection } from "./components/PracticeSection";
import { SettingsSection } from "./components/SettingsSection";
import { useEmbeddingsSettings } from "./hooks/useEmbeddingsSettings";
import { useMemoryGraph } from "./hooks/useMemoryGraph";
import { useMemoryPanel } from "./hooks/useMemoryPanel";
import { usePracticeConsolidation } from "./hooks/usePracticeConsolidation";
import {
	isEnabledSection,
	type MemorySection,
	resolveSection,
} from "./utils/sections";

interface MemoryPaneProps {
	context: RendererContext<PaneViewerData>;
	/** v2 project this pane's memory is scoped to (`workspace.projectId`). */
	projectId: string;
	/** Open a touched file from a graph node (best-effort; repo-relative path). */
	onOpenFile?: (path: string) => void;
}

/**
 * The Superset Memory panel (B4b). A single workspace pane surfacing the LOCAL
 * memory layer: the token-savings stat, a Playbook browser (list + detail) with
 * one-click Forget, scoped to the workspace's project.
 *
 * Built for extension: the header carries an actions slot (B5 consolidation
 * buttons) + a data-driven sections nav (B6 graph, B7 settings/embeddings). Pane
 * state (active section + selected playbook) lives in the pane's own data, so it
 * survives tab switches and restores with the workspace.
 */
export function MemoryPane({
	context,
	projectId,
	onOpenFile,
}: MemoryPaneProps) {
	const data = context.pane.data as MemoryPaneData;
	const section = resolveSection(data.section);
	const selectedPlaybookId = data.selectedPlaybookId ?? null;

	const updateData = context.actions.updateData;

	const setSection = useCallback(
		(next: MemorySection) => {
			// `isEnabledSection` guards against persisting a not-yet-shipped section;
			// the explicit list keeps it in lockstep with `MemoryPaneData.section`.
			if (!isEnabledSection(next)) return;
			if (
				next !== "playbooks" &&
				next !== "practice" &&
				next !== "graph" &&
				next !== "settings"
			) {
				return;
			}
			updateData({ ...data, section: next });
		},
		[data, updateData],
	);

	const setSelected = useCallback(
		(id: string | null) => {
			updateData({ ...data, selectedPlaybookId: id });
		},
		[data, updateData],
	);

	// Clicking a playbook node in the graph jumps to the Playbooks section with
	// that playbook open.
	const openPlaybookFromGraph = useCallback(
		(id: string) => {
			updateData({ ...data, section: "playbooks", selectedPlaybookId: id });
		},
		[data, updateData],
	);

	const {
		playbooks,
		isLoadingPlaybooks,
		savedStats,
		selectedPlaybook,
		isLoadingSelected,
		forgetPlaybook,
	} = useMemoryPanel({ projectId, selectedPlaybookId });

	const handleForget = useCallback(
		(playbook: { id: string; intent: string }) => {
			forgetPlaybook(playbook);
			// If the forgotten playbook was open in the detail pane, clear it.
			if (selectedPlaybookId === playbook.id) setSelected(null);
		},
		[forgetPlaybook, selectedPlaybookId, setSelected],
	);

	const consolidation = usePracticeConsolidation({ projectId });
	const graph = useMemoryGraph({ projectId });
	const embeddings = useEmbeddingsSettings({ projectId });

	return (
		<div className="flex h-full min-h-0 w-full flex-col bg-background">
			<MemoryPanelHeader
				savedStats={savedStats}
				activeSection={section}
				onSelectSection={setSection}
				actions={
					section === "practice" ? (
						<PracticeActions consolidation={consolidation} />
					) : null
				}
			/>
			{section === "playbooks" ? (
				<div className="flex min-h-0 flex-1">
					<div className="flex w-1/2 min-w-[14rem] flex-col overflow-y-auto border-r border-border">
						<PlaybookList
							playbooks={playbooks}
							selectedId={selectedPlaybookId}
							isLoading={isLoadingPlaybooks}
							onSelect={setSelected}
							onForget={handleForget}
						/>
					</div>
					<div className="min-w-0 flex-1">
						<PlaybookDetail
							playbook={selectedPlaybook}
							isLoading={isLoadingSelected}
							onForget={handleForget}
						/>
					</div>
				</div>
			) : null}
			{section === "practice" ? (
				<div className="min-h-0 flex-1">
					<PracticeSection consolidation={consolidation} />
				</div>
			) : null}
			{section === "graph" ? (
				<div className="min-h-0 flex-1">
					<GraphSection
						graph={graph}
						onSelectPlaybook={openPlaybookFromGraph}
						onOpenFile={onOpenFile}
					/>
				</div>
			) : null}
			{section === "settings" ? (
				<div className="min-h-0 flex-1">
					<SettingsSection embeddings={embeddings} />
				</div>
			) : null}
		</div>
	);
}
