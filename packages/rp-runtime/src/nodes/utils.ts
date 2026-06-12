import type { WorkflowRunContext } from "@awp/workflow-core";
import type { RpExecutionScope } from "../types.js";

/**
 * Extracts RpExecutionScope from WorkflowRunContext.
 * All RP node executors call this to obtain sessionId/worldId/turnId.
 */
export function extractScope(context: WorkflowRunContext | undefined): RpExecutionScope {
  const rp = context?.values?.rp;
  if (rp === undefined || rp === null) {
    throw new Error("Missing rp scope in WorkflowRunContext.values");
  }
  if (typeof rp !== "object" || Array.isArray(rp)) {
    throw new Error("Invalid rp scope: must be an object");
  }
  const { sessionId, worldId, turnId } = rp as Record<string, unknown>;
  if (typeof sessionId !== "string" || typeof worldId !== "string" || typeof turnId !== "string") {
    throw new Error("Invalid rp scope: sessionId, worldId, turnId must be strings");
  }
  return { sessionId, worldId, turnId };
}
