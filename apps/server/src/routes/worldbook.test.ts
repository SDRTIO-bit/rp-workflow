import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { createWorldbookRoutes } from "./worldbook.js";

const tmpDir = join(import.meta.dirname, "__tmp_worldbook__");
const worldbookFile = join(tmpDir, "worldbook.json");

beforeEach(async () => {
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const createApp = () => {
  const app = new Hono();
  app.route("/", createWorldbookRoutes(worldbookFile));
  return app;
};

describe("worldbook routes", () => {
  it("GET /api/worldbook returns empty entries", async () => {
    const app = createApp();
    const res = await app.request("/api/worldbook");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ entries: [] });
  });

  it("POST /api/worldbook creates an entry", async () => {
    const app = createApp();
    const res = await app.request("/api/worldbook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Lore", content: "Details", tags: ["setting"] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entry.title).toBe("Lore");
  });

  it("PUT /api/worldbook/:id updates an entry", async () => {
    const app = createApp();
    await app.request("/api/worldbook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Old" }),
    });
    const list = await (await app.request("/api/worldbook")).json();
    const id = list.entries[0].id;

    const res = await app.request(`/api/worldbook/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.find((e: { id: string }) => e.id === id).title).toBe("Updated");
  });

  it("DELETE /api/worldbook/:id deletes an entry", async () => {
    const app = createApp();
    await app.request("/api/worldbook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Gone" }),
    });
    const list = await (await app.request("/api/worldbook")).json();
    const id = list.entries[0].id;

    const res = await app.request(`/api/worldbook/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(0);
  });
});
