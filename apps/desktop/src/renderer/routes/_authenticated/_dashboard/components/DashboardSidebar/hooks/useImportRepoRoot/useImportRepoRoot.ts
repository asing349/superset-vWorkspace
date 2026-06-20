import { useCallback } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { getBaseName } from "renderer/lib/pathBasename";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

/**
 * A registered/known project candidate the folder maps to, as surfaced by the
 * host `project.findByPath` procedure. `id` is the host project id — the exact
 * value `project.setup`/`workspaces.create` resolve via `requireLocalProject`.
 */
export interface ImportRepoCandidate {
	id: string;
	name: string;
}

/**
 * Classification of a picked folder, derived from host `project.findByPath`
 * WITHOUT performing any import/setup side effect. Lets the caller branch the UI
 * (Wave-2 M4) before committing to register the repo.
 *
 *  - `not-a-repo`  — the folder is not a git repo (host `needsGitInit`). The
 *                    caller keeps the plain-folder behavior (add a `kind:"folder"`
 *                    root — now editable via M1). We deliberately do NOT offer to
 *                    `git init` inside the group flow.
 *  - `ambiguous`   — more than one project claims this repo. The caller can't pick
 *                    safely; surface a clear message and bail.
 *  - `importable`  — exactly one matchable project (`candidate`) OR no candidate
 *                    at all (`candidate: null` → register a brand-new project).
 *                    Both resolve to a single project id via `ensureProject`.
 */
export type FolderRepoClassification =
	| { kind: "not-a-repo" }
	| { kind: "ambiguous"; candidates: ImportRepoCandidate[] }
	| { kind: "importable"; candidate: ImportRepoCandidate | null };

/**
 * Resolves a picked/dropped folder into a first-class, worktree-capable host
 * project (Wave-2 M4), reusing the SAME host project procedures the existing
 * folder-first import drives (`project.findByPath` / `project.setup` /
 * `project.create` importLocal). It writes NO git/clone/worktree/import code of
 * its own — it only composes those procedures. The resulting `projectId` is then
 * handed to M3's create-worktree-and-add flow by the caller.
 *
 * Two entry points:
 *  - `inspectFolder` — pure classification (no side effect), so the UI can decide
 *    whether to keep plain-folder behavior or proceed to worktree creation.
 *  - `ensureProject` — performs the actual setup/create and returns the project
 *    id. Mirrors `useFolderFirstImport`'s setup-vs-create decision exactly:
 *    a single candidate → `project.setup` (reconciles a known local project AND
 *    sets up a cloud-known-but-not-local one); no candidate → `project.create`
 *    (importLocal) to register a brand-new project.
 *
 * Same-host only (A1): all calls go to the local host URL.
 */
export function useImportRepoRoot(): {
	inspectFolder: (input: {
		folderPath: string;
	}) => Promise<FolderRepoClassification>;
	ensureProject: (input: { folderPath: string }) => Promise<{
		projectId: string;
	}>;
} {
	const { activeHostUrl } = useLocalHostService();

	const requireClient = useCallback(() => {
		if (!activeHostUrl) {
			throw new Error(
				"The local host service is not available. Importing a repository requires a running host.",
			);
		}
		return getHostServiceClientByUrl(activeHostUrl);
	}, [activeHostUrl]);

	const inspectFolder = useCallback(
		async (input: {
			folderPath: string;
		}): Promise<FolderRepoClassification> => {
			const client = requireClient();
			const response = await client.project.findByPath.query({
				repoPath: input.folderPath,
			});

			// `needsGitInit` is only present on the not-a-repo branch.
			if ("needsGitInit" in response && response.needsGitInit) {
				return { kind: "not-a-repo" };
			}

			const candidates: ImportRepoCandidate[] = response.candidates.map(
				(candidate) => ({ id: candidate.id, name: candidate.name }),
			);

			// No candidate, but cloud was unreachable: surfacing "importable"
			// here could create a duplicate cloud project. Treat as a repo with no
			// matching project (caller registers a fresh one) ONLY when there is no
			// cloud error; otherwise let `ensureProject` fail loudly with the cloud
			// message rather than silently double-creating.
			if (candidates.length === 0 && response.cloudErrors.length > 0) {
				throw new Error(
					`Couldn't reach cloud for ${response.cloudErrors[0].url}: ${response.cloudErrors[0].message}`,
				);
			}

			if (candidates.length > 1) {
				return { kind: "ambiguous", candidates };
			}

			return { kind: "importable", candidate: candidates[0] ?? null };
		},
		[requireClient],
	);

	const ensureProject = useCallback(
		async (input: { folderPath: string }): Promise<{ projectId: string }> => {
			const client = requireClient();
			const classification = await inspectFolder({
				folderPath: input.folderPath,
			});

			switch (classification.kind) {
				case "not-a-repo":
					throw new Error(
						"This folder is not a git repository, so it can't be set up as a worktree-capable project.",
					);
				case "ambiguous":
					throw new Error(
						`Multiple projects use this repository (${classification.candidates.length}). Open the project you want from settings to set it up on this device first.`,
					);
				case "importable": {
					if (classification.candidate) {
						// A matchable/known project exists (local row or cloud-known).
						// `project.setup` reconciles both: it sets up a cloud-known
						// project on this device and is a no-op repoint for an already-
						// local one.
						const setupResult = await client.project.setup.mutate({
							projectId: classification.candidate.id,
							mode: { kind: "import", repoPath: input.folderPath },
						});
						// `setup` returns { repoPath, mainWorkspaceId }; the project id is
						// the candidate id we passed in.
						void setupResult;
						return { projectId: classification.candidate.id };
					}
					// No matching project: register this repo as a brand-new project.
					const createResult = await client.project.create.mutate({
						name: getBaseName(input.folderPath),
						mode: { kind: "importLocal", repoPath: input.folderPath },
					});
					return { projectId: createResult.projectId };
				}
			}
		},
		[inspectFolder, requireClient],
	);

	return { inspectFolder, ensureProject };
}
