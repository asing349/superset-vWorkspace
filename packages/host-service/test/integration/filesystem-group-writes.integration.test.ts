import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TRPCClientError } from "@trpc/client";
import { type BasicScenario, createBasicScenario } from "../helpers/scenarios";

/**
 * Wave-2 M1: the filesystem WRITE procedures accept the same
 * `{ workspaceId } | { groupId, rootId }` addressing union the read
 * procedures already use, routing the group form through
 * `getServiceForRootId`. These tests drive the real tRPC router so they
 * exercise the schema union AND the routing, against a `kind: "folder"`
 * root (which has no `workspaceId` and can only be reached via the group
 * form) — the headline case M1 unlocks.
 */
describe("filesystem router: group-addressed write procedures", () => {
	let scenario: BasicScenario;
	let folderRoot: string;
	let groupId: string;
	let rootId: string;

	beforeEach(async () => {
		scenario = await createBasicScenario();

		// A plain folder root: an arbitrary directory with no workspaceId.
		// `realpathSync` canonicalizes the temp path (on macOS `/var/...` is a
		// symlink to `/private/var/...`) so it matches the realpath-based
		// sandbox checks `move`/`delete`/`copy` perform on their targets.
		folderRoot = realpathSync(
			mkdtempSync(join(tmpdir(), "group-write-folder-")),
		);

		const group = await scenario.host.trpc.workspaceGroup.create.mutate({
			name: "writes group",
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

	test("writeFile writes into a folder root via { groupId, rootId }", async () => {
		const filePath = join(folderRoot, "written.txt");
		await scenario.host.trpc.filesystem.writeFile.mutate({
			groupId,
			rootId,
			absolutePath: filePath,
			content: "from-group-form",
			options: { create: true, overwrite: true },
		});
		expect(readFileSync(filePath, "utf8")).toBe("from-group-form");
	});

	test("writeFile accepts base64 content via the group form", async () => {
		const filePath = join(folderRoot, "binary.bin");
		const bytes = Buffer.from([0, 1, 2, 250, 255]);
		await scenario.host.trpc.filesystem.writeFile.mutate({
			groupId,
			rootId,
			absolutePath: filePath,
			content: { kind: "base64", data: bytes.toString("base64") },
			options: { create: true, overwrite: true },
		});
		expect(readFileSync(filePath)).toEqual(bytes);
	});

	test("createDirectory creates a directory in a folder root", async () => {
		const dirPath = join(folderRoot, "nested", "dir");
		await scenario.host.trpc.filesystem.createDirectory.mutate({
			groupId,
			rootId,
			absolutePath: dirPath,
			recursive: true,
		});
		expect(existsSync(dirPath)).toBe(true);
	});

	test("deletePath removes a file in a folder root", async () => {
		const filePath = join(folderRoot, "to-delete.txt");
		writeFileSync(filePath, "bye");
		await scenario.host.trpc.filesystem.deletePath.mutate({
			groupId,
			rootId,
			absolutePath: filePath,
			permanent: true,
		});
		expect(existsSync(filePath)).toBe(false);
	});

	test("movePath renames a file within a folder root", async () => {
		const sourcePath = join(folderRoot, "src.txt");
		const destPath = join(folderRoot, "dest.txt");
		writeFileSync(sourcePath, "move-me");
		await scenario.host.trpc.filesystem.movePath.mutate({
			groupId,
			rootId,
			sourceAbsolutePath: sourcePath,
			destinationAbsolutePath: destPath,
		});
		expect(existsSync(sourcePath)).toBe(false);
		expect(readFileSync(destPath, "utf8")).toBe("move-me");
	});

	test("copyPath duplicates a file within a folder root", async () => {
		const sourcePath = join(folderRoot, "orig.txt");
		const destPath = join(folderRoot, "copy.txt");
		writeFileSync(sourcePath, "copy-me");
		await scenario.host.trpc.filesystem.copyPath.mutate({
			groupId,
			rootId,
			sourceAbsolutePath: sourcePath,
			destinationAbsolutePath: destPath,
		});
		expect(readFileSync(sourcePath, "utf8")).toBe("copy-me");
		expect(readFileSync(destPath, "utf8")).toBe("copy-me");
	});

	test("group-addressed writes stay sandboxed to the folder root", async () => {
		const escapePath = join(folderRoot, "..", "escape.txt");
		await expect(
			scenario.host.trpc.filesystem.writeFile.mutate({
				groupId,
				rootId,
				absolutePath: escapePath,
				content: "should-not-write",
				options: { create: true, overwrite: true },
			}),
		).rejects.toBeInstanceOf(TRPCClientError);
		expect(existsSync(escapePath)).toBe(false);
	});

	test("unknown rootId in the group form is rejected", async () => {
		await expect(
			scenario.host.trpc.filesystem.writeFile.mutate({
				groupId,
				rootId: "no-such-root",
				absolutePath: join(folderRoot, "nope.txt"),
				content: "x",
				options: { create: true, overwrite: true },
			}),
		).rejects.toBeInstanceOf(TRPCClientError);
	});

	test("existing { workspaceId } write form is unchanged", async () => {
		// Regression: the additive union must not narrow the original form.
		const filePath = join(scenario.repo.repoPath, "ws-written.txt");
		await scenario.host.trpc.filesystem.writeFile.mutate({
			workspaceId: scenario.workspaceId,
			absolutePath: filePath,
			content: "via-workspace-id",
			options: { create: true, overwrite: true },
		});
		expect(readFileSync(filePath, "utf8")).toBe("via-workspace-id");
	});
});
