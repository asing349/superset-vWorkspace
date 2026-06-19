import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { ScrollArea } from "@superset/ui/scroll-area";
import { toast } from "@superset/ui/sonner";
import { cn } from "@superset/ui/utils";
import { useEffect, useMemo, useState } from "react";
import {
	LuChevronDown,
	LuChevronUp,
	LuFolder,
	LuLayers,
	LuStar,
	LuTrash2,
	LuTriangleAlert,
} from "react-icons/lu";
import type {
	ResolvedWorkspaceGroup,
	WorkspaceGroupRootInput,
} from "../../hooks/useWorkspaceGroups";
import { useWorkspaceGroups } from "../../hooks/useWorkspaceGroups";
import { AddRootMenu } from "../AddRootMenu";

interface WorkspaceGroupManageDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The group being managed (resolved roots, defaultRootId). */
	group: ResolvedWorkspaceGroup;
	/**
	 * Called after each successful mutation with the updated resolved group.
	 * The sidebar already invalidates `workspaceGroup.list` inside the
	 * mutations; callers that have this group OPEN should refetch its `get`
	 * here (e.g. `refetchGroup` from `useWorkspaceGroup()`), since the open
	 * group route runs `get` in a separate per-host query client.
	 */
	onMutated?: (group: ResolvedWorkspaceGroup) => void;
}

/**
 * Manage a multi-root workspace ("group"): rename, add roots (existing
 * workspace or folder), remove, reorder (up/down), and set the default root —
 * each wired to the matching `workspaceGroup.*` mutation. After every mutation
 * the sidebar `list` is invalidated (inside `useWorkspaceGroups`) and the
 * returned resolved group is handed back via `onMutated` so an open group
 * shell can refresh too.
 */
export function WorkspaceGroupManageDialog({
	open,
	onOpenChange,
	group,
	onMutated,
}: WorkspaceGroupManageDialogProps) {
	const { rename, addRoot, removeRoot, reorderRoots, setDefaultRoot } =
		useWorkspaceGroups();

	const [nameDraft, setNameDraft] = useState(group.name);
	const [busy, setBusy] = useState(false);

	// Keep the rename draft in sync when the underlying group changes (e.g. a
	// concurrent rename) but only while the field isn't being edited mid-flight.
	useEffect(() => {
		setNameDraft(group.name);
	}, [group.name]);

	const roots = useMemo(
		() => [...group.roots].sort((a, b) => a.position - b.position),
		[group.roots],
	);

	const existingWorkspaceIds = useMemo(
		() =>
			new Set(
				roots
					.filter((root) => root.kind === "workspace" && root.workspaceId)
					.map((root) => root.workspaceId as string),
			),
		[roots],
	);

	const runMutation = async (
		fn: () => Promise<ResolvedWorkspaceGroup>,
	): Promise<void> => {
		setBusy(true);
		try {
			const updated = await fn();
			onMutated?.(updated);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not update workspace",
			);
		} finally {
			setBusy(false);
		}
	};

	const handleRenameSubmit = async () => {
		const trimmed = nameDraft.trim();
		if (!trimmed || trimmed === group.name) {
			setNameDraft(group.name);
			return;
		}
		await runMutation(() => rename({ id: group.id, name: trimmed }));
	};

	const handleAddRoot = async (root: WorkspaceGroupRootInput) => {
		await runMutation(() => addRoot({ id: group.id, root }));
	};

	const handleRemoveRoot = async (rootId: string) => {
		await runMutation(() => removeRoot({ id: group.id, rootId }));
	};

	const handleMove = async (rootId: string, direction: -1 | 1) => {
		const order = roots.map((root) => root.rootId);
		const index = order.indexOf(rootId);
		const target = index + direction;
		if (index === -1 || target < 0 || target >= order.length) return;
		[order[index], order[target]] = [order[target], order[index]];
		await runMutation(() =>
			reorderRoots({ id: group.id, orderedRootIds: order }),
		);
	};

	const handleSetDefault = async (rootId: string) => {
		const next = group.defaultRootId === rootId ? null : rootId;
		await runMutation(() => setDefaultRoot({ id: group.id, rootId: next }));
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange} modal>
			<DialogContent className="max-w-[480px]">
				<DialogHeader>
					<DialogTitle>Manage multi-root workspace</DialogTitle>
					<DialogDescription>
						Rename, add or remove roots, reorder them, and choose a default.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="manage-group-name" className="text-xs">
							Name
						</Label>
						<Input
							id="manage-group-name"
							value={nameDraft}
							onChange={(event) => setNameDraft(event.target.value)}
							onBlur={() => void handleRenameSubmit()}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.currentTarget.blur();
								} else if (event.key === "Escape") {
									setNameDraft(group.name);
									event.currentTarget.blur();
								}
							}}
							disabled={busy}
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<div className="flex items-center justify-between">
							<Label className="text-xs">Roots</Label>
							<AddRootMenu
								existingWorkspaceIds={existingWorkspaceIds}
								onAddRoot={handleAddRoot}
								disabled={busy}
							/>
						</div>

						{roots.length === 0 ? (
							<p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground select-text">
								No roots yet. Add a repository or folder to start working across
								several at once.
							</p>
						) : (
							<ScrollArea className="max-h-[300px]">
								<ul className="flex flex-col gap-1 pr-2">
									{roots.map((root, index) => {
										const isDefault = group.defaultRootId === root.rootId;
										return (
											<li
												key={root.rootId}
												className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-sm"
											>
												{root.kind === "folder" ? (
													<LuFolder className="size-4 shrink-0 text-muted-foreground" />
												) : (
													<LuLayers className="size-4 shrink-0 text-muted-foreground" />
												)}
												<div className="flex min-w-0 flex-1 flex-col">
													<span
														className="truncate font-medium"
														title={root.label}
													>
														{root.label}
													</span>
													<span
														className="truncate text-xs text-muted-foreground"
														title={root.rootPath || undefined}
													>
														{root.exists ? (
															root.rootPath || root.kind
														) : (
															<span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
																<LuTriangleAlert className="size-3" />
																Unavailable
															</span>
														)}
													</span>
												</div>

												<button
													type="button"
													aria-label={
														isDefault
															? "Unset default root"
															: "Set as default root"
													}
													title={
														isDefault
															? "Unset default root"
															: "Set as default root"
													}
													onClick={() => void handleSetDefault(root.rootId)}
													disabled={busy}
													className={cn(
														"rounded p-1 transition-colors hover:bg-muted",
														isDefault
															? "text-amber-500"
															: "text-muted-foreground hover:text-foreground",
													)}
												>
													<LuStar
														className={cn(
															"size-4",
															isDefault && "fill-current",
														)}
													/>
												</button>
												<button
													type="button"
													aria-label="Move root up"
													onClick={() => void handleMove(root.rootId, -1)}
													disabled={busy || index === 0}
													className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
												>
													<LuChevronUp className="size-4" />
												</button>
												<button
													type="button"
													aria-label="Move root down"
													onClick={() => void handleMove(root.rootId, 1)}
													disabled={busy || index === roots.length - 1}
													className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
												>
													<LuChevronDown className="size-4" />
												</button>
												<button
													type="button"
													aria-label={`Remove ${root.label}`}
													onClick={() => void handleRemoveRoot(root.rootId)}
													disabled={busy}
													className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
												>
													<LuTrash2 className="size-4" />
												</button>
											</li>
										);
									})}
								</ul>
							</ScrollArea>
						)}
					</div>
				</div>

				<div className="flex justify-end">
					<Button type="button" onClick={() => onOpenChange(false)}>
						Done
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
