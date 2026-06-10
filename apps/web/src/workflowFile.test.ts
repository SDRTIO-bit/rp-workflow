import { describe, expect, it } from "vitest";
import {
  exportWorkflowToJson,
  importWorkflowFromJson,
  maxWorkflowImportBytes,
} from "./workflowFile";
import { parallelWorkflow } from "./state/sampleWorkflows";

describe("workflow file import/export", () => {
  it("exports a workflow with an Agent Workflow Platform envelope", () => {
    const json = exportWorkflowToJson(parallelWorkflow, new Date("2026-06-10T00:00:00.000Z"));

    expect(JSON.parse(json)).toEqual({
      kind: "agent-workflow-platform.workflow",
      version: 1,
      exportedAt: "2026-06-10T00:00:00.000Z",
      workflow: parallelWorkflow,
    });
  });

  it("imports wrapped and raw workflow JSON", () => {
    const wrapped = exportWorkflowToJson(parallelWorkflow, new Date("2026-06-10T00:00:00.000Z"));

    expect(importWorkflowFromJson(wrapped)).toEqual({ ok: true, workflow: parallelWorkflow });
    expect(importWorkflowFromJson(JSON.stringify(parallelWorkflow))).toEqual({
      ok: true,
      workflow: parallelWorkflow,
    });
  });

  it("rejects unsafe or invalid workflow files", () => {
    expect(importWorkflowFromJson("not json").ok).toBe(false);
    expect(importWorkflowFromJson("x".repeat(maxWorkflowImportBytes + 1)).ok).toBe(false);
    expect(importWorkflowFromJson(JSON.stringify({ workflow: { id: "bad" } })).ok).toBe(false);

    const invalidEdgeWorkflow = {
      ...parallelWorkflow,
      edges: [
        {
          id: "bad-edge",
          source: "missing",
          sourcePort: "text",
          target: "output",
          targetPort: "text",
        },
      ],
    };
    expect(importWorkflowFromJson(JSON.stringify(invalidEdgeWorkflow)).ok).toBe(false);
  });
});
