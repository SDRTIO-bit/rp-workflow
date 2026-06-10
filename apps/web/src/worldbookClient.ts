import type { MemoryDraft, MemoryEntry } from "@awp/memory-core";

type Fetcher = typeof fetch;

export const loadWorldbookEntriesViaServer = async (
  fetcher: Fetcher = fetch,
): Promise<MemoryEntry[] | undefined> => {
  try {
    const response = await fetcher("/api/worldbook");
    if (!response.ok) {
      return undefined;
    }
    return ((await response.json()) as { entries: MemoryEntry[] }).entries;
  } catch {
    return undefined;
  }
};

export const addWorldbookEntryViaServer = async (
  entry: MemoryDraft,
  fetcher: Fetcher = fetch,
): Promise<MemoryEntry[] | undefined> => {
  try {
    const response = await fetcher("/api/worldbook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!response.ok) {
      return undefined;
    }
    return ((await response.json()) as { entries: MemoryEntry[] }).entries;
  } catch {
    return undefined;
  }
};

export const updateWorldbookEntryViaServer = async (
  id: string,
  entry: MemoryDraft,
  fetcher: Fetcher = fetch,
): Promise<MemoryEntry[] | undefined> => {
  try {
    const response = await fetcher(`/api/worldbook/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!response.ok) {
      return undefined;
    }
    return ((await response.json()) as { entries: MemoryEntry[] }).entries;
  } catch {
    return undefined;
  }
};

export const deleteWorldbookEntryViaServer = async (
  id: string,
  fetcher: Fetcher = fetch,
): Promise<MemoryEntry[] | undefined> => {
  try {
    const response = await fetcher(`/api/worldbook/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      return undefined;
    }
    return ((await response.json()) as { entries: MemoryEntry[] }).entries;
  } catch {
    return undefined;
  }
};
