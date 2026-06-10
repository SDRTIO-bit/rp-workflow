import { describe, expect, it } from "vitest";
import { rankMemories } from "./rankMemories";
import type { MemoryEntry } from "./types";

const memories: MemoryEntry[] = [
  {
    id: "m1",
    title: "废弃车站",
    content: "废弃车站的旧广播会在雨夜播放失真的乘车通知。",
    tags: ["车站", "广播", "雨夜"],
    updatedAt: "2026-06-10T00:00:00.000Z",
  },
  {
    id: "m2",
    title: "主角设定",
    content: "主角讨厌强光，习惯在紧张时整理袖口。",
    tags: ["主角", "习惯"],
    updatedAt: "2026-06-10T00:00:01.000Z",
  },
  {
    id: "m3",
    title: "无关设定",
    content: "王都集市在每月第一天开放。",
    tags: ["王都"],
    updatedAt: "2026-06-10T00:00:02.000Z",
  },
];

describe("rankMemories", () => {
  it("returns memories related to the current query first", () => {
    const ranked = rankMemories("主角在雨夜车站里听见旧广播响起", memories, 2);

    expect(ranked.map((memory) => memory.id)).toEqual(["m1", "m2"]);
  });

  it("limits the number of returned memories", () => {
    expect(rankMemories("主角在王都车站", memories, 1)).toHaveLength(1);
  });

  it("keeps newer memories first when relevance is tied", () => {
    const ranked = rankMemories("设定", memories, 3);

    expect(ranked.map((memory) => memory.id)).toEqual(["m3", "m2", "m1"]);
  });
});
