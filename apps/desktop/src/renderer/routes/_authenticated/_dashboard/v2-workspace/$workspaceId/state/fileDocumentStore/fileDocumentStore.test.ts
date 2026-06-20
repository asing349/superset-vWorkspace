import { describe, expect, test } from "bun:test";
import type { workspaceTrpc } from "@superset/workspace-client";
import {
	acquireDocument,
	documentAddressingKey,
	getDocument,
	releaseDocument,
} from "./fileDocumentStore";

type WorkspaceTrpcClient = ReturnType<typeof workspaceTrpc.createClient>;

/** Recorded args of a single `filesystem.writeFile.mutate` call. */
type WriteFileArgs = Parameters<
	WorkspaceTrpcClient["filesystem"]["writeFile"]["mutate"]
>[0];

/**
 * Wave-2 M2 — document-cache addressing key.
 *
 * Regression coverage for the bug where `acquireDocument` keyed the document
 * cache by `${workspaceId}:${absolutePath}` only. A `kind: "workspace"` group
 * root reuses its REAL `workspaceId`, so the same absolute path opened first in
 * the single-workspace surface (`groupAddressing = null`) and then inside a
 * group (`groupAddressing = { groupId, rootId }`) collided on the cache key and
 * silently reused the WRONG addressing — routing reads/writes through the wrong
 * root's FS service. The fix folds the addressing discriminator into the key so
 * a document's identity is `(addressing, absolutePath)`.
 */

/**
 * Minimal stub trpc client. `acquireDocument` fires `loadEntry`, which calls
 * `filesystem.readFile.query`; we return a resolved text result so the load
 * settles without a real IPC transport. Only the shape the store reads is
 * implemented; the cast narrows it to the full client type for the call site.
 */
function makeStubClient(): WorkspaceTrpcClient {
	const stub = {
		filesystem: {
			readFile: {
				query: async () => ({
					kind: "text" as const,
					content: "",
					revision: "r0",
					byteLength: 0,
					exceededLimit: false,
				}),
			},
		},
	};
	return stub as unknown as WorkspaceTrpcClient;
}

/**
 * Stub client that records every `filesystem.writeFile.mutate` call into
 * `writes`, so a `save()` can be asserted on the addressing it sent. `readFile`
 * returns seeded text with a known revision so the document loads as editable
 * text (required for `save()` to take the text path).
 */
function makeRecordingClient(seed: { content: string; revision: string }): {
	client: WorkspaceTrpcClient;
	writes: WriteFileArgs[];
} {
	const writes: WriteFileArgs[] = [];
	const stub = {
		filesystem: {
			readFile: {
				query: async () => ({
					kind: "text" as const,
					content: seed.content,
					revision: seed.revision,
					byteLength: seed.content.length,
					exceededLimit: false,
				}),
			},
			writeFile: {
				mutate: async (args: WriteFileArgs) => {
					writes.push(args);
					return { ok: true as const, revision: "r-after" };
				},
			},
		},
	};
	return { client: stub as unknown as WorkspaceTrpcClient, writes };
}

describe("documentAddressingKey", () => {
	test("workspace addressing → ws:<workspaceId>", () => {
		expect(documentAddressingKey("ws-1", null)).toBe("ws:ws-1");
	});

	test("group addressing → group:<groupId>:<rootId> (ignores workspaceId surrogate)", () => {
		expect(
			documentAddressingKey("folder:root-9", {
				groupId: "grp-1",
				rootId: "root-9",
			}),
		).toBe("group:grp-1:root-9");
	});

	test("mirrors readAddressing/writeAddressing choice: groupAddressing wins when present", () => {
		// Same real workspaceId, but the two addressings must produce DIFFERENT
		// discriminators — this is the collision the fix removes.
		const single = documentAddressingKey("ws-shared", null);
		const grouped = documentAddressingKey("ws-shared", {
			groupId: "grp-1",
			rootId: "root-shared",
		});
		expect(single).not.toBe(grouped);
	});
});

describe("acquireDocument cache keying by (addressing, absolutePath)", () => {
	test("same path, different addressing → DISTINCT cache entries", () => {
		const client = makeStubClient();
		const path = "/repo/src/index.ts";

		// Single-workspace surface for ws-shared.
		const singleDoc = acquireDocument("ws-shared", path, client, null);
		// Same real workspaceId, but opened inside a group as a workspace root.
		const groupDoc = acquireDocument("ws-shared", path, client, {
			groupId: "grp-1",
			rootId: "root-shared",
		});

		// Distinct identities → no silent addressing reuse across surfaces.
		expect(singleDoc.id).not.toBe(groupDoc.id);

		releaseDocument("ws-shared", path, null);
		releaseDocument("ws-shared", path, {
			groupId: "grp-1",
			rootId: "root-shared",
		});
	});

	test("same path + same addressing → SHARED cache entry", () => {
		const client = makeStubClient();
		const path = "/repo/src/shared.ts";

		const a = acquireDocument("ws-1", path, client, null);
		const b = acquireDocument("ws-1", path, client, null);
		expect(a.id).toBe(b.id);

		releaseDocument("ws-1", path, null);
		releaseDocument("ws-1", path, null);
	});

	test("releasing one addressing does not free the other (no double-free / leak)", () => {
		const client = makeStubClient();
		const path = "/repo/src/leak-check.ts";
		const grouped = { groupId: "grp-2", rootId: "root-x" };

		acquireDocument("ws-2", path, client, null);
		const groupDoc = acquireDocument("ws-2", path, client, grouped);
		const groupId = groupDoc.id;

		// Fully release the single-workspace entry (refCount 1 → 0 → evicted).
		releaseDocument("ws-2", path, null);

		// The group entry must still be resolvable under its own key.
		const stillThere = getDocument("ws-2", path, grouped);
		expect(stillThere).not.toBeNull();
		expect(stillThere?.id).toBe(groupId);

		// And the single-workspace entry must now be gone (distinct key, freed).
		expect(getDocument("ws-2", path, null)).toBeNull();

		releaseDocument("ws-2", path, grouped);
	});

	test("getDocument resolves by addressing — wrong addressing misses", () => {
		const client = makeStubClient();
		const path = "/repo/src/lookup.ts";
		const grouped = { groupId: "grp-3", rootId: "root-y" };

		acquireDocument("folder:root-y", path, client, grouped);

		// Looking up with the group addressing finds it.
		expect(getDocument("folder:root-y", path, grouped)).not.toBeNull();
		// Looking up the same surrogate workspaceId WITHOUT addressing misses,
		// because the doc lives under the `group:` key, not the `ws:` key.
		expect(getDocument("folder:root-y", path, null)).toBeNull();

		releaseDocument("folder:root-y", path, grouped);
	});
});

/**
 * Wave-2 M1 / M9 — folder-root save addressing (`writeAddressing()`).
 *
 * `save()` spreads `writeAddressing(entry)` into `filesystem.writeFile.mutate`.
 * The host write procedures accept the `{ workspaceId } | { groupId, rootId }`
 * union (M1), so a document carrying `groupAddressing` MUST produce a write
 * addressed by `{ groupId, rootId }` (the only addressing a `kind: "folder"`
 * root has — its `workspaceId` field is a `folder:<rootId>` cache surrogate the
 * host can't resolve), while a single-workspace document MUST produce a write
 * addressed by `{ workspaceId }` byte-for-byte as before.
 */
describe("save() write addressing (folder-root vs workspace)", () => {
	// `acquireDocument` fires `void loadEntry(entry)`; wait for the text content
	// to settle so the handle's content.kind is "text" before saving.
	async function waitForText(
		doc: ReturnType<typeof acquireDocument>,
	): Promise<void> {
		for (let i = 0; i < 50; i += 1) {
			if (doc.content.kind === "text") return;
			await Promise.resolve();
		}
		throw new Error(`document did not load as text (kind=${doc.content.kind})`);
	}

	test("group-addressed document saves via { groupId, rootId }", async () => {
		const { client, writes } = makeRecordingClient({
			content: "before",
			revision: "r0",
		});
		const path = "/some/folder/notes.md";
		const grouped = { groupId: "grp-1", rootId: "root-1" };

		// `kind:"folder"` roots use a `folder:<rootId>` surrogate workspaceId.
		const doc = acquireDocument("folder:root-1", path, client, grouped);
		await waitForText(doc);

		doc.setContent("after");
		const result = await doc.save();

		expect(result.status).toBe("saved");
		expect(writes).toHaveLength(1);
		const sent = writes[0];
		// Routed by the group addressing — NOT the surrogate workspaceId.
		expect(sent).toMatchObject({
			groupId: "grp-1",
			rootId: "root-1",
			absolutePath: path,
			content: "after",
			encoding: "utf-8",
		});
		expect("workspaceId" in (sent ?? {})).toBe(false);
		// Optimistic-concurrency precondition uses the loaded revision.
		expect(sent?.precondition).toEqual({ ifMatch: "r0" });

		releaseDocument("folder:root-1", path, grouped);
	});

	test("single-workspace document saves via { workspaceId } (unchanged path)", async () => {
		const { client, writes } = makeRecordingClient({
			content: "before",
			revision: "r0",
		});
		const path = "/repo/src/main.ts";

		const doc = acquireDocument("ws-77", path, client, null);
		await waitForText(doc);

		doc.setContent("after");
		const result = await doc.save();

		expect(result.status).toBe("saved");
		expect(writes).toHaveLength(1);
		const sent = writes[0];
		expect(sent).toMatchObject({
			workspaceId: "ws-77",
			absolutePath: path,
			content: "after",
			encoding: "utf-8",
		});
		// No group fields leak into the single-workspace write.
		expect("groupId" in (sent ?? {})).toBe(false);
		expect("rootId" in (sent ?? {})).toBe(false);

		releaseDocument("ws-77", path, null);
	});
});
