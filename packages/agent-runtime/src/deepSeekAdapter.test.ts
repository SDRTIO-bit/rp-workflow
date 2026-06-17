import { describe, expect, it } from "vitest";
import { createDeepSeekAdapter } from "./deepSeekAdapter.js";

describe("deepSeek adapter", () => {
  it("calls the DeepSeek chat completion endpoint with OpenAI-compatible messages", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const adapter = createDeepSeekAdapter({
      apiKey: "test-key",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "真实 Agent 回复" } }],
            usage: {
              prompt_tokens: 120,
              completion_tokens: 30,
              prompt_cache_hit_tokens: 80,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const result = await adapter.complete({
      model: "deepseek-v4-flash",
      prompt: "稳定上下文\n\n=== Dynamic Run Context ===\n\n当前输入",
      temperature: 0.3,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.deepseek.com/chat/completions");
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: "deepseek-v4-flash",
      messages: [
        { role: "user", content: "稳定上下文\n\n=== Dynamic Run Context ===\n\n当前输入" },
      ],
      stream: false,
      temperature: 0.3,
    });
    expect(result).toEqual({
      text: "真实 Agent 回复",
      tokenUsage: {
        availability: "available",
        source: "provider",
        input: 120,
        output: 30,
        cachedInput: 80,
        total: 150,
      },
    });
  });

  it("turns DeepSeek HTTP errors into readable adapter errors", async () => {
    const adapter = createDeepSeekAdapter({
      apiKey: "test-key",
      fetch: async () => new Response("bad auth", { status: 401 }),
    });

    await expect(adapter.complete({ model: "deepseek-v4-flash", prompt: "hello" })).rejects.toThrow(
      "DeepSeek request failed: 401 bad auth",
    );
  });

  it("retries one transient transport failure before succeeding", async () => {
    let calls = 0;
    const adapter = createDeepSeekAdapter({
      apiKey: "test-key",
      fetch: async () => {
        calls++;
        if (calls === 1) {
          throw new TypeError("fetch failed");
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "retry success" } }],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 3,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const result = await adapter.complete({ model: "deepseek-v4-flash", prompt: "hello" });

    expect(calls).toBe(2);
    expect(result.text).toBe("retry success");
  });

  it("streams DeepSeek delta chunks and returns the assembled text", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const adapter = createDeepSeekAdapter({
      apiKey: "test-key",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        const body = [
          'data: {"choices":[{"delta":{"content":"你"}}]}',
          'data: {"choices":[{"delta":{"content":"好"}}]}',
          'data: {"usage":{"prompt_tokens":3,"completion_tokens":2,"prompt_cache_hit_tokens":1},"choices":[]}',
          "data: [DONE]",
          "",
        ].join("\n\n");
        return new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    const tokens: string[] = [];
    const result = await adapter.stream?.({
      model: "deepseek-v4-flash",
      prompt: "hello",
      onToken: (token) => tokens.push(token),
    });

    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      model: "deepseek-v4-flash",
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(tokens).toEqual(["你", "好"]);
    expect(result).toEqual({
      text: "你好",
      tokenUsage: {
        availability: "available",
        source: "provider",
        input: 3,
        output: 2,
        cachedInput: 1,
        total: 5,
      },
    });
  });
});
