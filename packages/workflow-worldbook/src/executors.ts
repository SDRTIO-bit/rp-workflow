/**
 * Dynamic Worldbook Executor — P-3
 *
 * Factory that creates a NodeExecutor for the dynamicWorldbook node.
 * Wires together: store, scope resolution, schema validation, and operations.
 */
import type { NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type {
  DynamicWorldbookStore,
  DynamicWorldbookCommandV1,
  DynamicWorldbookPayloadV1,
  DynamicWorldbookNodeConfig,
} from "./types.js";
import { executeOperation, buildScopeKey } from "./operations.js";
import { normalizeEntries } from "./normalize.js";

// ============ Executor Services ============

export interface DynamicWorldbookExecutorServices {
  /** The worldbook store instance. */
  store: DynamicWorldbookStore;
  /** Default scope resolution context (runId, sessionId from workflow run). */
  scopeContext: {
    runId?: string;
    sessionId?: string;
  };
}

// ============ Executor Factory ============

export function createDynamicWorldbookExecutor(
  services: DynamicWorldbookExecutorServices,
): NodeExecutor {
  return async (input: NodeExecutionInput) => {
    const node = input.node;
    const config = node.config as unknown as DynamicWorldbookNodeConfig;
    const inputs = input.inputs as Record<string, unknown>;

    // Validate config
    if (!config.resourceRef || typeof config.resourceRef !== "string") {
      throw new Error("dynamicWorldbook: resourceRef is required in node config");
    }

    // Parse command (required)
    const command = inputs.command as DynamicWorldbookCommandV1 | undefined;
    if (!command || typeof command !== "object") {
      throw new Error("dynamicWorldbook: command input is required and must be a JSON object");
    }

    // Parse payload (optional)
    const payload: DynamicWorldbookPayloadV1 = (inputs.payload as DynamicWorldbookPayloadV1) ?? {};

    // Normalize entries in payload if present
    if (payload.entries && Array.isArray(payload.entries)) {
      const normalized = normalizeEntries(payload.entries);
      if (!normalized.ok) {
        throw new Error(
          `dynamicWorldbook: payload entry normalization failed: ${normalized.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
        );
      }
      // Replace with normalized entries
      payload.entries = normalized.entry as unknown as typeof payload.entries;
    }

    // Build scope key
    const scopeContext = {
      ...services.scopeContext,
      resourceRef: config.resourceRef,
    };

    const scopeKey = buildScopeKey(config.lifecycle, scopeContext);

    // Execute operation
    const operationResult = await executeOperation({
      store: services.store,
      scopeKey,
      resourceRef: config.resourceRef,
      command,
      payload,
      config,
      now: new Date().toISOString(),
    });

    return {
      outputs: {
        result: operationResult.result,
        status: operationResult.status,
      },
      metadata: {
        scopeKey,
        resourceRef: config.resourceRef,
        lifecycle: config.lifecycle,
        operation: command.operation,
        versionBefore: operationResult.status.versionBefore,
        versionAfter: operationResult.status.versionAfter,
        deduplicated: operationResult.status.deduplicated,
      },
    };
  };
}
