import { describe, it, expect } from "vitest";
import { WorldbookRuntimeIndex } from "../../src/worldbook/index.js";
import { createRpWorldbookRetrieverV1Executor } from "../../src/worldbook/rpWorldbookRetrieverV1.js";
import { WUGANG_WORLDBOOK } from "../fixtures/wugangWorldbook.js";
import type { WorldbookRetrievalResult } from "../../src/worldbook/types.js";
import type { NodeExecutionInput, WorkflowNode } from "@awp/workflow-core";

function makeNode(): WorkflowNode {
  return { id: "wb-1", type: "rpWorldbookRetrieverV1", config: {}, position: { x: 0, y: 0 } };
}

function makeContext() {
  return { runId: "test", values: { rp: { sessionId: "s1", worldId: "w1", turnId: "t1" } } };
}

function makeInput(inputs: Record<string, unknown>): NodeExecutionInput {
  return { node: makeNode(), inputs, context: makeContext() };
}

// ============ WorldbookRuntimeIndex Tests ============

describe("WorldbookRuntimeIndex", () => {
  it("builds index from entries", () => {
    const index = new WorldbookRuntimeIndex();
    index.build(WUGANG_WORLDBOOK);
    expect(index.size).toBeGreaterThan(0);
  });

  it("finds entries by primary keywords", () => {
    const index = new WorldbookRuntimeIndex();
    index.build(WUGANG_WORLDBOOK);
    const matches = index.findByKeywords(["苏绫", "钟楼"]);
    expect(matches.size).toBeGreaterThan(0);
    expect(matches.has("char_su_ling")).toBe(true);
    expect(matches.has("location_clocktower")).toBe(true);
  });

  it("finds entries by aliases", () => {
    const index = new WorldbookRuntimeIndex();
    index.build(WUGANG_WORLDBOOK);
    const matches = index.findByKeywords(["阿绫"]);
    expect(matches.has("char_su_ling")).toBe(true);
  });

  it("finds constant entries", () => {
    const index = new WorldbookRuntimeIndex();
    index.build(WUGANG_WORLDBOOK);
    const constants = index.getConstantEntries();
    expect(constants.length).toBeGreaterThan(0);
    expect(constants.every((e) => e.constant)).toBe(true);
  });
});

// ============ WorldbookRetriever Node Tests ============

describe("rpWorldbookRetrieverV1", () => {
  // Complex Chinese input that should trigger multiple categories
  const COMPLEX_INPUT =
    "我没有立刻接过阿绫递来的银铃，而是盯着铃身上那道被火烧过的白塔纹章。三年前钟楼失火时，沈砚也带着同样的东西。" +
    "楼下忽然传来巡夜司的敲门声。我压低声音问她：\u201c教会的人为什么会知道我们在这里？\u201d" +
    "说完，我把失踪名单塞进外套，示意她从地下水道离开，自己则走向门口拖延时间。";

  it("activates multiple categories from complex Chinese input", async () => {
    const executor = createRpWorldbookRetrieverV1Executor();
    const result = await executor(
      makeInput({
        rawInput: COMPLEX_INPUT,
        worldbookEntries: WUGANG_WORLDBOOK,
        recentMessages: [],
      }),
    );

    const rr = result.outputs.retrievalResult as WorldbookRetrievalResult;

    // Should activate multiple categories
    const allEntries = [...rr.directHits, ...rr.expandedEntries];
    const categories = new Set(allEntries.map((e) => e.category));

    expect(categories.has("character")).toBe(true); // 苏绫, 沈砚
    expect(categories.has("item")).toBe(true); // 银铃, 失踪名单
    expect(categories.has("location")).toBe(true); // 钟楼, 地下水道
    expect(categories.has("faction")).toBe(true); // 巡夜司, 白塔教会
    expect(categories.has("event")).toBe(true); // 钟楼火灾
    expect(categories.has("relationship")).toBe(true); // via expansion

    // Specifically verify faction_white_tower activates from 白塔纹章/教会
    const allIds = allEntries.map((e) => e.id);
    expect(allIds).toContain("faction_white_tower");
  });

  it("activates 苏绫 via alias 阿绫", async () => {
    const executor = createRpWorldbookRetrieverV1Executor();
    const result = await executor(
      makeInput({
        rawInput: "阿绫递来银铃",
        worldbookEntries: WUGANG_WORLDBOOK,
        recentMessages: [],
      }),
    );

    const rr = result.outputs.retrievalResult as WorldbookRetrievalResult;
    const allIds = [...rr.directHits, ...rr.expandedEntries].map((e) => e.id);
    expect(allIds).toContain("char_su_ling");
  });

  it("expands relatedEntryIds one hop", async () => {
    const executor = createRpWorldbookRetrieverV1Executor();
    const result = await executor(
      makeInput({
        rawInput: "苏绫递来银铃",
        worldbookEntries: WUGANG_WORLDBOOK,
        recentMessages: [],
      }),
    );

    const rr = result.outputs.retrievalResult as WorldbookRetrievalResult;
    // char_su_ling has relatedEntryIds including rel_player_su_ling
    const expandedIds = rr.expandedEntries.map((e) => e.id);
    expect(expandedIds).toContain("rel_player_su_ling");
  });

  it("partitions by visibility", async () => {
    const executor = createRpWorldbookRetrieverV1Executor();
    const result = await executor(
      makeInput({
        rawInput: COMPLEX_INPUT,
        worldbookEntries: WUGANG_WORLDBOOK,
        recentMessages: [],
      }),
    );

    const rr = result.outputs.retrievalResult as WorldbookRetrievalResult;
    expect(Array.isArray(rr.byVisibility.public)).toBe(true);
    expect(Array.isArray(rr.byVisibility.hidden)).toBe(true);
    expect(Array.isArray(rr.byVisibility.runtime_only)).toBe(true);

    // Constant rules should be in public
    const publicIds = rr.byVisibility.public.map((e) => e.id);
    expect(publicIds).toContain("rule_narrative_style");
  });

  it("respects selective activation", async () => {
    const executor = createRpWorldbookRetrieverV1Executor();
    // Input only has 苏绫 but NOT secondary keys for rel_player_su_ling
    const result = await executor(
      makeInput({
        rawInput: "苏绫走了进来",
        worldbookEntries: WUGANG_WORLDBOOK,
        recentMessages: [],
      }),
    );

    const rr = result.outputs.retrievalResult as WorldbookRetrievalResult;
    const directIds = rr.directHits.map((e) => e.id);
    // char_su_ling should be in direct hits
    expect(directIds).toContain("char_su_ling");
  });

  it("negative test: unrelated input does not activate unrelated entries", async () => {
    const executor = createRpWorldbookRetrieverV1Executor();
    const result = await executor(
      makeInput({
        rawInput: "今天天气很好",
        worldbookEntries: WUGANG_WORLDBOOK,
        recentMessages: [],
      }),
    );

    const rr = result.outputs.retrievalResult as WorldbookRetrievalResult;
    // Should only have constant entries, no character/item/faction entries
    const directIds = rr.directHits.map((e) => e.id);
    expect(directIds).not.toContain("char_su_ling");
    expect(directIds).not.toContain("item_silver_bell");
    expect(directIds).not.toContain("faction_night_watch");
  });

  it("budget limits total entries", async () => {
    const executor = createRpWorldbookRetrieverV1Executor({ config: { limit: 5 } });
    const result = await executor(
      makeInput({
        rawInput: COMPLEX_INPUT,
        worldbookEntries: WUGANG_WORLDBOOK,
        recentMessages: [],
      }),
    );

    const rr = result.outputs.retrievalResult as WorldbookRetrievalResult;
    expect(rr.totalEntries).toBeLessThanOrEqual(5);
  });

  it("deduplicates entries", async () => {
    const executor = createRpWorldbookRetrieverV1Executor();
    const result = await executor(
      makeInput({
        rawInput: "苏绫 银铃",
        worldbookEntries: WUGANG_WORLDBOOK,
        recentMessages: [],
      }),
    );

    const rr = result.outputs.retrievalResult as WorldbookRetrievalResult;
    const allIds = [...rr.directHits, ...rr.expandedEntries].map((e) => e.id);
    const uniqueIds = [...new Set(allIds)];
    expect(allIds.length).toBe(uniqueIds.length);
  });

  it("diagnostic snapshot for complex Chinese input", async () => {
    const executor = createRpWorldbookRetrieverV1Executor();
    const result = await executor(
      makeInput({
        rawInput: COMPLEX_INPUT,
        worldbookEntries: WUGANG_WORLDBOOK,
        recentMessages: [],
      }),
    );

    const rr = result.outputs.retrievalResult as WorldbookRetrievalResult;

    // Direct hit IDs
    const directIds = rr.directHits.map((e) => e.id);
    expect(directIds.length).toBeGreaterThan(0);

    // Expanded entry IDs
    const expandedIds = rr.expandedEntries.map((e) => e.id);

    // faction_white_tower must be activated
    const allIds = [...directIds, ...expandedIds];
    expect(allIds).toContain("faction_white_tower");

    // Format directives should be present
    const formatDirectives = allIds.filter((id) => id.startsWith("format_"));
    expect(formatDirectives.length).toBeGreaterThan(0);

    // totalEntries should be reasonable
    expect(rr.totalEntries).toBeGreaterThan(5);
    expect(rr.totalEntries).toBeLessThanOrEqual(20);
  });
});
