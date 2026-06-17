import type { LlmAdapter } from "./types.js";
import { normalizeOpenAiCompatibleUsage } from "./llmUsage.js";

type DeepSeekAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
  };
};

type DeepSeekStreamChunk = {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: DeepSeekResponse["usage"];
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

async function requestWithTransportRetry(
  request: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await request(url, init);
    } catch (error) {
      lastError = error;
      if (!isRetryableTransportError(error) || attempt === 3) {
        throw error;
      }
      await sleep(250 * attempt);
    }
  }
  throw lastError;
}

function isRetryableTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error instanceof TypeError || /fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(error.message)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const createDeepSeekAdapter = (options: DeepSeekAdapterOptions): LlmAdapter => {
  const request = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "https://api.deepseek.com";

  if (!request) {
    throw new Error("DeepSeek adapter requires a fetch implementation.");
  }

  return {
    provider: "deepseek",
    async complete(input) {
      const response = await requestWithTransportRetry(request, `${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: requestBody({ ...input, stream: false }),
      });

      if (!response.ok) {
        throw new Error(`DeepSeek request failed: ${response.status} ${await response.text()}`);
      }

      const data = (await response.json()) as DeepSeekResponse;
      const text = data.choices?.[0]?.message?.content;

      if (!text) {
        throw new Error("DeepSeek response did not include message content.");
      }

      return {
        text,
        tokenUsage: normalizeOpenAiCompatibleUsage(data.usage),
      };
    },
    async stream(input) {
      const response = await requestWithTransportRetry(request, `${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: requestBody({ ...input, stream: true }),
      });

      if (!response.ok) {
        throw new Error(`DeepSeek request failed: ${response.status} ${await response.text()}`);
      }

      if (!response.body) {
        return this.complete(input);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let usage: DeepSeekResponse["usage"];

      const consumeLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          return;
        }

        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") {
          return;
        }

        const chunk = JSON.parse(payload) as DeepSeekStreamChunk;
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
        throw new Error("DeepSeek response did not include streamed message content.");
      }

      return {
        text,
        tokenUsage: normalizeOpenAiCompatibleUsage(usage),
      };
    },
  };
};
