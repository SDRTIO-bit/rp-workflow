import { Hono } from "hono";
import { readEntries, writeEntries, createEntry, updateEntry } from "../services/jsonStore.js";

export const createWorldbookRoutes = (worldbookFile: string) => {
  const app = new Hono();

  app.get("/api/worldbook", async (c) => {
    const entries = await readEntries(worldbookFile);
    return c.json({ entries });
  });

  app.post("/api/worldbook", async (c) => {
    const body = await c.req.json();
    const entries = await readEntries(worldbookFile);
    const entry = createEntry(body, "world", "未命名设定");
    const nextEntries = [entry, ...entries].slice(0, 300);
    await writeEntries(worldbookFile, nextEntries);
    return c.json({ entries: nextEntries, entry }, 201);
  });

  app.put("/api/worldbook/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const entries = await readEntries(worldbookFile);
    let found = false;
    const nextEntries = entries.map((entry) => {
      if (entry.id !== id) return entry;
      found = true;
      return updateEntry(entry, body);
    });
    if (!found) return c.json({ error: "Entry not found" }, 404);
    await writeEntries(worldbookFile, nextEntries);
    return c.json({ entries: nextEntries });
  });

  app.delete("/api/worldbook/:id", async (c) => {
    const id = c.req.param("id");
    const entries = await readEntries(worldbookFile);
    const nextEntries = entries.filter((entry) => entry.id !== id);
    await writeEntries(worldbookFile, nextEntries);
    return c.json({ entries: nextEntries });
  });

  return app;
};
