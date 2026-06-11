import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type Entry = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  updatedAt: string;
};

export type EntryDraft = {
  title?: string;
  content?: string;
  tags?: string[];
};

export const readEntries = async (filePath: string): Promise<Entry[]> => {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
};

export const writeEntries = async (filePath: string, entries: Entry[]): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
};

export const createEntry = (body: EntryDraft, prefix: string, fallbackTitle: string): Entry => ({
  id: `${prefix}_${Date.now()}`,
  title: String(body.title ?? fallbackTitle),
  content: String(body.content ?? ""),
  tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
  updatedAt: new Date().toISOString(),
});

export const updateEntry = (entry: Entry, body: EntryDraft): Entry => ({
  ...entry,
  title: String(body.title ?? entry.title),
  content: String(body.content ?? entry.content),
  tags: Array.isArray(body.tags) ? body.tags.map(String) : entry.tags,
  updatedAt: new Date().toISOString(),
});
