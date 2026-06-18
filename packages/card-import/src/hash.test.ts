import { describe, expect, it } from "vitest";
import { computeCardId, sha256String } from "./hash.js";

describe("computeCardId", () => {
  it("returns 64 lowercase hex characters", () => {
    const bytes = new TextEncoder().encode("hello world");
    const id = computeCardId(bytes);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input produces same output", () => {
    const bytes = new TextEncoder().encode('{"spec":"chara_card_v3"}');
    const id1 = computeCardId(bytes);
    const id2 = computeCardId(bytes);
    expect(id1).toBe(id2);
  });

  it("different input produces different output", () => {
    const bytes1 = new TextEncoder().encode("content A");
    const bytes2 = new TextEncoder().encode("content B");
    expect(computeCardId(bytes1)).not.toBe(computeCardId(bytes2));
  });

  it("empty bytes produce a valid hash", () => {
    const id = computeCardId(new Uint8Array(0));
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("sha256String", () => {
  it("produces 64 hex chars", () => {
    const hash = sha256String("test content");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(sha256String("abc")).toBe(sha256String("abc"));
  });

  it("different strings produce different hashes", () => {
    expect(sha256String("abc")).not.toBe(sha256String("def"));
  });
});
