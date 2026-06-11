import { Hono } from "hono";
import { validateWorkflow, type WorkflowDefinition, type NodeCatalog } from "@awp/workflow-core";
import { createExecutors, runWorkflowStreaming, type WorkflowRunnerContext } from "../services/workflowRunner.js";
import type { NodePlugin, SkillItem } from "../services/pluginLoader.js";

export type WorkflowRuntime = {
  apiKey: string;
  model: string;
  memoryFile: string;
  worldbookFile: string;
  plugins: NodePlugin[];
  skillCatalog: SkillItem[];
  runtimeNodeCatalog: NodeCatalog;
};

export const createWorkflowRoutes = (getRuntime: () => WorkflowRuntime) => {
  const app = new Hono();

  app.post("/api/workflows/validate", async (c) => {
    const body = await c.req.json();
    const runtime = getRuntime();
    const issues = validateWorkflow(body.workflow, runtime.runtimeNodeCatalog);
    return c.json({ issues });
  });

  app.post("/api/run-workflow", async (c) => {
    const body = await c.req.json();
    const runtime = getRuntime();
    const context: WorkflowRunnerContext = {
      apiKey: runtime.apiKey,
      model: runtime.model,
      memoryFile: runtime.memoryFile,
      worldbookFile: runtime.worldbookFile,
      plugins: runtime.plugins,
      skillCatalog: runtime.skillCatalog,
      pluginCatalog: runtime.runtimeNodeCatalog,
    };
    const executors = await createExecutors(body.workflow, context);
    const { runWorkflow } = await import("@awp/workflow-core");
    const result = await runWorkflow(body.workflow, executors, runtime.runtimeNodeCatalog);
    return c.json(result);
  });

  app.post("/api/run-workflow-stream", async (c) => {
    const body = await c.req.json();
    const runtime = getRuntime();
    const context: WorkflowRunnerContext = {
      apiKey: runtime.apiKey,
      model: runtime.model,
      memoryFile: runtime.memoryFile,
      worldbookFile: runtime.worldbookFile,
      plugins: runtime.plugins,
      skillCatalog: runtime.skillCatalog,
      pluginCatalog: runtime.runtimeNodeCatalog,
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const executors = await createExecutors(body.workflow, context, (event) => {
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ type: "token", ...event })}\n`),
          );
        });
        await runWorkflowStreaming(body.workflow, executors, runtime.runtimeNodeCatalog, (event) => {
          controller.enqueue(
            encoder.encode(`${JSON.stringify(event)}\n`),
          );
        });
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  });

  return app;
};
