import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readEntries, writeEntries, createEntry, updateEntry } from "./jsonStore.js";

const tmpDir = join(import.meta.dirname, "__tmp_jsonstore__");

beforeEach(async () => {
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("jsonStore", () => {
  describe("readEntries", () => {
    it("returns empty array when file does not exist", async () => {
      const result = await readEntries(join(tmpDir, "nope.json"));
      expect(result).toEqual([]);
    });

    it("reads existing entries", async () => {
      const filePath = join(tmpDir, "test.json");
      await writeFile(
        filePath,
        JSON.stringify([
          { id: "1", title: "Test", content: "Content", tags: [], updatedAt: "2020-01-01" },
        ]),
      );
      const result = await readEntries(filePath);
      expect(result).toEqual([
        { id: "1", title: "Test", content: "Content", tags: [], updatedAt: "2020-01-01" },
      ]);
    });
  });

  describe("writeEntries", () => {
    it("writes entries to file creating directory if needed", async () => {
      const filePath = join(tmpDir, "sub", "test.json");
      await writeEntries(filePath, [
        { id: "1", title: "Test", content: "Content", tags: [], updatedAt: "2020-01-01" },
      ]);
      const content = await readFile(filePath, "utf8");
      expect(JSON.parse(content)).toEqual([
        { id: "1", title: "Test", content: "Content", tags: [], updatedAt: "2020-01-01" },
      ]);
    });
  });

  describe("createEntry", () => {
    it("creates entry with id, timestamp, and body fields", () => {
      const entry = createEntry(
        { title: "Test", content: "Hello", tags: ["a"] },
        "mem",
        "Untitled",
      );
      expect(entry.id).toMatch(/^mem_\d+$/);
      expect(entry.title).toBe("Test");
      expect(entry.content).toBe("Hello");
      expect(entry.tags).toEqual(["a"]);
      expect(entry.updatedAt).toBeTruthy();
    });

    it("uses fallback title when missing", () => {
      const entry = createEntry({ content: "Hello" }, "mem", "Fallback");
      expect(entry.title).toBe("Fallback");
    });
  });

  describe("updateEntry", () => {
    it("merges body into existing entry and updates timestamp", () => {
      const original = {
        id: "1",
        title: "Old",
        content: "Old content",
        tags: ["old"],
        updatedAt: "2020-01-01",
      };
      const updated = updateEntry(original, { title: "New" });
      expect(updated.id).toBe("1");
      expect(updated.title).toBe("New");
      expect(updated.content).toBe("Old content");
      expect(updated.tags).toEqual(["old"]);
      expect(updated.updatedAt).not.toBe("2020-01-01");
    });
  });
});
