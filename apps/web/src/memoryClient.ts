import type { MemoryDraft, MemoryEntry } from "@awp/memory-core";

type Fetcher = typeof fetch;

export const loadMemoriesViaServer = async (
  fetcher: Fetcher = fetch,
): Promise<MemoryEntry[] | undefined> => {
  try {
    const response = await fetcher("/api/memories");
    if (!response.ok) {
      return undefined;
    }
    return ((await response.json()) as { memories: MemoryEntry[] }).memories;
  } catch {
    return undefined;
  }
};

export const addMemoryViaServer = async (
  memory: MemoryDraft,
  fetcher: Fetcher = fetch,
): Promise<MemoryEntry[] | undefined> => {
  try {
    const response = await fetcher("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(memory),
    });
    if (!response.ok) {
      return undefined;
    }
    return ((await response.json()) as { memories: MemoryEntry[] }).memories;
  } catch {
    return undefined;
  }
};

export const updateMemoryViaServer = async (
  id: string,
  memory: MemoryDraft,
  fetcher: Fetcher = fetch,
): Promise<MemoryEntry[] | undefined> => {
  try {
    const response = await fetcher(`/api/memories/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(memory),
    });
    if (!response.ok) {
      return undefined;
    }
    return ((await response.json()) as { memories: MemoryEntry[] }).memories;
  } catch {
    return undefined;
  }
};

export const deleteMemoryViaServer = async (
  id: string,
  fetcher: Fetcher = fetch,
): Promise<MemoryEntry[] | undefined> => {
  try {
    const response = await fetcher(`/api/memories/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      return undefined;
    }
    return ((await response.json()) as { memories: MemoryEntry[] }).memories;
  } catch {
    return undefined;
  }
};
