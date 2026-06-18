import { createHash } from "node:crypto";

/**
 * Compute a content-addressed cardId from raw file bytes.
 * SHA-256 hex digest — 64 lowercase hex characters.
 * Same bytes → same cardId. Different bytes → different cardId.
 */
export function computeCardId(rawBytes: Uint8Array): string {
  return createHash("sha256").update(rawBytes).digest("hex");
}

/**
 * Compute SHA-256 hex digest of a string.
 */
export function sha256String(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
