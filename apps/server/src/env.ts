import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");

export type Env = {
  port: number;
  dataDir: string;
  pluginsDir: string;
  deepseekApiKey: string | undefined;
  deepseekModel: string;
  nodeEnv: string;
};

export const resolveEnv = (): Env => ({
  port: Number(process.env.PORT ?? 5180),
  dataDir: process.env.DATA_DIR ?? resolve(__dirname, "..", "..", "..", "data"),
  pluginsDir: process.env.PLUGINS_DIR ?? resolve(__dirname, "..", "..", "..", "plugins"),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  nodeEnv: process.env.NODE_ENV ?? "development",
});
