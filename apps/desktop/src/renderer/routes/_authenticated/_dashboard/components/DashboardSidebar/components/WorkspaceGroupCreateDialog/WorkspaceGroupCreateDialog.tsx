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
import { toast } from "@superset/ui/sonner";
import { cn } from "@superset/ui/utils";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LuFolder, LuLayers, LuLoaderCircle, LuX } from "react-icons/lu";
import {
	useWorkspaceGroups,
	type WorkspaceGroupRootInput,
} from "../../hooks/useWorkspaceGroups";
import { AddRootMenu } from "../AddRootMenu";

interface WorkspaceGroupCreateDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/**
 * "New multi-root workspace" dialog: name + optional initial roots, then
 * `workspaceGroup.create`. Initial roots are accumulated locally (the group
 * does not exist yet, so there is nothing to `addRoot` to) and sent in a single
 * `create` call. An empty group is allowed (Q5 default); on success we navigate
 * to the new group's `/v2-group/$groupId` route.
 */
export function WorkspaceGroupCreateDialog({
	open,
	onOpenChange,
}: WorkspaceGroupCreateDialogProps) {
	const { create } = useWorkspaceGroups();
	const navigate = useNavigate();

	const [name, setName] = useState("");
	const [roots, setRoots] = useState<WorkspaceGroupRootInput[]>([]);
	const [working, setWorking] = useState(false);

	const existingWorkspaceIds = new Set(
		roots
			.filter((root) => root.kind === "workspace" && root.workspaceId)
			.map((root) => root.workspaceId as string),
	);

	const reset = () => {
		setName("");
		setRoots([]);
		setWorking(false);
	};

	const handleOpenChange = (next: boolean) => {
		if (!next && working) return;
		if (!next) reset();
		onOpenChange(next);
	};

	const handleAddRoot = (root: WorkspaceGroupRootInput) => {
		setRoots((current) => {
			// A folder root can't be added twice; a workspace root is de-duped by id.
			if (root.kind === "folder") {
				if (current.some((r) => r.folderPath === root.folderPath))
					return current;
			} else if (
				current.some(
					(r) => r.kind === "workspace" && r.workspaceId === root.workspaceId,
				)
			) {
				return current;
			}
			return [...current, root];
		});
	};

	const handleRemoveRoot = (index: number) => {
		setRoots((current) => current.filter((_, i) => i !== index));
	};

	const handleCreate = async () => {
		const trimmedName = name.trim();
		if (!trimmedName) {
			toast.error("Please enter a name");
			return;
		}
		setWorking(true);
		try {
			const group = await create({ name: trimmedName, roots });
			reset();
			onOpenChange(false);
			await navigate({
				to: "/v2-group/$groupId",
				params: { groupId: group.id },
			});
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Could not create multi-root workspace",
			);
			setWorking(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange} modal>
			<DialogContent className="max-w-[440px]">
				<DialogHeader>
					<DialogTitle>New multi-root workspace</DialogTitle>
					<DialogDescription>
						Group several repositories and folders into one workspace.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="group-name" className="text-xs">
							Name
						</Label>
						<Input
							id="group-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="My multi-root workspace"
							disabled={working}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !working) {
									void handleCreate();
								}
							}}
							autoFocus
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<div className="flex items-center justify-between">
							<Label className="text-xs">Roots (optional)</Label>
							<AddRootMenu
								existingWorkspaceIds={existingWorkspaceIds}
								onAddRoot={handleAddRoot}
								disabled={working}
							/>
						</div>
						{roots.length === 0 ? (
							<p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground select-text">
								No roots yet. You can add repositories and folders now or later.
							</p>
						) : (
							<ul className="flex flex-col gap-1">
								{roots.map((root, index) => (
									<li
										key={`${root.kind}:${root.workspaceId ?? root.folderPath}`}
										className={cn(
											"flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm",
										)}
									>
										{root.kind === "folder" ? (
											<LuFolder className="size-4 shrink-0 text-muted-foreground" />
										) : (
											<LuLayers className="size-4 shrink-0 text-muted-foreground" />
										)}
										<span
											className="min-w-0 flex-1 truncate"
											title={root.label}
										>
											{root.label}
										</span>
										<button
											type="button"
											aria-label={`Remove ${root.label}`}
											onClick={() => handleRemoveRoot(index)}
											disabled={working}
											className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
										>
											<LuX className="size-3.5" />
										</button>
									</li>
								))}
							</ul>
						)}
					</div>
				</div>

				<div className="flex justify-end gap-2">
					<Button
						type="button"
						variant="ghost"
						onClick={() => handleOpenChange(false)}
						disabled={working}
					>
						Cancel
					</Button>
					<Button
						type="button"
						onClick={() => void handleCreate()}
						disabled={working || name.trim().length === 0}
						className="gap-1.5"
					>
						{working && <LuLoaderCircle className="size-4 animate-spin" />}
						Create
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
