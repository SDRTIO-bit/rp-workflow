import { Hono } from "hono";
import type { LlmRouter, NodeModelConfig } from "@awp/agent-runtime";

export type LlmConfig = {
  llmRouter: LlmRouter;
  defaultModelConfig?: NodeModelConfig;
};

export const createLlmRoutes = (getConfig: () => LlmConfig) => {
  const app = new Hono();

  app.get("/api/llm/status", async (c) => {
    const config = getConfig();
    try {
      const resolved = config.llmRouter.resolveConfig(config.defaultModelConfig, undefined);
      return c.json({
        configured: true,
        providerId: resolved.providerId,
        model: resolved.model,
      });
    } catch {
      return c.json({ configured: false, error: "No provider configured" });
    }
  });

  app.post("/api/llm/chat", async (c) => {
    const config = getConfig();
    const body = await c.req.json();
    const { messages, model, providerId } = body;

    if (!Array.isArray(messages)) {
      return c.json({ error: "messages 必须是数组" }, 400);
    }

    try {
      const resolved = config.llmRouter.resolveConfig(
        { model, provider: providerId },
        config.defaultModelConfig,
      );
      const prompt = messages
        .map((msg: { role: string; content: string }) => `${msg.role}: ${msg.content}`)
        .join("\n");

      const result = await config.llmRouter.complete(resolved, prompt);

      return c.json({
        text: result.text,
        metadata: {
          providerId: resolved.providerId,
          model: resolved.model,
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
