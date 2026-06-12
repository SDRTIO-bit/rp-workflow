import { describe, it, expect } from "vitest";
import { extractScope } from "../../src/nodes/utils.js";
import type { WorkflowRunContext } from "@awp/workflow-core";

describe("extractScope", () => {
  it("extracts scope from valid context", () => {
    const context: WorkflowRunContext = {
      runId: "run-1",
      values: {
        rp: {
          sessionId: "session-1",
          worldId: "world-1",
          turnId: "turn-1",
        },
      },
    };

    const scope = extractScope(context);

    expect(scope).toEqual({
      sessionId: "session-1",
      worldId: "world-1",
      turnId: "turn-1",
    });
  });

  it("throws when context is undefined", () => {
    expect(() => extractScope(undefined)).toThrow("Missing rp scope in WorkflowRunContext.values");
  });

  it("throws when values is undefined", () => {
    const context: WorkflowRunContext = { runId: "run-1" };
    expect(() => extractScope(context)).toThrow("Missing rp scope in WorkflowRunContext.values");
  });

  it("throws when rp is missing", () => {
    const context: WorkflowRunContext = {
      values: { other: "data" },
    };
    expect(() => extractScope(context)).toThrow("Missing rp scope in WorkflowRunContext.values");
  });

  it("throws when rp is not an object", () => {
    const context: WorkflowRunContext = {
      values: { rp: "not-an-object" },
    };
    expect(() => extractScope(context)).toThrow("Invalid rp scope: must be an object");
  });

  it("throws when sessionId is missing", () => {
    const context: WorkflowRunContext = {
      values: {
        rp: { worldId: "world-1", turnId: "turn-1" },
      },
    };
    expect(() => extractScope(context)).toThrow(
      "Invalid rp scope: sessionId, worldId, turnId must be strings",
    );
  });

  it("throws when worldId is not a string", () => {
    const context: WorkflowRunContext = {
      values: {
        rp: { sessionId: "session-1", worldId: 123, turnId: "turn-1" },
      },
    };
    expect(() => extractScope(context)).toThrow(
      "Invalid rp scope: sessionId, worldId, turnId must be strings",
    );
  });

  it("throws when turnId is missing", () => {
    const context: WorkflowRunContext = {
      values: {
        rp: { sessionId: "session-1", worldId: "world-1" },
      },
    };
    expect(() => extractScope(context)).toThrow(
      "Invalid rp scope: sessionId, worldId, turnId must be strings",
    );
  });
});
