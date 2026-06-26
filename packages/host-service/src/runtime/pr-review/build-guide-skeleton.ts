import {
	type AreaTag,
	type DiffFileChange,
	type DiffFileStatus,
	distillDiffShape,
	type PlaybookStatus,
	type PracticeScope,
	type PracticeVersion,
	type ProjectIndexEntry,
	pathsToAreas,
	type RetrievalBundle,
} from "@superset/memory";
import type { FileStatus } from "../../trpc/router/git/types.ts";
import type {
	GuideAnchor,
	GuideItem,
	GuideRiskSeverity,
	GuideSection,
	PrDiffFile,
	PrDiffInput,
	PrReviewGuide,
} from "./guide-types.ts";

/**
 * Deterministic + memory-grounded guide skeleton (Wave 5, M3).
 *
 * `buildGuideSkeleton` is a PURE-ish function: given a PR diff (M1's contract)
 * and the memory grounding accessors, it derives area tags, pulls wave-3 memory
 * grounding, and renders the structured `PrReviewGuide`. NO MODEL — every
 * section is computed deterministically. M4 layers optional local-AI enrichment
 * on top of this baseline.
 *
 * Testability: the memory accessors are injected as narrow PORTS (not the
 * concrete service classes), so a test can build + exercise this with a fixture
 * diff and in-memory grounding, AND so it degrades cleanly when the repo is not
 * a locally-indexed project (no `projectId`, or memory empty).
 */

// ---------------------------------------------------------------------------
// Grounding ports (injected; satisfied by the host memory services / router)
// ---------------------------------------------------------------------------

/** The memory-retrieval bundle accessor (`ctx.runtime.memoryRetrieve.retrieve`). */
export interface GuideRetrievePort {
	retrieve(input: {
		projectId: string | null;
		intent: string;
		areaTags?: readonly AreaTag[];
	}): Promise<RetrievalBundle> | RetrievalBundle;
}

/** Status + entry accessors over the project index (`ctx.runtime.memoryIndex`). */
export interface GuideIndexPort {
	indexStatus(projectId: string): { indexed: boolean; entryCount: number };
	listEntries(projectId: string): ProjectIndexEntry[];
}

/** The Coding-Practice reader (`memory.getPractice` semantics). */
export interface GuidePracticePort {
	getPractice(input: { scope: PracticeScope; projectId: string | null }): {
		latest: PracticeVersion | null;
	};
}

/** The Playbook lister (`memory.listPlaybooks` semantics). */
export interface GuidePlaybook {
	id: string;
	intent: string;
	areaTags: AreaTag[];
	status: PlaybookStatus;
	confidence: number;
	provenance: { prNumber: number | null; url: string | null };
}

export interface GuidePlaybookPort {
	listPlaybooks(input: {
		projectId: string | null;
		status?: PlaybookStatus;
	}): GuidePlaybook[];
}

/** A single accepted observed business rule, narrowed for grounding (M6). */
export interface GuideBusinessRule {
	rule: string;
}

/**
 * Accepted observed business rules accessor (Wave 6, M6). The compounding
 * grounding layer the reviewer WROTE on prior reviews; OPTIONAL so the wave-5
 * guide path and existing fixtures (which don't supply it) keep working.
 */
export interface GuideBusinessRulesPort {
	listAccepted(projectId: string): GuideBusinessRule[];
}

/** All grounding accessors the builder needs, bundled for injection. */
export interface GuideGroundingServices {
	retrieve: GuideRetrievePort;
	index: GuideIndexPort;
	practice: GuidePracticePort;
	playbooks: GuidePlaybookPort;
	/** Accepted observed business rules (Wave 6, M6). Optional — empty when absent. */
	businessRules?: GuideBusinessRulesPort;
}

export interface BuildGuideSkeletonInput {
	diff: PrDiffInput;
	/**
	 * Host project id the PR belongs to, or null when the PR's repo is not a
	 * locally-indexed project — in which case grounding is skipped and the guide
	 * degrades to diff-only sections.
	 */
	projectId: string | null;
	services: GuideGroundingServices;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** A single file changing more than this many lines is a "large churn" risk. */
const LARGE_FILE_CHURN = 400;
/** A change touching more than this many files is a "large change" risk. */
const LARGE_FILE_COUNT = 30;
/** How many "read first" files to enumerate explicitly. */
const MAX_READ_FIRST = 12;
/** How many prior playbooks / index slices to surface. */
const MAX_PLAYBOOKS = 5;
const MAX_INDEX_SLICES = 8;

// ---------------------------------------------------------------------------
// Diff status mapping + helpers
// ---------------------------------------------------------------------------

/** Map a PR diff file's `FileStatus` onto the memory `DiffFileStatus`. */
function toDiffFileStatus(status: FileStatus): DiffFileStatus {
	switch (status) {
		case "added":
		case "modified":
		case "deleted":
		case "renamed":
		case "copied":
		case "untracked":
			return status;
		default:
			return "changed";
	}
}

/** Project the PR diff files onto the `DiffFileChange[]` the distillers consume. */
function toChangedFiles(files: readonly PrDiffFile[]): DiffFileChange[] {
	return files.map((file) => ({
		path: file.filename,
		status: toDiffFileStatus(file.status),
		additions: file.additions,
		deletions: file.deletions,
	}));
}

function churnOf(file: PrDiffFile): number {
	return file.additions + file.deletions;
}

/** A code anchor pointing at the head (new) side of a file. */
function fileAnchor(file: string): GuideAnchor {
	return { file };
}

/** Lowercase basename without directories, for keyword matching. */
function baseName(path: string): string {
	const slash = path.lastIndexOf("/");
	return (slash >= 0 ? path.slice(slash + 1) : path).toLowerCase();
}

function isTestPath(path: string): boolean {
	return (
		/(?:^|\/)[^/]*\.(?:test|spec)\.[cm]?[tj]sx?$/.test(path) ||
		/(?:^|\/)__tests__\//.test(path) ||
		/(?:^|\/)test\//.test(path)
	);
}

function isMigrationPath(path: string): boolean {
	return (
		/(?:^|\/)drizzle\//.test(path) ||
		/(?:^|\/)migrations?\//.test(path) ||
		/\.sql$/.test(path)
	);
}

function isSchemaPath(path: string): boolean {
	return (
		isMigrationPath(path) ||
		/(?:^|\/)schema(?:\.[cm]?[tj]sx?|\/)/.test(path) ||
		path.startsWith("packages/db/") ||
		path.startsWith("packages/local-db/")
	);
}

function isAuthPath(path: string): boolean {
	return (
		path.startsWith("packages/auth/") ||
		/(?:^|\/)auth(?:\.[cm]?[tj]sx?|\/)/.test(path) ||
		/\b(?:login|session|token|credential)\b/.test(baseName(path))
	);
}

function isLockfilePath(path: string): boolean {
	const name = baseName(path);
	return (
		name === "bun.lock" ||
		name === "bun.lockb" ||
		name === "package-lock.json" ||
		name === "yarn.lock" ||
		name === "pnpm-lock.yaml"
	);
}

function isEntryOrConfigPath(path: string): boolean {
	const name = baseName(path);
	return (
		name === "index.ts" ||
		name === "index.tsx" ||
		name === "main.ts" ||
		name === "app.ts" ||
		name === "serve.ts" ||
		name === "package.json" ||
		name === "tsconfig.json" ||
		/^tsconfig.*\.json$/.test(name) ||
		name === "biome.jsonc" ||
		name === "turbo.json" ||
		name === "drizzle.config.ts" ||
		/^\.env/.test(name)
	);
}

/** Does a patch remove an `export` line (a likely public-API removal)? */
function removesExport(patch: string | null): boolean {
	if (!patch) return false;
	for (const line of patch.split("\n")) {
		if (line.startsWith("-") && !line.startsWith("---")) {
			if (/\bexport\b/.test(line)) return true;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// Read-first / review-order priority
// ---------------------------------------------------------------------------

/**
 * Deterministic review priority. LOWER number = read first. The plan's order:
 * schema/migrations → entry/config/public-API → high-churn → tests last.
 */
function reviewPriority(file: PrDiffFile): number {
	const path = file.filename;
	if (isSchemaPath(path)) return 0;
	if (isEntryOrConfigPath(path)) return 1;
	if (removesExport(file.patch)) return 1;
	if (isTestPath(path)) return 4; // tests last
	if (churnOf(file) >= LARGE_FILE_CHURN) return 2; // high churn
	return 3;
}

const PRIORITY_LABEL: Record<number, string> = {
	0: "schema/migration",
	1: "entry/config/public-API",
	2: "high-churn",
	3: "core change",
	4: "tests",
};

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildAtAGlance(diff: PrDiffInput, areaTags: AreaTag[]): GuideSection {
	const changed = toChangedFiles(diff.files);
	const additions = diff.files.reduce((s, f) => s + f.additions, 0);
	const deletions = diff.files.reduce((s, f) => s + f.deletions, 0);
	const items: GuideItem[] = [
		{
			text: `PR #${diff.prNumber} into ${diff.baseBranch} at ${diff.headSha.slice(0, 7)}`,
		},
		{
			text: `${diff.files.length} file${diff.files.length === 1 ? "" : "s"} changed, +${additions}/-${deletions}`,
		},
	];
	const shape = distillDiffShape(changed);
	if (shape) items.push({ text: shape });
	if (areaTags.length > 0) {
		items.push({ text: `Areas touched: ${areaTags.join(", ")}` });
	}
	const firstBodyLine = firstNonEmptyLine(diff.body);
	if (firstBodyLine) items.push({ text: `Summary: ${firstBodyLine}` });
	return { id: "at-a-glance", title: "At a glance", items };
}

function firstNonEmptyLine(text: string | null): string | null {
	if (!text) return null;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.length > 0) return line;
	}
	return null;
}

function buildWhatChanged(diff: PrDiffInput): GuideSection {
	// Group files by area, then list each with its status + churn, anchored.
	const byArea = new Map<AreaTag, PrDiffFile[]>();
	for (const file of diff.files) {
		for (const area of pathsToAreas([file.filename])) {
			const list = byArea.get(area) ?? [];
			list.push(file);
			byArea.set(area, list);
		}
	}
	const items: GuideItem[] = [];
	for (const [area, files] of byArea) {
		items.push({ text: `${area} (${files.length})` });
		for (const file of files) {
			items.push({
				text: `  ${file.status}: ${file.filename} (+${file.additions}/-${file.deletions})`,
				anchor: fileAnchor(file.filename),
			});
		}
	}
	return { id: "what-changed", title: "What changed", items };
}

function buildReadFirst(diff: PrDiffInput): GuideSection {
	const ordered = [...diff.files].sort((a, b) => {
		const pa = reviewPriority(a);
		const pb = reviewPriority(b);
		if (pa !== pb) return pa - pb;
		// Within a priority band, higher churn first (more substantive).
		return churnOf(b) - churnOf(a);
	});
	const items: GuideItem[] = ordered
		.slice(0, MAX_READ_FIRST)
		.map((file, idx) => ({
			text: `${idx + 1}. ${file.filename} — ${PRIORITY_LABEL[reviewPriority(file)]}`,
			anchor: fileAnchor(file.filename),
		}));
	return { id: "read-first", title: "Read first / review order", items };
}

function buildRiskFlags(diff: PrDiffInput): GuideSection {
	const items: GuideItem[] = [];
	const flag = (
		text: string,
		severity: GuideRiskSeverity,
		anchor?: GuideAnchor,
	): void => {
		items.push({ text, severity, anchor });
	};

	let hasNonTestSource = false;
	let hasTest = false;
	for (const file of diff.files) {
		const path = file.filename;
		if (isTestPath(path)) {
			hasTest = true;
		} else if (/\.[cm]?[tj]sx?$/.test(path)) {
			hasNonTestSource = true;
		}

		if (isMigrationPath(path)) {
			flag(
				`Migration touched — review reversibility: ${path}`,
				"danger",
				fileAnchor(path),
			);
		}
		if (isAuthPath(path)) {
			flag(`Auth-sensitive change: ${path}`, "danger", fileAnchor(path));
		}
		if (removesExport(file.patch)) {
			flag(
				`Removes an export (possible public-API break): ${path}`,
				"warning",
				fileAnchor(path),
			);
		}
		if (churnOf(file) >= LARGE_FILE_CHURN) {
			flag(
				`Large churn in one file (+${file.additions}/-${file.deletions}): ${path}`,
				"warning",
				fileAnchor(path),
			);
		}
		if (isLockfilePath(path)) {
			flag(
				`Lockfile changed — verify dependency diffs: ${path}`,
				"info",
				fileAnchor(path),
			);
		}
	}

	if (diff.files.length >= LARGE_FILE_COUNT) {
		flag(
			`Large change set (${diff.files.length} files) — consider splitting review`,
			"warning",
		);
	}
	if (hasNonTestSource && !hasTest) {
		flag("No test files changed alongside source edits", "warning");
	}

	if (items.length === 0) {
		items.push({ text: "No automated risk flags raised.", severity: "info" });
	}
	return { id: "risk-flags", title: "Risk flags", items };
}

function buildProjectConventions(
	projectId: string,
	practice: GuidePracticePort,
): GuideSection {
	const items: GuideItem[] = [];
	const project = practice.getPractice({ scope: "project", projectId }).latest;
	const global = practice.getPractice({
		scope: "global",
		projectId: null,
	}).latest;
	for (const [label, version] of [
		["Project", project],
		["Global", global],
	] as const) {
		if (version) {
			const line = firstNonEmptyLine(version.content);
			items.push({
				text: `${label} practice (v${version.version})${line ? `: ${line}` : ""}`,
			});
		}
	}
	if (items.length === 0) {
		items.push({ text: "No consolidated Coding Practice yet." });
	}
	return {
		id: "project-conventions",
		title: "Project conventions",
		items,
	};
}

/** How many accepted observed business rules to surface in the guide. */
const MAX_BUSINESS_RULES = 12;

function buildObservedBusinessRules(
	rules: readonly GuideBusinessRule[],
): GuideSection {
	const items: GuideItem[] = rules
		.slice(0, MAX_BUSINESS_RULES)
		.map((rule) => ({ text: rule.rule }));
	return {
		id: "observed-business-rules",
		title: "Observed business rules",
		items,
	};
}

function buildPriorPlaybooks(
	projectId: string,
	areaTags: readonly AreaTag[],
	playbooks: GuidePlaybookPort,
): GuideSection {
	const areaSet = new Set(areaTags);
	const candidates = playbooks
		.listPlaybooks({ projectId })
		.filter(
			(p) =>
				p.status === "confirmed" && p.areaTags.some((tag) => areaSet.has(tag)),
		)
		.sort((a, b) => b.confidence - a.confidence)
		.slice(0, MAX_PLAYBOOKS);

	const items: GuideItem[] = candidates.map((p) => {
		const ref =
			p.provenance.prNumber !== null ? ` (PR #${p.provenance.prNumber})` : "";
		const item: GuideItem = { text: `${p.intent}${ref}` };
		if (p.provenance.url) item.href = p.provenance.url;
		return item;
	});
	if (items.length === 0) {
		items.push({ text: "No prior playbooks for these areas." });
	}
	return { id: "prior-playbooks", title: "Prior playbooks", items };
}

function buildWhereXLives(
	projectId: string,
	touchedPaths: ReadonlySet<string>,
	index: GuideIndexPort,
): GuideSection {
	// Prefer index entries for the touched files (their "where X lives" summary),
	// then fill with same-area entries up to the cap.
	const entries = index.listEntries(projectId);
	const touched = entries.filter((e) => touchedPaths.has(e.path));
	const rest = entries.filter((e) => !touchedPaths.has(e.path));
	const chosen = [...touched, ...rest].slice(0, MAX_INDEX_SLICES);

	const items: GuideItem[] = chosen.map((entry) => indexEntryToItem(entry));
	if (items.length === 0) {
		items.push({ text: "No project-index entries available." });
	}
	return { id: "where-x-lives", title: "Where things live", items };
}

function indexEntryToItem(entry: ProjectIndexEntry): GuideItem {
	const summary = entry.summary ? `: ${entry.summary}` : "";
	return {
		text: `${entry.path}${summary}`,
		anchor: { file: entry.path },
	};
}

function buildChecksAndThreads(
	diff: PrDiffInput,
	bundle: RetrievalBundle | null,
): GuideSection {
	const items: GuideItem[] = [];
	// Suggested local checks: prefer the commands prior playbooks proved to work.
	const commands = new Set<string>();
	if (bundle) {
		for (const p of bundle.playbooks) {
			for (const cmd of p.commands) commands.add(cmd);
		}
	}
	if (commands.size > 0) {
		items.push({ text: "Suggested checks (from prior playbooks):" });
		for (const cmd of commands) items.push({ text: `  ${cmd}` });
	} else {
		items.push({
			text: "No prior validation commands recorded for these areas.",
		});
	}
	items.push({
		text: `Review threads: fetch live from GitHub for PR #${diff.prNumber}.`,
	});
	return {
		id: "checks-and-threads",
		title: "Checks & threads",
		items,
	};
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Build the deterministic + memory-grounded guide skeleton for a PR diff.
 *
 * Always emits the diff-only sections (at-a-glance, what-changed, read-first,
 * risk-flags, checks). When the PR's repo IS a locally-indexed project
 * (`projectId` set AND the index has entries), it ALSO grounds the guide with
 * wave-3 memory: project conventions, prior playbooks, and where-X-lives. When
 * not indexed (or memory empty) it degrades to the diff-only baseline and marks
 * `grounded: false`.
 */
export async function buildGuideSkeleton(
	input: BuildGuideSkeletonInput,
): Promise<PrReviewGuide> {
	const { diff, projectId, services } = input;
	const touchedPaths = diff.files.map((f) => f.filename);
	const areaTags = pathsToAreas(touchedPaths);

	const sections: GuideSection[] = [
		buildAtAGlance(diff, areaTags),
		buildWhatChanged(diff),
		buildReadFirst(diff),
		buildRiskFlags(diff),
	];

	// Decide whether to ground: a locally-indexed project with a built index.
	let grounded = false;
	let bundle: RetrievalBundle | null = null;
	if (projectId !== null) {
		const status = services.index.indexStatus(projectId);
		if (status.indexed && status.entryCount > 0) {
			grounded = true;
			const intent =
				firstNonEmptyLine(diff.body) ?? `Review PR #${diff.prNumber}`;
			bundle = await services.retrieve.retrieve({
				projectId,
				intent,
				areaTags,
			});

			sections.push(
				buildProjectConventions(projectId, services.practice),
				buildPriorPlaybooks(projectId, areaTags, services.playbooks),
				buildWhereXLives(projectId, new Set(touchedPaths), services.index),
			);
		}
	}

	// Wave-6 M6: surface the project's ACCEPTED observed business rules — the
	// behavioral grounding the reviewer wrote on prior reviews. Independent of the
	// index-grounded branch (rules can exist without a built index); pushed only
	// when there are accepted rules, so the deterministic baseline stays unchanged.
	if (projectId !== null && services.businessRules) {
		const acceptedRules = services.businessRules.listAccepted(projectId);
		if (acceptedRules.length > 0) {
			sections.push(buildObservedBusinessRules(acceptedRules));
			grounded = true;
		}
	}

	sections.push(buildChecksAndThreads(diff, bundle));

	return {
		sections,
		prNumber: diff.prNumber,
		headSha: diff.headSha,
		areaTags,
		grounded,
	};
}
