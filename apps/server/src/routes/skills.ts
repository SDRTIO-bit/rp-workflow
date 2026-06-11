import { Hono } from "hono";
import type { SkillItem } from "../services/pluginLoader.js";

export type SkillsRuntime = {
  skillCatalog: SkillItem[];
};

export const createSkillsRoutes = (getRuntime: () => SkillsRuntime) => {
  const app = new Hono();

  app.get("/api/skills", async (c) => {
    const runtime = getRuntime();
    const categories = [...new Set(runtime.skillCatalog.map((s) => s.category).filter(Boolean))];
    return c.json({
      skills: runtime.skillCatalog,
      categories,
    });
  });

  return app;
};
