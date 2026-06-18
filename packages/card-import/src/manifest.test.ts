import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { FileCardStore } from "./cardStore.js";
import { computeCardId } from "./hash.js";
import { parseSillyTavernCard } from "./parse.js";
import { detectBlockedFeatures, detectCapabilities } from "./detect.js";
import { extractGreetings } from "./greetings.js";
import { mapWorldbookEntries } from "./worldbookMapper.js";
import { buildManifest } from "./manifest.js";
import type { ImportReportV1 } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "__fixtures__");

function loadFixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

async function buildStoreEntry(rawBytes: Uint8Array, sourceFilename: string) {
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
    sourceFilename,
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
  const importReport: ImportReportV1 = {
    schemaVersion: 1,
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

describe("Manifest persistence invariants (P-15.3A-1)", () => {
  let tempDir: string;
  let store: FileCardStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "card-import-manifest-"));
    store = new FileCardStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("L4: manifest contains no absolute paths (no Windows drive, no leading slash)", async () => {
    const rawBytes = loadFixtureBytes("minimal-v3.json");
    const { cardId, entry } = await buildStoreEntry(rawBytes, "alpha.json");
    await store.writeCard(cardId, rawBytes, entry);

    const manifestRaw = await readFile(join(tempDir, cardId, "manifest.json"), "utf8");
    // No Windows drive letter
    expect(manifestRaw).not.toMatch(/[A-Z]:\\/i);
    // No POSIX absolute path inside the manifest
    expect(manifestRaw).not.toMatch(/"[^"]*\/[^/"]+"/);
    // The worldbookResourceRef must be a cardId-scoped reference, not a path
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.worldbookResourceRef).toBe(`card:${cardId}`);
    expect(manifest.worldbookResourceRef).not.toContain(tempDir);
  });

  it("L4: sourceFilename is metadata only — does not influence cardId", async () => {
    const rawBytes = loadFixtureBytes("minimal-v3.json");
    const id1 = computeCardId(rawBytes);

    // Different sourceFilename, same bytes → same cardId
    const a = await buildStoreEntry(rawBytes, "alpha-v1.json");
    const b = await buildStoreEntry(rawBytes, "completely-different-name.json");
    expect(a.cardId).toBe(b.cardId);
    expect(a.cardId).toBe(id1);
    // Manifest records the actual filename that was used
    expect(a.entry.manifest.sourceFilename).toBe("alpha-v1.json");
    expect(b.entry.manifest.sourceFilename).toBe("completely-different-name.json");
  });

  it("L4: same content + different filename still produces one cardId and dedupes", async () => {
    const rawBytes = loadFixtureBytes("minimal-v3.json");
    const a = await buildStoreEntry(rawBytes, "name-a.json");
    const b = await buildStoreEntry(rawBytes, "name-b.json");

    expect(a.cardId).toBe(b.cardId);
    const r1 = await store.writeCard(a.cardId, rawBytes, a.entry);
    const r2 = await store.writeCard(b.cardId, rawBytes, b.entry);
    expect(r1.alreadyExisted).toBe(false);
    expect(r2.alreadyExisted).toBe(true);

    // Only one final dir
    const entries = await (await import("node:fs/promises")).readdir(tempDir);
    expect(entries.filter((e) => /^[0-9a-f]{64}$/.test(e))).toHaveLength(1);
  });

  it("L4: different content + same filename produces different cardIds", async () => {
    const rawBytes1 = loadFixtureBytes("minimal-v3.json");
    const rawBytes2 = loadFixtureBytes("no-worldbook-v3.json");
    const a = await buildStoreEntry(rawBytes1, "same-name.json");
    const b = await buildStoreEntry(rawBytes2, "same-name.json");

    expect(a.cardId).not.toBe(b.cardId);

    await store.writeCard(a.cardId, rawBytes1, a.entry);
    await store.writeCard(b.cardId, rawBytes2, b.entry);

    // Two final dirs
    const entries = await (await import("node:fs/promises")).readdir(tempDir);
    expect(entries.filter((e) => /^[0-9a-f]{64}$/.test(e))).toHaveLength(2);
  });

  it("L4: source.json on disk is byte-identical to the bytes the user submitted", async () => {
    const rawBytes = loadFixtureBytes("minimal-v3.json");
    const { cardId, entry } = await buildStoreEntry(rawBytes, "x.json");
    await store.writeCard(cardId, rawBytes, entry);

    const onDisk = await readFile(join(tempDir, cardId, "source.json"));
    expect(Buffer.compare(onDisk, Buffer.from(rawBytes))).toBe(0);
  });

  it("L4: source.json is NOT re-written on dedup (mtime preserved)", async () => {
    const rawBytes = loadFixtureBytes("minimal-v3.json");
    const { cardId, entry } = await buildStoreEntry(rawBytes, "x.json");
    await store.writeCard(cardId, rawBytes, entry);

    const { stat } = await import("node:fs/promises");
    const sourcePath = join(tempDir, cardId, "source.json");
    const beforeStat = await stat(sourcePath);
    const beforeBytes = await readFile(sourcePath);

    // Wait so mtime change would be visible
    await new Promise((r) => setTimeout(r, 50));

    // Build a "different" entry with the same cardId, try to overwrite
    const entry2 = {
      ...entry,
      manifest: { ...entry.manifest, name: "MODIFIED NAME" },
    };
    const r = await store.writeCard(cardId, rawBytes, entry2);
    expect(r.alreadyExisted).toBe(true);

    const afterStat = await stat(sourcePath);
    const afterBytes = await readFile(sourcePath);

    // Bytes and mtime both unchanged
    expect(Buffer.compare(beforeBytes, afterBytes)).toBe(0);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);

    // Manifest on disk still has the original name (not "MODIFIED NAME")
    const manifestRaw = await readFile(join(tempDir, cardId, "manifest.json"), "utf8");
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.name).toBe("Test Character Alpha");
  });

  it("L4: cardId is exactly sha256(raw bytes), recorded in manifest.sourceHash", async () => {
    const rawBytes = loadFixtureBytes("minimal-v3.json");
    const expectedId = createHash("sha256").update(rawBytes).digest("hex");
    const { cardId, entry } = await buildStoreEntry(rawBytes, "y.json");
    expect(cardId).toBe(expectedId);
    expect(entry.manifest.sourceHash).toBe(expectedId);
    expect(entry.manifest.cardId).toBe(expectedId);
  });

  it("L4: all 6 files present after a single write", async () => {
    const rawBytes = loadFixtureBytes("minimal-v3.json");
    const { cardId, entry } = await buildStoreEntry(rawBytes, "z.json");
    await store.writeCard(cardId, rawBytes, entry);

    for (const f of [
      "source.json",
      "manifest.json",
      "greetings.json",
      "worldbook.json",
      "deferred-worldbook.json",
      "import-report.json",
    ]) {
      const c = await readFile(join(tempDir, cardId, f), "utf8");
      expect(c.length).toBeGreaterThan(0);
      // All must be valid JSON except source.json (raw bytes)
      if (f !== "source.json") {
        expect(() => JSON.parse(c)).not.toThrow();
      }
    }
  });
});
