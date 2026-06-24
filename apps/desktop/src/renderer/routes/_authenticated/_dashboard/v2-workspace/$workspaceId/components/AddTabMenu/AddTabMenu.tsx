import {
	DropdownMenuCheckboxItem,
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@superset/ui/dropdown-menu";
import { Brain } from "lucide-react";
import { BsTerminalPlus } from "react-icons/bs";
import { TbMessageCirclePlus, TbWorld } from "react-icons/tb";
import { HotkeyMenuShortcut } from "renderer/components/HotkeyMenuShortcut";
import { PullRequestsSubmenu } from "./components/PullRequestsSubmenu";

interface AddTabMenuProps {
	onAddTerminal: () => void;
	onAddChat: () => void;
	onAddBrowser: () => void;
	onOpenMemory: () => void;
	/** v2 project whose repo PRs the "Pull Requests" submenu lists. */
	projectId: string;
	/** Open the selected PR in a review window. */
	onOpenPullRequest: (prNumber: number) => void;
	showPresetsBar: boolean;
	onToggleShowPresetsBar: (enabled: boolean) => void;
}

export function AddTabMenu({
	onAddTerminal,
	onAddChat,
	onAddBrowser,
	onOpenMemory,
	projectId,
	onOpenPullRequest,
	showPresetsBar,
	onToggleShowPresetsBar,
}: AddTabMenuProps) {
	return (
		<>
			<DropdownMenuItem className="gap-2" onClick={onAddTerminal}>
				<BsTerminalPlus className="size-4" />
				<span>Terminal</span>
				<HotkeyMenuShortcut hotkeyId="NEW_GROUP" />
			</DropdownMenuItem>
			<DropdownMenuItem className="gap-2" onClick={onAddChat}>
				<TbMessageCirclePlus className="size-4" />
				<span>Chat</span>
				<HotkeyMenuShortcut hotkeyId="NEW_CHAT" />
			</DropdownMenuItem>
			<DropdownMenuItem className="gap-2" onClick={onAddBrowser}>
				<TbWorld className="size-4" />
				<span>Browser</span>
				<HotkeyMenuShortcut hotkeyId="NEW_BROWSER" />
			</DropdownMenuItem>
			<DropdownMenuItem className="gap-2" onClick={onOpenMemory}>
				<Brain className="size-4" />
				<span>Memory</span>
			</DropdownMenuItem>
			<PullRequestsSubmenu
				projectId={projectId}
				onOpenPullRequest={onOpenPullRequest}
			/>
			<DropdownMenuSeparator />
			<DropdownMenuCheckboxItem
				checked={showPresetsBar}
				onCheckedChange={(checked) => onToggleShowPresetsBar(checked === true)}
				onSelect={(event) => event.preventDefault()}
			>
				Show Preset Bar
			</DropdownMenuCheckboxItem>
		</>
	);
}
