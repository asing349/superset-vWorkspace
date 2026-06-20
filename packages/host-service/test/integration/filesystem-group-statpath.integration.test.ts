import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TRPCClientError } from "@trpc/client";
import { type BasicScenario, createBasicScenario } from "../helpers/scenarios";

/**
 * Wave-2 M7: `filesystem.statPath` accepts the same
 * `{ workspaceId } | { groupId, rootId }` addressing union the read/write
 * procedures already use, routing the group form through the runtime's
 * `resolveRootPath`. This is what makes combined-agent / folder-root terminal
 * output paths statt-able (and thus clickable) by the renderer for folder
 * roots, which have no `workspaceId` and can only be reached via the group
 * form. These tests drive the real tRPC router against a `kind: "folder"`
 * root — the headline case M7 unlocks.
 */
describe("filesystem router: group-addressed statPath", () => {
	let scenario: BasicScenario;
	let folderRoot: string;
	let groupId: string;
	let rootId: string;

	beforeEach(async () => {
		scenario = await createBasicScenario();

		// A plain folder root: an arbitrary directory with no workspaceId.
		// `realpathSync` canonicalizes the temp path (on macOS `/var/...` is a
		// symlink to `/private/var/...`) so resolved paths match what the stored
		// folder-root path resolves to.
		folderRoot = realpathSync(
			mkdtempSync(join(tmpdir(), "group-stat-folder-")),
		);

		const group = await scenario.host.trpc.workspaceGroup.create.mutate({
			name: "stat group",
			roots: [
				{
					kind: "folder",
					workspaceId: null,
					folderPath: folderRoot,
					label: "Folder",
				},
			],
		});
		groupId = group.id;
		const firstRoot = group.roots[0];
		if (!firstRoot) {
			throw new Error("expected group to have one root");
		}
		rootId = firstRoot.rootId;
	});

	afterEach(async () => {
		await scenario?.dispose();
		rmSync(folderRoot, { recursive: true, force: true });
	});

	test("statPath resolves a relative path inside a folder root via { groupId, rootId }", async () => {
		writeFileSync(join(folderRoot, "stat-target.txt"), "x");
		const result = await scenario.host.trpc.filesystem.statPath.mutate({
			groupId,
			rootId,
			path: "stat-target.txt",
		});
		expect(result).not.toBeNull();
		expect(result?.isDirectory).toBe(false);
		expect(result?.resolvedPath).toBe(join(folderRoot, "stat-target.txt"));
	});

	test("statPath resolves a directory inside a folder root", async () => {
		const subdir = join(folderRoot, "subdir");
		mkdirSync(subdir, { recursive: true });
		const result = await scenario.host.trpc.filesystem.statPath.mutate({
			groupId,
			rootId,
			path: "subdir",
		});
		expect(result).not.toBeNull();
		expect(result?.isDirectory).toBe(true);
		expect(result?.resolvedPath).toBe(subdir);
	});

	test("statPath accepts an absolute path under the folder root via the group form", async () => {
		const abs = join(folderRoot, "abs-target.txt");
		writeFileSync(abs, "x");
		const result = await scenario.host.trpc.filesystem.statPath.mutate({
			groupId,
			rootId,
			path: abs,
		});
		expect(result).not.toBeNull();
		expect(result?.isDirectory).toBe(false);
		expect(result?.resolvedPath).toBe(abs);
	});

	test("statPath returns null for a nonexistent path in the group form", async () => {
		const result = await scenario.host.trpc.filesystem.statPath.mutate({
			groupId,
			rootId,
			path: "nope.txt",
		});
		expect(result).toBeNull();
	});

	test("unknown rootId in the group form is rejected", async () => {
		await expect(
			scenario.host.trpc.filesystem.statPath.mutate({
				groupId,
				rootId: "no-such-root",
				path: "stat-target.txt",
			}),
		).rejects.toBeInstanceOf(TRPCClientError);
	});

	test("existing { workspaceId } statPath form is unchanged", async () => {
		// Regression: the additive union must not narrow the original form.
		writeFileSync(join(scenario.repo.repoPath, "ws-stat-target.txt"), "x");
		const result = await scenario.host.trpc.filesystem.statPath.mutate({
			workspaceId: scenario.workspaceId,
			path: "ws-stat-target.txt",
		});
		expect(result).not.toBeNull();
		expect(result?.isDirectory).toBe(false);
		expect(result?.resolvedPath).toBe(
			join(scenario.repo.repoPath, "ws-stat-target.txt"),
		);
	});
});
