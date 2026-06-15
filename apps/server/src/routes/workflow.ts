import { Hono } from "hono";
import { validateWorkflow, type NodeCatalog, type WorkflowRunContext } from "@awp/workflow-core";
import type { LlmRouter, NodeModelConfig } from "@awp/agent-runtime";
import {
  createExecutors,
  runWorkflowStreaming,
  type WorkflowRunnerContext,
} from "../services/workflowRunner.js";
import type { NodePlugin, SkillItem } from "../services/pluginLoader.js";
import type { RpRuntimeRegistration } from "@awp/rp-runtime";
import type { SpecializedAgentProfileRegistry } from "@awp/agent-runtime";
import type { DynamicWorldbookStore } from "@awp/workflow-worldbook";

export type WorkflowRuntime = {
  llmRouter: LlmRouter;
  defaultModelConfig?: NodeModelConfig;
  memoryFile: string;
  worldbookFile: string;
  plugins: NodePlugin[];
  skillCatalog: SkillItem[];
  runtimeNodeCatalog: NodeCatalog;
  rpRuntime: RpRuntimeRegistration | null;
  profileRegistry?: SpecializedAgentProfileRegistry;
  worldbookStore?: DynamicWorldbookStore;
};

export const createWorkflowRoutes = (getRuntime: () => WorkflowRuntime) => {
  const app = new Hono();

  app.post("/api/workflows/validate", async (c) => {
    const body = await c.req.json();
    const runtime = getRuntime();
    const workflow = body.workflow;
    if (!workflow || !Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges)) {
      return c.json({
        issues: [{ level: "error", message: "Invalid workflow: missing nodes or edges" }],
      });
    }
    const issues = validateWorkflow(workflow, runtime.runtimeNodeCatalog);
    return c.json({ issues });
  });

  app.post("/api/run-workflow", async (c) => {
    const body = await c.req.json();
    const runtime = getRuntime();
    const context: WorkflowRunnerContext = {
      llmRouter: runtime.llmRouter,
      defaultModelConfig: runtime.defaultModelConfig,
      memoryFile: runtime.memoryFile,
      worldbookFile: runtime.worldbookFile,
      plugins: runtime.plugins,
      skillCatalog: runtime.skillCatalog,
      pluginCatalog: runtime.runtimeNodeCatalog,
      rpRuntime: runtime.rpRuntime,
      profileRegistry: runtime.profileRegistry,
      worldbookStore: runtime.worldbookStore,
    };
    const executors = await createExecutors(body.workflow, context);
    const { runWorkflow } = await import("@awp/workflow-core");
    // Extract WorkflowRunContext from request body if provided
    const workflowContext: WorkflowRunContext | undefined = body.context;
    const result = await runWorkflow(
      body.workflow,
      executors,
      runtime.runtimeNodeCatalog,
      workflowContext,
    );
    return c.json(result);
  });

  app.post("/api/run-workflow-stream", async (c) => {
    const body = await c.req.json();
    const runtime = getRuntime();
    const context: WorkflowRunnerContext = {
      llmRouter: runtime.llmRouter,
      defaultModelConfig: runtime.defaultModelConfig,
      memoryFile: runtime.memoryFile,
      worldbookFile: runtime.worldbookFile,
      plugins: runtime.plugins,
      skillCatalog: runtime.skillCatalog,
      pluginCatalog: runtime.runtimeNodeCatalog,
      rpRuntime: runtime.rpRuntime,
      profileRegistry: runtime.profileRegistry,
      worldbookStore: runtime.worldbookStore,
    };

    // Extract WorkflowRunContext from request body if provided
    const workflowContext: WorkflowRunContext | undefined = body.context;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const executors = await createExecutors(body.workflow, context, (event) => {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "token", ...event })}\n`));
        });
        await runWorkflowStreaming(
          body.workflow,
          executors,
          runtime.runtimeNodeCatalog,
          (event) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          },
          workflowContext,
        );
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return app;
};
