import type { LlmAdapter } from "./types";

import { normalizeOpenAiCompatibleUsage } from "./llmUsage";

type OpenCodeAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

type OpenCodeResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
  };
};

type OpenCodeStreamChunk = {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: OpenCodeResponse["usage"];
};

const requestBody = (input: {
  model: string;
  prompt: string;
  temperature?: number;
  stream: boolean;
}) =>
  JSON.stringify({
    model: input.model,
    messages: [{ role: "user", content: input.prompt }],
    stream: input.stream,
    temperature: input.temperature,
    ...(input.stream ? { stream_options: { include_usage: true } } : {}),
  });

export const createOpenCodeAdapter = (options: OpenCodeAdapterOptions): LlmAdapter => {
  const request = options.fetch ?? globalThis.fetch;
  const endpoint = options.baseUrl ?? "https://opencode.ai/zen/go/v1/chat/completions";

  if (!request) {
    throw new Error("OpenCode adapter requires a fetch implementation.");
  }

  return {
    provider: "opencode",
    async complete(input) {
      const response = await request(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: requestBody({ ...input, stream: false }),
      });

      if (!response.ok) {
        let errorBody = "";
        try {
          errorBody = await response.text();
        } catch {
          /* ignore */
        }
        throw new Error(
          `OpenCode request failed: ${response.status} ${response.statusText}${errorBody ? " - " + errorBody.slice(0, 200) : ""}`,
        );
      }

      const data = (await response.json()) as OpenCodeResponse;
      const text = data.choices?.[0]?.message?.content;

      if (!text) {
        throw new Error("OpenCode response did not include message content.");
      }

      return {
        text,
        tokenUsage: normalizeOpenAiCompatibleUsage(data.usage),
      };
    },
    async stream(input) {
      const response = await request(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: requestBody({ ...input, stream: true }),
      });

      if (!response.ok) {
        let errorBody = "";
        try {
          errorBody = await response.text();
        } catch {
          /* ignore */
        }
        throw new Error(
          `OpenCode request failed: ${response.status} ${response.statusText}${errorBody ? " - " + errorBody.slice(0, 200) : ""}`,
        );
      }

      if (!response.body) {
        return this.complete(input);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let usage: OpenCodeResponse["usage"];

      const consumeLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          return;
        }

        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") {
          return;
        }

        const chunk = JSON.parse(payload) as OpenCodeStreamChunk;
        usage = chunk.usage ?? usage;

        for (const choice of chunk.choices ?? []) {
          const token = choice.delta?.content;
          if (!token) {
            continue;
          }

          text += token;
          input.onToken?.(token);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          consumeLine(line);
        }

        if (done) {
          break;
        }
      }

      if (buffer.trim()) {
        consumeLine(buffer);
      }

      if (!text) {
        throw new Error("OpenCode response did not include streamed message content.");
      }

      return {
        text,
        tokenUsage: normalizeOpenAiCompatibleUsage(usage),
      };
    },
  };
};
