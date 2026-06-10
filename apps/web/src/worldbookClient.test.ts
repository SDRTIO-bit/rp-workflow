import { describe, expect, it } from "vitest";
import {
  addWorldbookEntryViaServer,
  deleteWorldbookEntryViaServer,
  loadWorldbookEntriesViaServer,
  updateWorldbookEntryViaServer,
} from "./worldbookClient";

describe("worldbook client", () => {
  it("loads worldbook entries from the local server", async () => {
    const result = await loadWorldbookEntriesViaServer(async () => {
      return new Response(JSON.stringify({ entries: [{ id: "w1", title: "雨夜车站" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    expect(result).toEqual([{ id: "w1", title: "雨夜车站" }]);
  });

  it("posts a new worldbook entry", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    await addWorldbookEntryViaServer(
      { title: "车站广播", content: "旧广播只在雨夜重复。", tags: ["设定"] },
      async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ entry: { id: "w1" }, entries: [] }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
    );

    expect(calls[0]?.url).toBe("/api/worldbook");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      title: "车站广播",
      content: "旧广播只在雨夜重复。",
      tags: ["设定"],
    });
  });

  it("updates a worldbook entry", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    await updateWorldbookEntryViaServer(
      "w1",
      { title: "修订设定", content: "新的设定内容", tags: ["世界观"] },
      async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ entries: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );

    expect(calls[0]?.url).toBe("/api/worldbook/w1");
    expect(calls[0]?.init.method).toBe("PUT");
  });

  it("deletes a worldbook entry", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    await deleteWorldbookEntryViaServer("w1", async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    expect(calls[0]?.url).toBe("/api/worldbook/w1");
    expect(calls[0]?.init.method).toBe("DELETE");
  });
});
