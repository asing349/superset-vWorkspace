import { eq } from "drizzle-orm";
import type { HostDb } from "../../db";
import { linearLocalAuth } from "../../db/schema";
import { decryptToken, encryptToken } from "./crypto";
import type {
	LinearLocalConnectionStatus,
	SaveLinearAuthInput,
	StoredLinearAuth,
} from "./types";

// Wave-7 M1 — encrypted, host-local store for the single local Linear
// connection. Cloud-precedence means at most one local connection exists, so
// this is a singleton row keyed on `id = 1`. Tokens are encrypted on write and
// only ever decrypted for in-process callers (refresh / M2 poller).

const SINGLETON_ID = 1;

export class LinearLocalAuthStore {
	private readonly db: HostDb;

	constructor({ db }: { db: HostDb }) {
		this.db = db;
	}

	/** Persist (overwriting any prior connection) with tokens encrypted. */
	save(input: SaveLinearAuthInput): void {
		const now = Date.now();
		const mutable = {
			accessTokenEnc: encryptToken(input.accessToken),
			refreshTokenEnc: input.refreshToken
				? encryptToken(input.refreshToken)
				: null,
			expiresAt: input.expiresAt,
			scope: input.scope,
			viewerId: input.viewer?.id ?? null,
			viewerName: input.viewer?.name ?? null,
			viewerEmail: input.viewer?.email ?? null,
			workspaceId: input.workspace?.id ?? null,
			workspaceName: input.workspace?.name ?? null,
			updatedAt: now,
		};
		this.db
			.insert(linearLocalAuth)
			.values({ id: SINGLETON_ID, createdAt: now, ...mutable })
			.onConflictDoUpdate({ target: linearLocalAuth.id, set: mutable })
			.run();
	}

	/** Redaction boundary: status only, NEVER any token material. */
	getStatus(): LinearLocalConnectionStatus {
		const row = this.read();
		if (!row) return { connected: false };
		return {
			connected: true,
			viewer: row.viewerName ?? undefined,
			workspace: row.workspaceName ?? undefined,
			expiresAt: row.expiresAt ?? undefined,
		};
	}

	/** Host-internal: the decrypted token bundle. NEVER expose over tRPC. */
	getStored(): StoredLinearAuth | null {
		const row = this.read();
		if (!row) return null;
		return {
			accessToken: decryptToken(row.accessTokenEnc),
			refreshToken: row.refreshTokenEnc
				? decryptToken(row.refreshTokenEnc)
				: null,
			expiresAt: row.expiresAt,
			scope: row.scope,
			viewer: row.viewerId
				? {
						id: row.viewerId,
						name: row.viewerName ?? "",
						email: row.viewerEmail ?? undefined,
					}
				: null,
			workspace: row.workspaceId
				? { id: row.workspaceId, name: row.workspaceName ?? "" }
				: null,
		};
	}

	/** Host-internal accessor for the M2 poller / refresh. NEVER expose. */
	getAccessToken(): string | null {
		const row = this.read();
		return row ? decryptToken(row.accessTokenEnc) : null;
	}

	isConnected(): boolean {
		return this.read() !== undefined;
	}

	clear(): void {
		this.db
			.delete(linearLocalAuth)
			.where(eq(linearLocalAuth.id, SINGLETON_ID))
			.run();
	}

	private read() {
		return this.db
			.select()
			.from(linearLocalAuth)
			.where(eq(linearLocalAuth.id, SINGLETON_ID))
			.get();
	}
}
