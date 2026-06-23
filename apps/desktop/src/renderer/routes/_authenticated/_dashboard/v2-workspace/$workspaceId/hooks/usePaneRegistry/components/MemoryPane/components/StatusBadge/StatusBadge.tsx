import { cn } from "@superset/ui/utils";
import {
	type PlaybookStatus,
	statusLabel,
	statusTone,
} from "../../utils/memoryFormat";

const TONE_CLASS: Record<ReturnType<typeof statusTone>, string> = {
	positive:
		"bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
	warning:
		"bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
	muted: "bg-muted text-muted-foreground border-border",
	neutral: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
};

/** A small status chip for a Playbook (provisional/confirmed/demoted/archived). */
export function StatusBadge({
	status,
	className,
}: {
	status: PlaybookStatus;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
				TONE_CLASS[statusTone(status)],
				className,
			)}
		>
			{statusLabel(status)}
		</span>
	);
}
