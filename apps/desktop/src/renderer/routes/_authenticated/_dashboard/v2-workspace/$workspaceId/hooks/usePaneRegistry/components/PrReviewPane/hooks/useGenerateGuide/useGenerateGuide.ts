import { toast } from "@superset/ui/sonner";
import { useCallback, useState } from "react";
import type { PrReviewGuide } from "../../types";

export interface UseGenerateGuideArgs {
	projectId: string;
	prNumber: number;
}

export interface UseGenerateGuideResult {
	/** The generated guide, or null until the user clicks Generate (M2: always null). */
	guide: PrReviewGuide | null;
	/** True while a generation is in flight. */
	isGenerating: boolean;
	/**
	 * Whether the cached guide is stale vs the PR's current head SHA (M6). M2
	 * has no cache, so always false — the "Regenerate" button never shows yet.
	 */
	isStale: boolean;
	/** Trigger generation. The ONLY way a guide is ever produced (A2). */
	generate: () => void;
}

/**
 * Owns the Guide tab's generate flow (Wave 5, M2 seam).
 *
 * The guide is produced ONLY by an explicit button press — never on open, view,
 * or new commits (plan A2). The host `prReview.generateGuide({ projectId,
 * prNumber })` is OWNED BY the "guide" teammate (M4) and has NOT landed on the
 * host router yet, so M2 does not call it: `generate` surfaces a clear
 * "coming soon" toast and `guide` stays null. When M4 lands `generateGuide`,
 * this hook is the single swap point — wire `generate` to
 * `workspaceTrpc.prReview.generateGuide.useMutation()` and set `guide` from its
 * output (the `PrReviewGuide` shape the Guide tab already renders), plus read
 * the cache + head-SHA staleness for `isStale` (M6). No Guide-tab UI change is
 * needed.
 */
export function useGenerateGuide(
	_args: UseGenerateGuideArgs,
): UseGenerateGuideResult {
	const [isGenerating] = useState(false);
	const [guide] = useState<PrReviewGuide | null>(null);

	const generate = useCallback(() => {
		// M4 replaces this body with the real local-AI-session generation. Until
		// then, be explicit that nothing ran (honors "never generate on its own"
		// AND "no surprise AI runs").
		toast.info("Guide generation is coming soon", {
			description:
				"The memory-grounded review guide lands with the guide generator.",
		});
	}, []);

	return {
		guide,
		isGenerating,
		isStale: false,
		generate,
	};
}
