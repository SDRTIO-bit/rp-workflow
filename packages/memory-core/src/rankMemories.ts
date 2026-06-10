import type { MemoryEntry } from "./types";

const segment = (text: string): Set<string> => {
  const normalized = text.toLowerCase();
  const tokens = new Set<string>();

  for (const match of normalized.matchAll(/[a-z0-9_]+/g)) {
    tokens.add(match[0]);
  }

  for (const char of normalized.replace(/\s/g, "")) {
    if (/[\u4e00-\u9fff]/u.test(char)) {
      tokens.add(char);
    }
  }

  return tokens;
};

const scoreMemory = (queryTokens: Set<string>, memory: MemoryEntry): number => {
  const memoryTokens = segment([memory.title, memory.content, ...memory.tags].join(" "));
  let score = 0;

  for (const token of queryTokens) {
    if (memoryTokens.has(token)) {
      score += token.length > 1 ? 3 : 1;
    }
  }

  return score;
};

export const rankMemories = (
  query: string,
  memories: MemoryEntry[],
  limit: number,
): MemoryEntry[] => {
  const queryTokens = segment(query);

  return memories
    .map((memory) => ({ memory, score: scoreMemory(queryTokens, memory) }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return Date.parse(right.memory.updatedAt) - Date.parse(left.memory.updatedAt);
    })
    .slice(0, limit)
    .map((entry) => entry.memory);
};
