import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { createMemoriesRoutes } from "./memories";

const tmpDir = join(import.meta.dirname, "__tmp_memories__");
const memoryFile = join(tmpDir, "memories.json");

beforeEach(async () => {
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const createApp = () => {
  const app = new Hono();
  app.route("/", createMemoriesRoutes(memoryFile));
  return app;
};

describe("memories routes", () => {
  it("GET /api/memories returns empty list", async () => {
    const app = createApp();
    const res = await app.request("/api/memories");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ memories: [] });
  });

  it("POST /api/memories creates a memory", async () => {
    const app = createApp();
    const res = await app.request("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", content: "Hello", tags: ["a"] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.memories).toHaveLength(1);
    expect(body.memories[0].title).toBe("Test");
    expect(body.entry.title).toBe("Test");
  });

  it("PUT /api/memories/:id updates a memory", async () => {
    const app = createApp();
    await app.request("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Old" }),
    });
    const list = await (await app.request("/api/memories")).json();
    const id = list.memories[0].id;

    const res = await app.request(`/api/memories/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memories.find((m: { id: string }) => m.id === id).title).toBe("New");
  });

  it("DELETE /api/memories/:id deletes a memory", async () => {
    const app = createApp();
    await app.request("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "ToDelete" }),
    });
    const list = await (await app.request("/api/memories")).json();
    const id = list.memories[0].id;

    const res = await app.request(`/api/memories/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memories).toHaveLength(0);
  });

  it("PUT /api/memories/:id returns 404 for missing id", async () => {
    const app = createApp();
    const res = await app.request("/api/memories/nonexistent", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "X" }),
    });
    expect(res.status).toBe(404);
  });
});
