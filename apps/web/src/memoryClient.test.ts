import { describe, expect, it } from "vitest";
import {
  addMemoryViaServer,
  deleteMemoryViaServer,
  loadMemoriesViaServer,
  updateMemoryViaServer,
} from "./memoryClient";

describe("memory client", () => {
  it("loads memories from the local server", async () => {
    const result = await loadMemoriesViaServer(async () => {
      return new Response(JSON.stringify({ memories: [{ id: "m1", title: "设定" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    expect(result).toEqual([{ id: "m1", title: "设定" }]);
  });

  it("posts a new long-term memory", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    await addMemoryViaServer(
      { title: "主角习惯", content: "主角紧张时整理袖口。", tags: ["主角"] },
      async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ memory: { id: "m1" }, memories: [] }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
    );

    expect(calls[0]?.url).toBe("/api/memories");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      title: "主角习惯",
      content: "主角紧张时整理袖口。",
      tags: ["主角"],
    });
  });

  it("updates a long-term memory", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    await updateMemoryViaServer(
      "m1",
      { title: "更新", content: "新的内容", tags: ["新"] },
      async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ memories: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );

    expect(calls[0]?.url).toBe("/api/memories/m1");
    expect(calls[0]?.init.method).toBe("PUT");
  });

  it("deletes a long-term memory", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    await deleteMemoryViaServer("m1", async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ memories: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    expect(calls[0]?.url).toBe("/api/memories/m1");
    expect(calls[0]?.init.method).toBe("DELETE");
  });
});
