import { Hono } from "hono";
import { readEntries, writeEntries, createEntry, updateEntry } from "../services/jsonStore.js";

export const createMemoriesRoutes = (memoryFile: string) => {
  const app = new Hono();

  app.get("/api/memories", async (c) => {
    const memories = await readEntries(memoryFile);
    return c.json({ memories });
  });

  app.post("/api/memories", async (c) => {
    const body = await c.req.json();
    const memories = await readEntries(memoryFile);
    const entry = createEntry(body, "mem", "未命名记忆");
    const nextMemories = [entry, ...memories].slice(0, 300);
    await writeEntries(memoryFile, nextMemories);
    return c.json({ memories: nextMemories, entry }, 201);
  });

  app.put("/api/memories/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const memories = await readEntries(memoryFile);
    let found = false;
    const nextMemories = memories.map((entry) => {
      if (entry.id !== id) return entry;
      found = true;
      return updateEntry(entry, body);
    });
    if (!found) return c.json({ error: "Memory not found" }, 404);
    await writeEntries(memoryFile, nextMemories);
    return c.json({ memories: nextMemories });
  });

  app.delete("/api/memories/:id", async (c) => {
    const id = c.req.param("id");
    const memories = await readEntries(memoryFile);
    const nextMemories = memories.filter((entry) => entry.id !== id);
    await writeEntries(memoryFile, nextMemories);
    return c.json({ memories: nextMemories });
  });

  return app;
};
