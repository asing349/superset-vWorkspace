import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from "node:crypto";
import { getMachineId } from "@superset/shared/host-info";

// Wave-7 M1 — encryption for the host-local Linear tokens, at rest.
//
// AES-256-GCM with a key derived (scrypt) from a per-machine secret. The key
// material is `SECRETS_ENCRYPTION_KEY` when provisioned, otherwise the raw
// machine id (so local connect works with zero extra config, including in
// from-source dev). Each ciphertext is self-describing:
//   base64( salt(16) || iv(12) || authTag(16) || ciphertext )
// Tokens are NEVER stored or logged in plaintext.

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const MIN_ENCRYPTED_BYTES = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1;

function getKeyMaterial(): string {
	return process.env.SECRETS_ENCRYPTION_KEY ?? getMachineId();
}

function deriveKey(salt: Buffer): Buffer {
	return scryptSync(getKeyMaterial(), salt, KEY_LENGTH);
}

export function encryptToken(plaintext: string): string {
	const salt = randomBytes(SALT_LENGTH);
	const key = deriveKey(salt);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv, {
		authTagLength: AUTH_TAG_LENGTH,
	});
	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();
	return Buffer.concat([salt, iv, authTag, encrypted]).toString("base64");
}

export function decryptToken(encoded: string): string {
	const buf = Buffer.from(encoded, "base64");
	if (buf.length < MIN_ENCRYPTED_BYTES) {
		throw new Error("Encrypted Linear token is malformed (too short)");
	}
	const salt = buf.subarray(0, SALT_LENGTH);
	const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
	const authTag = buf.subarray(
		SALT_LENGTH + IV_LENGTH,
		SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
	);
	const ciphertext = buf.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
	const key = deriveKey(salt);
	const decipher = createDecipheriv(ALGORITHM, key, iv, {
		authTagLength: AUTH_TAG_LENGTH,
	});
	decipher.setAuthTag(authTag);
	return Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]).toString("utf8");
}
