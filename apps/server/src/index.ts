import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { resolveEnv } from "./env.js";
import { createMemoriesRoutes } from "./routes/memories.js";

const app = new Hono();

app.get("/api/health", (c) =>
  c.json({ status: "ok", timestamp: new Date().toISOString() }),
);

const env = resolveEnv();

app.route("/", createMemoriesRoutes(resolve(env.dataDir, "memories.json")));

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`@awp/server running at http://127.0.0.1:${info.port}`);
  console.log(
    env.deepseekApiKey
      ? "DeepSeek Agent: enabled"
      : "DeepSeek Agent: missing DEEPSEEK_API_KEY",
  );
});

export { app };
