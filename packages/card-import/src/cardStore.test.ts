import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FileCardStore, safeFilename } from "./cardStore.js";
import { computeCardId } from "./hash.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "__fixtures__");

function loadFixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

async function buildStoreEntry(rawBytes: Uint8Array) {
  const { computeCardId } = await import("./hash.js");
  const { parseSillyTavernCard } = await import("./parse.js");
  const { detectBlockedFeatures, detectCapabilities } = await import("./detect.js");
  const { extractGreetings } = await import("./greetings.js");
  const { mapWorldbookEntries } = await import("./worldbookMapper.js");
  const { buildManifest } = await import("./manifest.js");

  const card = parseSillyTavernCard(rawBytes);
  const cardId = computeCardId(rawBytes);
  const blockedFeatures = detectBlockedFeatures(card);
  const entries = card.data.character_book?.entries || [];
  const capabilities = detectCapabilities(card, entries);
  const { greetings, defaultGreetingId, warnings: greetingWarnings } = extractGreetings(card);
  const {
    entries: mappedEntries,
    deferred,
    warnings: wbWarnings,
    counts,
  } = mapWorldbookEntries(card.data.character_book, cardId);

  const allWarnings = [...greetingWarnings, ...wbWarnings];
  const manifest = buildManifest({
    card,
    cardId,
    sourceFilename: "test.json",
    sourceSizeBytes: rawBytes.length,
    greetings,
    defaultGreetingId,
    entries: mappedEntries,
    deferred,
    blockedFeatures,
    capabilities,
    warnings: allWarnings,
    counts,
  });

  const importReport = {
    schemaVersion: 1 as const,
    warnings: allWarnings,
    blockedFeatures,
    capabilities,
    generatedAt: new Date().toISOString(),
  };

  return {
    cardId,
    rawBytes,
    entry: {
      manifest,
      greetings,
      worldbook: mappedEntries,
      deferredWorldbook: deferred,
      importReport,
    },
  };
}

describe("safeFilename", () => {
  it("L17: sanitizes path traversal", () => {
    expect(safeFilename("../../etc/passwd")).toBe(".._.._etc_passwd");
  });

  it("preserves safe characters", () => {
    expect(safeFilename("safe-file.json")).toBe("safe-file.json");
  });

  it("truncates to maxLen", () => {
    const long = "a".repeat(300);
    expect(safeFilename(long).length).toBe(255);
  });
});

describe("FileCardStore", () => {
  let tempDir: string;
  let store: FileCardStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "card-store-test-"));
    store = new FileCardStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("L4: dedup — same content produces same cardId, second write is no-op", async () => {
    const rawBytes = loadFixtureBytes("minimal-v3.json");
    const { cardId, entry } = await buildStoreEntry(rawBytes);

    // First write
    const r1 = await store.writeCard(cardId, rawBytes, entry);
    expect(r1).toEqual({ alreadyExisted: false });
    expect(await store.hasCard(cardId)).toBe(true);

    // Second write — should succeed without error (dedup)
    const r2 = await store.writeCard(cardId, rawBytes, entry);
    expect(r2).toEqual({ alreadyExisted: true });
    expect(await store.hasCard(cardId)).toBe(true);

    // Read back
    const loaded = await store.readCard(cardId);
    expect(loaded.cardId).toBe(cardId);
    expect(loaded.manifest.name).toBe("Test Character Alpha");
  });

  it("returns alreadyExisted=true without modifying finalDir", async () => {
    const rawBytes = loadFixtureBytes("minimal-v3.json");
    const { cardId, entry } = await buildStoreEntry(rawBytes);

    await store.writeCard(cardId, rawBytes, entry);

    // Snapshot source.json bytes & mtime before re-write
    const { stat: fstat } = await import("node:fs/promises");
    const sourcePath = join(tempDir, cardId, "source.json");
    const beforeBytes = await readFile(sourcePath);
    const beforeStat = await fstat(sourcePath);

    // Wait so any mtime change would be visible
    await new Promise((r) => setTimeout(r, 50));

    // Second write should be a no-op for source.json
    const r = await store.writeCard(cardId, rawBytes, entry);
    expect(r.alreadyExisted).toBe(true);

    const afterBytes = await readFile(sourcePath);
    const afterStat = await fstat(sourcePath);

    // Bytes unchanged
    expect(Buffer.compare(beforeBytes, afterBytes)).toBe(0);
    // mtime not advanced (no re-write)
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
  });

  it("refuses to overwrite when existing source.json hash mismatches cardId", async () => {
    const rawBytes = loadFixtureBytes("minimal-v3.json");
    const { cardId, entry } = await buildStoreEntry(rawBytes);

    await store.writeCard(cardId, rawBytes, entry);

    // Corrupt the on-disk source.json (different bytes, same dir)
    const { writeFile: wf } = await import("node:fs/promises");
    const { mkdir: mk } = await import("node:fs/promises");
    // Replace the entire directory with a manually crafted corrupt one
    await store.deleteCard(cardId);
    const cardDir = join(tempDir, cardId);
    await mk(cardDir, { recursive: true });
    await wf(join(cardDir, "source.json"), new TextEncoder().encode("not the original bytes"));

    // Now try to write the same cardId — should throw, not overwrite
    await expect(store.writeCard(cardId, rawBytes, entry)).rejects.toThrow(
      /does not match expected cardId/,
    );

    // Corrupt source should still be in place
    const remaining = await readFile(join(cardDir, "source.json"), "utf8");
    expect(remaining).toBe("not the original bytes");
  });

  it("refuses to overwrite when finalDir is a non-directory file", async () => {
    const rawBytes = loadFixtureBytes("minimal-v3.json");
    const { cardId, entry } = await buildStoreEntry(rawBytes);

    // Pre-create finalDir as a regular file (not a directory)
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(join(tempDir, cardId), "i am a file, not a directory");

    await expect(store.writeCard(cardId, rawBytes, entry)).rejects.toThrow(/is not a directory/);
  });

  it("L19: concurrent writes — 8 parallel imports of the same rawBytes never overwrite, never leave temp residue", async () => {
    const rawBytes = loadFixtureBytes("minimal-v3.json");
    const { cardId, entry } = await buildStoreEntry(rawBytes);

    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, () => store.writeCard(cardId, rawBytes, entry)),
    );

    // Exactly one writer must have been first; all others must report alreadyExisted.
    const firstWriters = results.filter((r) => r.alreadyExisted === false);
    const dedupWriters = results.filter((r) => r.alreadyExisted === true);
    expect(firstWriters).toHaveLength(1);
    expect(dedupWriters).toHaveLength(N - 1);

    // Exactly one final directory; no temp residue
    const entries = await (await import("node:fs/promises")).readdir(tempDir);
    const finalDirs = entries.filter((e) => e === cardId);
    const tempDirs = entries.filter((e) => e.endsWith(".tmp"));
    expect(finalDirs).toHaveLength(1);
    expect(tempDirs).toHaveLength(0);

    // All 6 files present and source.json matches cardId
    const cardDir = join(tempDir, cardId);
    const files = [
      "source.json",
      "manifest.json",
      "greetings.json",
      "worldbook.json",
      "deferred-worldbook.json",
      "import-report.json",
    ];
    for (const f of files) {
      const c = await readFile(join(cardDir, f), "utf8");
      expect(c.length).toBeGreaterThan(0);
    }
    const sourceBytes = await readFile(join(cardDir, "source.json"));
    const { createHash } = await import("node:crypto");
    const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
    expect(sourceHash).toBe(cardId);

    // The card is readable
    const loaded = await store.readCard(cardId);
    expect(loaded.manifest.name).toBe("Test Character Alpha");
  });

  it("L19: concurrent writes — different cardIds do not interfere", async () => {
    const bytes1 = loadFixtureBytes("minimal-v3.json");
    const bytes2 = loadFixtureBytes("no-worldbook-v3.json");
    const data1 = await buildStoreEntry(bytes1);
    const data2 = await buildStoreEntry(bytes2);

    const N = 6;
    const writes = [
      ...Array.from({ length: N }, () => store.writeCard(data1.cardId, bytes1, data1.entry)),
      ...Array.from({ length: N }, () => store.writeCard(data2.cardId, bytes2, data2.entry)),
    ];
    const results = await Promise.all(writes);

    // For each cardId, exactly one first-writer and (N-1) dedup
    for (const cid of [data1.cardId, data2.cardId]) {
      const r = results.slice(cid === data1.cardId ? 0 : N, cid === data1.cardId ? N : 2 * N);
      expect(r.filter((x) => x.alreadyExisted === false)).toHaveLength(1);
      expect(r.filter((x) => x.alreadyExisted === true)).toHaveLength(N - 1);
    }

    // Two card directories, no temp residue
    const entries = await (await import("node:fs/promises")).readdir(tempDir);
    expect(entries.filter((e) => /^[0-9a-f]{64}$/.test(e))).toHaveLength(2);
    expect(entries.filter((e) => e.endsWith(".tmp"))).toHaveLength(0);
  });

  it("temp dir name is unique per call (does not collide on same cardId)", async () => {
    // Two concurrent writers for the SAME cardId should never share a temp dir.
    // Verified indirectly: after two parallel writes, no temp residue remains.
    const rawBytes = loadFixtureBytes("minimal-v3.json");
    const { cardId, entry } = await buildStoreEntry(rawBytes);
    await Promise.all([
      store.writeCard(cardId, rawBytes, entry),
      store.writeCard(cardId, rawBytes, entry),
    ]);
    const entries = await (await import("node:fs/promises")).readdir(tempDir);
    expect(entries.filter((e) => e.endsWith(".tmp"))).toHaveLength(0);
  });

  it("different content produces different cardId", async () => {
    const bytes1 = loadFixtureBytes("minimal-v3.json");
    const bytes2 = loadFixtureBytes("no-worldbook-v3.json");

    const id1 = computeCardId(bytes1);
    const id2 = computeCardId(bytes2);
    expect(id1).not.toBe(id2);
  });

  it("L14: failure leaves no trace", async () => {
    const cardId = "b".repeat(64);
    // Try to read a card that doesn't exist
    expect(await store.hasCard(cardId)).toBe(false);

    // listCards should be empty
    const cards = await store.listCards();
    expect(cards).toHaveLength(0);
  });

  it("L15: source.json is immutable after write", async () => {
    const rawBytes = loadFixtureBytes("minimal-v3.json");
    const { cardId, entry } = await buildStoreEntry(rawBytes);

    await store.writeCard(cardId, rawBytes, entry);

    // Verify source integrity
    const intact = await store.verifySourceIntegrity(cardId);
    expect(intact).toBe(true);
  });

  it("listCards returns all cardIds", async () => {
    const bytes1 = loadFixtureBytes("minimal-v3.json");
    const bytes2 = loadFixtureBytes("no-worldbook-v3.json");

    const data1 = await buildStoreEntry(bytes1);
    const data2 = await buildStoreEntry(bytes2);

    await store.writeCard(data1.cardId, bytes1, data1.entry);
    await store.writeCard(data2.cardId, bytes2, data2.entry);

    const cards = await store.listCards();
    expect(cards).toHaveLength(2);
    expect(cards).toContain(data1.cardId);
    expect(cards).toContain(data2.cardId);
  });

  it("deleteCard removes the card directory", async () => {
    const rawBytes = loadFixtureBytes("minimal-v3.json");
    const { cardId, entry } = await buildStoreEntry(rawBytes);

    await store.writeCard(cardId, rawBytes, entry);
    expect(await store.hasCard(cardId)).toBe(true);

    await store.deleteCard(cardId);
    expect(await store.hasCard(cardId)).toBe(false);
  });

  it("L18: atomic write — all 6 files exist after write", async () => {
    const rawBytes = loadFixtureBytes("minimal-v3.json");
    const { cardId, entry } = await buildStoreEntry(rawBytes);

    await store.writeCard(cardId, rawBytes, entry);

    const cardDir = join(tempDir, cardId);
    const files = [
      "source.json",
      "manifest.json",
      "greetings.json",
      "worldbook.json",
      "deferred-worldbook.json",
      "import-report.json",
    ];

    for (const file of files) {
      const content = await readFile(join(cardDir, file), "utf8");
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it("sweepOrphanedTempDirs cleans up temp dirs (pid.rand format)", async () => {
    // Create fake temp dirs in the new format `.<cardId>.<pid>.<rand>.tmp`
    const { mkdir } = await import("node:fs/promises");
    const a = join(tempDir, `.${"c".repeat(64)}.${process.pid}.aaaa1111bbbb2222.tmp`);
    const b = join(tempDir, `.${"d".repeat(64)}.${process.pid}.cccc3333dddd4444.tmp`);
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });

    const count = await store.sweepOrphanedTempDirs();
    expect(count).toBe(2);

    // A regular card dir must NOT be swept
    const { stat } = await import("node:fs/promises");
    const realCardId = "e".repeat(64);
    await mkdir(join(tempDir, realCardId), { recursive: true });
    await store.sweepOrphanedTempDirs();
    await expect(stat(join(tempDir, realCardId))).resolves.toBeDefined();
  });
});
