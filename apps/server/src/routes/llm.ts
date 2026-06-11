import { Hono } from "hono";
import { createDeepSeekAdapter } from "@awp/agent-runtime";

export type LlmConfig = {
  apiKey: string | undefined;
  model: string;
};

export const createLlmRoutes = (getConfig: () => LlmConfig) => {
  const app = new Hono();

  app.get("/api/llm/status", async (c) => {
    const config = getConfig();
    return c.json({
      configured: Boolean(config.apiKey),
      model: config.model,
    });
  });

  app.post("/api/llm/chat", async (c) => {
    const config = getConfig();
    if (!config.apiKey) {
      return c.json({ error: "DEEPSEEK_API_KEY 未配置" }, 400);
    }

    const body = await c.req.json();
    const { messages, model } = body;

    if (!Array.isArray(messages)) {
      return c.json({ error: "messages 必须是数组" }, 400);
    }

    const adapter = createDeepSeekAdapter({ apiKey: config.apiKey });
    const selectedModel = model ?? config.model;

    try {
      // 将消息数组转换为单个prompt
      const prompt = messages
        .map((msg: { role: string; content: string }) => `${msg.role}: ${msg.content}`)
        .join("\n");

      const result = await adapter.complete({
        model: selectedModel,
        prompt,
      });

      return c.json({
        text: result.text,
        metadata: {
          model: selectedModel,
          tokenUsage: result.tokenUsage,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  return app;
};
