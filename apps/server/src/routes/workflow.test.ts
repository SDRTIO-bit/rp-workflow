import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createWorkflowRoutes } from "../routes/workflow.js";
import type { WorkflowRuntime } from "../routes/workflow.js";
import { ProviderRegistry, LlmRouter } from "@awp/agent-runtime";

function createMockRouter(): LlmRouter {
  const registry = new ProviderRegistry("mock");
  registry.register({
    providerId: "mock",
    apiKey: "",
    baseUrl: "",
    defaultModel: "mock-model",
    createAdapter: () => ({
      provider: "mock",
      complete: async () => ({ text: "mock", tokenUsage: { input: 0, output: 0 } }),
    }),
  });
  return new LlmRouter(registry);
}

function createTestApp(runtime: WorkflowRuntime) {
  const app = new Hono();
  app.route(
    "/",
    createWorkflowRoutes(() => runtime),
  );
  return app;
}

const baseRuntime: WorkflowRuntime = {
  llmRouter: createMockRouter(),
  memoryFile: "/tmp/mem.json",
  worldbookFile: "/tmp/wb.json",
  plugins: [],
  skillCatalog: [],
  runtimeNodeCatalog: {
    userInput: {
      type: "userInput",
      label: "User Input",
      ports: [{ id: "text", label: "Text", dataType: "text", direction: "output" }],
    },
  },
  rpRuntime: null,
};

describe("POST /api/workflows/validate input validation", () => {
  it("returns error when body.workflow is missing", async () => {
    const app = createTestApp(baseRuntime);
    const res = await app.request("/api/workflows/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.issues).toHaveLength(1);
    expect(data.issues[0].level).toBe("error");
    expect(data.issues[0].message).toContain("Invalid workflow");
  });

  it("returns error when body.workflow is null", async () => {
    const app = createTestApp(baseRuntime);
    const res = await app.request("/api/workflows/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow: null }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.issues).toHaveLength(1);
    expect(data.issues[0].level).toBe("error");
  });

  it("returns error when workflow has no nodes array", async () => {
    const app = createTestApp(baseRuntime);
    const res = await app.request("/api/workflows/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow: { id: "x", version: 1, name: "X" } }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.issues).toHaveLength(1);
    expect(data.issues[0].message).toContain("Invalid workflow");
  });

  it("returns error when workflow has no edges array", async () => {
    const app = createTestApp(baseRuntime);
    const res = await app.request("/api/workflows/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: { id: "x", version: 1, name: "X", nodes: [], edges: undefined },
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.issues).toHaveLength(1);
    expect(data.issues[0].message).toContain("Invalid workflow");
  });

  it("passes valid workflow through to validateWorkflow", async () => {
    const app = createTestApp(baseRuntime);
    const res = await app.request("/api/workflows/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: { id: "valid", version: 1, name: "Valid", nodes: [], edges: [] },
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    // Empty workflow validates (no cycles, no bad nodes)
    expect(data.issues.some((i: { level: string }) => i.level === "error")).toBe(false);
  });
});
