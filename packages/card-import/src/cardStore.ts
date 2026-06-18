import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type {
  CardManifestV1,
  CardStoreEntry,
  DeferredWorldbookEntryV1,
  ImportedGreetingV1,
  ImportedWorldbookEntryV1,
  ImportReportV1,
} from "./types.js";

// ---------------------------------------------------------------------------
// Filename safety
// ---------------------------------------------------------------------------

/**
 * Sanitize a filename: strip non-[a-zA-Z0-9._-] to '_', slice to maxLen.
 * Used for sourceFilename metadata only, NOT for path construction.
 */
export function safeFilename(name: string, maxLen = 255): string {
  const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized.slice(0, maxLen);
}

// ---------------------------------------------------------------------------
// File paths (fixed names per card)
// ---------------------------------------------------------------------------

function cardDirPath(cardsDir: string, cardId: string): string {
  return resolve(cardsDir, cardId);
}

/**
 * Unique per-call temp dir name.
 * Format: `.<cardId>.<pid>.<random>.tmp`
 * - cardId groups orphans for the same content
 * - pid + random disambiguates concurrent writers
 */
function uniqueTempDirPath(cardsDir: string, cardId: string): string {
  const rnd = randomBytes(8).toString("hex");
  return resolve(cardsDir, `.${cardId}.${process.pid}.${rnd}.tmp`);
}

const STALE_TEMP_PATTERN = /^\.[0-9a-f]{64}\.\d+\.[0-9a-f]+\.tmp$/;

const FILE_SOURCE = "source.json";
const FILE_MANIFEST = "manifest.json";
const FILE_GREETINGS = "greetings.json";
const FILE_WORLDBOOK = "worldbook.json";
const FILE_DEFERRED = "deferred-worldbook.json";
const FILE_REPORT = "import-report.json";

// ---------------------------------------------------------------------------
// FileCardStore
// ---------------------------------------------------------------------------

export class FileCardStore {
  constructor(private readonly cardsDir: string) {}

  /**
   * Check if a card with the given cardId already exists.
   */
  async hasCard(cardId: string): Promise<boolean> {
    try {
      const manifestPath = join(cardDirPath(this.cardsDir, cardId), FILE_MANIFEST);
      await stat(manifestPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read a card's full data from disk.
   */
  async readCard(cardId: string): Promise<CardStoreEntry> {
    const dir = cardDirPath(this.cardsDir, cardId);

    const [manifestRaw, greetingsRaw, worldbookRaw, deferredRaw, reportRaw] = await Promise.all([
      readFile(join(dir, FILE_MANIFEST), "utf8"),
      readFile(join(dir, FILE_GREETINGS), "utf8"),
      readFile(join(dir, FILE_WORLDBOOK), "utf8"),
      readFile(join(dir, FILE_DEFERRED), "utf8"),
      readFile(join(dir, FILE_REPORT), "utf8"),
    ]);

    const manifest: CardManifestV1 = JSON.parse(manifestRaw);
    const greetings: ImportedGreetingV1[] = JSON.parse(greetingsRaw);
    const worldbook: ImportedWorldbookEntryV1[] = JSON.parse(worldbookRaw);
    const deferredWorldbook: DeferredWorldbookEntryV1[] = JSON.parse(deferredRaw);
    const importReport: ImportReportV1 = JSON.parse(reportRaw);

    return {
      cardId,
      manifest,
      greetings,
      worldbook,
      deferredWorldbook,
      importReport,
    };
  }

  /**
   * Write a card atomically: unique temp dir → files → rename.
   * Concurrency contract (per P-15.3A-1 spec):
   *   1. Each call gets its own unique temp dir (`.<cardId>.<pid>.<rand>.tmp`)
   *      so concurrent writers never share or wipe each other's temp.
   *   2. The final directory is NEVER deleted by this method.
   *   3. If `finalDir` already exists, verify its source.json hash matches
   *      `cardId`; if so, drop our temp dir and report `alreadyExisted: true`.
   *      If hash mismatches or the directory is corrupt, throw — never overwrite.
   *   4. If the rename loses a race (another writer renamed first), verify
   *      the winner's source.json hash and report `alreadyExisted: true`.
   *
   * Returns whether the card already existed at write time.
   */
  async writeCard(
    cardId: string,
    rawBytes: Uint8Array,
    entry: {
      manifest: CardManifestV1;
      greetings: ImportedGreetingV1[];
      worldbook: ImportedWorldbookEntryV1[];
      deferredWorldbook: DeferredWorldbookEntryV1[];
      importReport: ImportReportV1;
    },
  ): Promise<{ alreadyExisted: boolean }> {
    const finalDir = cardDirPath(this.cardsDir, cardId);

    // Early-exit if finalDir already exists and is valid (no temp work).
    if (await this.isFinalDirValid(finalDir, cardId)) {
      return { alreadyExisted: true };
    }

    // Ensure cardsDir exists
    await mkdir(this.cardsDir, { recursive: true });

    // Unique temp dir for this call — NEVER shared.
    const tmpDir = uniqueTempDirPath(this.cardsDir, cardId);
    await mkdir(tmpDir, { recursive: true });

    try {
      // Write all 6 files to OUR temp dir
      await Promise.all([
        writeFile(join(tmpDir, FILE_SOURCE), rawBytes),
        writeFile(join(tmpDir, FILE_MANIFEST), JSON.stringify(entry.manifest, null, 2)),
        writeFile(join(tmpDir, FILE_GREETINGS), JSON.stringify(entry.greetings, null, 2)),
        writeFile(join(tmpDir, FILE_WORLDBOOK), JSON.stringify(entry.worldbook, null, 2)),
        writeFile(join(tmpDir, FILE_DEFERRED), JSON.stringify(entry.deferredWorldbook, null, 2)),
        writeFile(join(tmpDir, FILE_REPORT), JSON.stringify(entry.importReport, null, 2)),
      ]);

      // Atomic rename. On Windows, rename to an existing destination fails
      // with EEXIST/EPERM, which we use to detect a lost race.
      try {
        await rename(tmpDir, finalDir);
      } catch (renameErr) {
        // Lost the race: another writer completed first.
        // Drop our temp dir; verify the winner is consistent.
        await rm(tmpDir, { recursive: true, force: true });
        if (!(await this.isFinalDirValid(finalDir, cardId))) {
          throw renameErr;
        }
        return { alreadyExisted: true };
      }
    } catch (err) {
      // Clean up our temp dir on failure; never touch finalDir.
      await rm(tmpDir, { recursive: true, force: true });
      throw err;
    }

    return { alreadyExisted: false };
  }

  /**
   * Verify finalDir exists and its source.json hash matches cardId.
   * Returns true if a valid existing card is present.
   * Throws on a corrupt or hash-mismatching existing directory.
   */
  private async isFinalDirValid(finalDir: string, cardId: string): Promise<boolean> {
    let st;
    try {
      st = await stat(finalDir);
    } catch {
      return false;
    }
    if (!st.isDirectory()) {
      throw new Error(
        `Card path ${finalDir} exists but is not a directory (refusing to overwrite)`,
      );
    }
    const sourcePath = join(finalDir, FILE_SOURCE);
    let existingBytes: Buffer;
    try {
      existingBytes = await readFile(sourcePath);
    } catch {
      throw new Error(
        `Existing card directory ${finalDir} is missing or unreadable source.json (refusing to overwrite)`,
      );
    }
    const existingHash = createHash("sha256").update(existingBytes).digest("hex");
    if (existingHash !== cardId) {
      throw new Error(
        `Existing card directory ${finalDir} has source.json hash ${existingHash} which does not match expected cardId ${cardId} (refusing to overwrite)`,
      );
    }
    return true;
  }

  /**
   * List all cardIds in the store.
   */
  async listCards(): Promise<string[]> {
    try {
      const entries = await readdir(this.cardsDir);
      return entries.filter((e) => /^[0-9a-f]{64}$/.test(e));
    } catch {
      return [];
    }
  }

  /**
   * Delete a card directory entirely.
   */
  async deleteCard(cardId: string): Promise<void> {
    const dir = cardDirPath(this.cardsDir, cardId);
    await rm(dir, { recursive: true, force: true });
  }

  /**
   * Verify source.json integrity: sha256(source.json) === cardId.
   */
  async verifySourceIntegrity(cardId: string): Promise<boolean> {
    try {
      const sourcePath = join(cardDirPath(this.cardsDir, cardId), FILE_SOURCE);
      const rawBytes = await readFile(sourcePath);
      const hash = createHash("sha256").update(rawBytes).digest("hex");
      return hash === cardId;
    } catch {
      return false;
    }
  }

  /**
   * Sweep orphaned temp directories (best-effort, call at startup).
   */
  async sweepOrphanedTempDirs(): Promise<number> {
    let count = 0;
    try {
      const entries = await readdir(this.cardsDir);
      for (const entry of entries) {
        if (STALE_TEMP_PATTERN.test(entry)) {
          await rm(join(this.cardsDir, entry), { recursive: true, force: true });
          count++;
        }
      }
    } catch {
      // cardsDir may not exist yet
    }
    return count;
  }

  /**
   * Get the cardsDir path (for diagnostics).
   */
  getCardsDir(): string {
    return this.cardsDir;
  }
}

// Re-export join/resolve for external use in path derivation
export { basename, join, resolve };
