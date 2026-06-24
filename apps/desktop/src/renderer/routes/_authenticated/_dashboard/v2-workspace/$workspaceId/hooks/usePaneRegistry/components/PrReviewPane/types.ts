import type { AppRouter } from "@superset/host-service";
import type { inferRouterOutputs } from "@trpc/server";

/**
 * Guide artifact types for the Guide tab (Wave 5, M5) — DERIVED from the host
 * router output, the single source of truth.
 *
 * In M2 these were mirrored renderer-locally because `prReview.generateGuide` /
 * `getCachedGuide` had not landed yet. They are now live, so M5 reconciles to a
 * single source of truth: `getCachedGuide` returns
 * `{ guide: PrReviewGuide; stale: boolean } | null`, so `PrReviewGuide` is
 * exactly the non-null `guide` of that output (identical to the `generateGuide`
 * mutation's output). This is a TYPE-ONLY import (erased at build) — NO runtime
 * host dependency, so the renderer stays browser-safe (the host's
 * `guide-types.ts` itself imports `@superset/memory`, which the browser must
 * not pull in at runtime; `inferRouterOutputs` only reads the structural type)
 * and the guide shape can never drift from what the procedure returns.
 *
 * The host's `PrReviewGuide` carries extra fields the renderer doesn't paint
 * (e.g. `areaTags`, `headSha`); deriving the whole type keeps them available and
 * authoritative rather than re-declaring a subset.
 */

type PrReviewOutputs = inferRouterOutputs<AppRouter>["prReview"];

/** `{ guide, stale } | null` — exactly what `getCachedGuide` returns. */
export type CachedGuideResult = PrReviewOutputs["getCachedGuide"];

/**
 * The computed Guide artifact the Guide tab renders — the non-null `guide` of
 * the cached result (identical to the `generateGuide` mutation's output).
 */
export type PrReviewGuide = PrReviewOutputs["generateGuide"];

/** One section of the guide ({ id, title, items }). */
export type GuideSection = PrReviewGuide["sections"][number];

/** One claim within a guide section ({ text, anchor?, severity?, href? }). */
export type GuideItem = GuideSection["items"][number];

/** A code anchor attached to a guide claim ({ file, line?, symbol? }). */
export type GuideAnchor = NonNullable<GuideItem["anchor"]>;
