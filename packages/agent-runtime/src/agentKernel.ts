/**
 * Agent Kernel — P-1 Shared Executor
 *
 * Shared execution kernel for genericAgent and specializedAgent nodes.
 * Handles: model config resolution, input collection, JSON rendering,
 * prompt assembly, LLM invocation, and output formatting.
 *
 * Output is ALWAYS Text in P-1.
 */

import type { NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import {
  safeRecordLlmInvocation,
  type LlmInvocationRoleV1,
  type LlmInvocationTelemetryV1,
} from "@awp/workflow-core";
import type { LlmAdapter } from "./types.js";
import type { NodeModelConfig, ResolvedModelRequest } from "./modelConfig.js";
import type { ProviderRegistry } from "./providerRegistry.js";
import { resolveModelConfig } from "./providerRegistry.js";
import { coerceLlmTokenUsage, unavailableTokenUsage } from "./llmUsage.js";
import type {
  SpecializedAgentProfile,
  SpecializedAgentProfileRegistry,
} from "./profileRegistry.js";
import { renderJsonToMarkdown } from "./renderer.js";

// ============ Services ============

export interface AgentKernelServices {
  /** Provider registry for model resolution. */
  registry: ProviderRegistry;
  /** Profile registry for specialized agent profile lookup. */
  profileRegistry?: SpecializedAgentProfileRegistry;
  /** LLM adapter factory — creates adapter for a given provider. */
  createAdapter: (providerId: string) => LlmAdapter;
  /** Workflow-level default model config (lowest priority). */
  workflowModelConfig?: NodeModelConfig;
}

// ============ Model Config Resolution ============

/**
 * Resolve effective model config with priority:
 * 1. Node config (highest)
 * 2. Specialized profile defaults (only for specializedAgent)
 * 3. Server agent defaults (lowest — from ProviderRegistry)
 */
function resolveEffectiveModelConfig(
  nodeConfig: Record<string, unknown>,
  profile: SpecializedAgentProfile | undefined,
  services: AgentKernelServices,
): ResolvedModelRequest {
  // Build node-level config from flat node.config fields
  const nodeModelConfig: Partial<NodeModelConfig> = {};

  // Only use providerId/modelId if explicitly set in node config
  const nodeProvider = nodeConfig.providerId;
  const nodeModel = nodeConfig.modelId;

  if (typeof nodeProvider === "string" && nodeProvider.length > 0) {
    nodeModelConfig.provider = nodeProvider;
  }
  if (typeof nodeModel === "string" && nodeModel.length > 0) {
    nodeModelConfig.model = nodeModel;
  }

  // Numeric configs only if explicitly set and valid
  if (typeof nodeConfig.temperature === "number") {
    nodeModelConfig.temperature = nodeConfig.temperature;
  }
  if (typeof nodeConfig.topP === "number") {
    nodeModelConfig.topP = nodeConfig.topP;
  }
  if (typeof nodeConfig.maxTokens === "number" && nodeConfig.maxTokens > 0) {
    nodeModelConfig.maxTokens = nodeConfig.maxTokens;
  }
  if (typeof nodeConfig.timeoutMs === "number" && nodeConfig.timeoutMs > 0) {
    nodeModelConfig.timeoutMs = nodeConfig.timeoutMs;
  }
  if (
    typeof nodeConfig.responseFormat === "string" &&
    (nodeConfig.responseFormat === "text" || nodeConfig.responseFormat === "json_object")
  ) {
    nodeModelConfig.responseFormat = nodeConfig.responseFormat;
  }

  // Build profile defaults as workflow-level config (middle priority)
  const profileDefaults: Partial<NodeModelConfig> | undefined = profile
    ? {
        temperature: profile.defaultModelConfig.temperature,
        topP: profile.defaultModelConfig.topP,
        maxTokens: profile.defaultModelConfig.maxTokens,
        timeoutMs: profile.defaultModelConfig.timeoutMs,
        responseFormat: profile.defaultModelConfig.responseFormat,
      }
    : undefined;

  // Enforce lockedFields: strip node overrides for profile-locked fields
  if (profile) {
    for (const field of profile.lockedFields) {
      const configKey = field as keyof Partial<NodeModelConfig>;
      if (configKey in nodeModelConfig) {
        delete nodeModelConfig[configKey];
      }
    }
  }

  // Merge: node → profile → workflow → server
  // We use a custom merge because resolveModelConfig only handles 2 levels
  const finalNodeConfig: Partial<NodeModelConfig> = {
    ...services.workflowModelConfig,
    ...profileDefaults,
    ...nodeModelConfig,
  };

  return resolveModelConfig(finalNodeConfig, services.workflowModelConfig, services.registry);
}

// ============ Prompt Assembly ============

interface PromptAssemblyInput {
  systemPrompt: string;
  userInput?: string;
  instruction?: string;
  context?: string;
  data?: unknown;
  dataRendered: boolean;
  inputOrder: Record<string, number>;
}

function assemblePrompt(input: PromptAssemblyInput): {
  fullPrompt: string;
  sections: string[];
} {
  const sections: Array<{ order: number; title: string; content: string }> = [];

  // System prompt always first
  if (input.systemPrompt) {
    sections.push({ order: -1, title: "System", content: input.systemPrompt });
  }

  // Ordered input sections
  if (input.context !== undefined && input.context !== null) {
    const content = typeof input.context === "string" ? input.context : String(input.context);
    if (content.length > 0) {
      sections.push({
        order: input.inputOrder.context ?? 3,
        title: "Context",
        content,
      });
    }
  }

  if (input.instruction !== undefined && input.instruction !== null) {
    const content =
      typeof input.instruction === "string" ? input.instruction : String(input.instruction);
    if (content.length > 0) {
      sections.push({
        order: input.inputOrder.instruction ?? 2,
        title: "Instruction",
        content,
      });
    }
  }

  if (input.userInput !== undefined && input.userInput !== null) {
    const content = typeof input.userInput === "string" ? input.userInput : String(input.userInput);
    if (content.length > 0) {
      sections.push({
        order: input.inputOrder.userInput ?? 1,
        title: "User Input",
        content,
      });
    }
  }

  if (input.data !== undefined && input.data !== null) {
    const content = input.dataRendered
      ? renderJsonToMarkdown(input.data)
      : typeof input.data === "string"
        ? input.data
        : JSON.stringify(input.data, null, 2);
    if (content.length > 0) {
      sections.push({
        order: input.inputOrder.data ?? 4,
        title: "Data",
        content,
      });
    }
  }

  // Sort by order
  sections.sort((a, b) => a.order - b.order);

  const sectionTexts = sections.map((s) => `## ${s.title}\n\n${s.content}`);

  return {
    fullPrompt: sectionTexts.join("\n\n"),
    sections: sectionTexts,
  };
}

// ============ Executor Factory ============

/**
 * Create an executor for genericAgent nodes.
 */
export function createGenericAgentExecutor(services: AgentKernelServices): NodeExecutor {
  return createAgentExecutor(services, { isSpecialized: false });
}

/**
 * Create an executor for specializedAgent nodes.
 */
export function createSpecializedAgentExecutor(services: AgentKernelServices): NodeExecutor {
  return createAgentExecutor(services, { isSpecialized: true });
}

interface ExecutorOptions {
  isSpecialized: boolean;
}

function createAgentExecutor(services: AgentKernelServices, opts: ExecutorOptions): NodeExecutor {
  return async (input: NodeExecutionInput) => {
    const node = input.node;
    const config = node.config as Record<string, unknown>;
    const inputs = input.inputs as Record<string, unknown>;

    // Resolve profile (specialized only)
    let profile: SpecializedAgentProfile | undefined;
    if (opts.isSpecialized) {
      const profileId = String(config.profileId ?? "");
      if (!profileId) {
        throw new Error("specializedAgent: profileId is required. Set a profileId in node config.");
      }
      profile = services.profileRegistry?.get(profileId);
      if (!profile) {
        throw new Error(
          `specializedAgent: profile "${profileId}" not found in registry. ` +
            `Available: ${(services.profileRegistry?.list() ?? []).map((p) => p.profileId).join(", ") || "none"}`,
        );
      }
    }

    // Resolve effective model config
    const resolvedModel = resolveEffectiveModelConfig(config, profile, services);

    // Validate provider exists
    let adapter: LlmAdapter;
    try {
      adapter = services.createAdapter(resolvedModel.providerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Agent kernel: failed to create adapter for provider "${resolvedModel.providerId}": ${message}`,
      );
    }

    // Determine system prompt
    const systemPrompt = profile
      ? profile.foundationalSystemPrompt
      : String(config.systemPrompt ?? "You are a helpful assistant.");

    // Determine input order
    const defaultOrder = { userInput: 1, instruction: 2, context: 3, data: 4 };
    const inputOrder = profile ? profile.inputOrder : defaultOrder;

    // Determine if JSON renderer is enabled
    const jsonRendererEnabled = profile
      ? (profile.requiredInputs.data.jsonRenderer ?? true)
      : config.jsonRendererEnabled !== false;

    // Assemble prompt
    const promptAssembly = assemblePrompt({
      systemPrompt,
      userInput: typeof inputs.userInput === "string" ? inputs.userInput : undefined,
      instruction: typeof inputs.instruction === "string" ? inputs.instruction : undefined,
      context: typeof inputs.context === "string" ? inputs.context : undefined,
      data: inputs.data,
      dataRendered: jsonRendererEnabled,
      inputOrder,
    });

    // Call LLM
    const startedAt = Date.now();
    const startedIso = new Date(startedAt).toISOString();
    let llmResult: Awaited<ReturnType<LlmAdapter["complete"]>>;
    let invocationEvent: LlmInvocationTelemetryV1;
    try {
      llmResult = await adapter.complete({
        model: resolvedModel.model,
        prompt: promptAssembly.fullPrompt,
        temperature: resolvedModel.temperature,
        topP: resolvedModel.topP,
        maxTokens: resolvedModel.maxTokens,
      });
      const endedAt = Date.now();
      invocationEvent = {
        invocationId: createInvocationId(),
        traceId: input.context?.traceId ?? input.context?.runId ?? "trace-unavailable",
        runId: input.context?.runId ?? "run-unavailable",
        workflowId: getStringValue(input.context?.values, "workflowId"),
        workflowVersion: getNumberValue(input.context?.values, "workflowVersion"),
        nodeId: node.id,
        nodeType: node.type,
        profileId: profile?.profileId,
        role: resolveTelemetryRole(node.type, profile?.profileId, config),
        attempt: resolveTelemetryAttempt(config),
        providerId: resolvedModel.providerId,
        model: resolvedModel.model,
        startedAt: startedIso,
        endedAt: new Date(endedAt).toISOString(),
        latencyMs: Math.max(0, endedAt - startedAt),
        status: "success",
        tokenUsage: coerceLlmTokenUsage(llmResult.tokenUsage),
        finishReason: llmResult.finishReason,
      };
    } catch (error) {
      const endedAt = Date.now();
      await safeRecordLlmInvocation({
        sink: input.context?.telemetrySink,
        warnings: input.context?.telemetryWarnings,
        event: {
          invocationId: createInvocationId(),
          traceId: input.context?.traceId ?? input.context?.runId ?? "trace-unavailable",
          runId: input.context?.runId ?? "run-unavailable",
          workflowId: getStringValue(input.context?.values, "workflowId"),
          workflowVersion: getNumberValue(input.context?.values, "workflowVersion"),
          nodeId: node.id,
          nodeType: node.type,
          profileId: profile?.profileId,
          role: resolveTelemetryRole(node.type, profile?.profileId, config),
          attempt: resolveTelemetryAttempt(config),
          providerId: resolvedModel.providerId,
          model: resolvedModel.model,
          startedAt: startedIso,
          endedAt: new Date(endedAt).toISOString(),
          latencyMs: Math.max(0, endedAt - startedAt),
          status: "error",
          tokenUsage: unavailableTokenUsage(),
          errorCode: "LLM_PROVIDER_ERROR",
        },
      });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Agent kernel: LLM call failed: ${message}`);
    }

    let budgetError: unknown;
    try {
      input.context?.usageBudgetController?.recordLlmInvocation(invocationEvent);
    } catch (error) {
      budgetError = error;
    }
    await safeRecordLlmInvocation({
      sink: input.context?.telemetrySink,
      warnings: input.context?.telemetryWarnings,
      failureMode: input.context?.telemetrySinkFailureMode,
      event: invocationEvent,
    });
    if (budgetError) {
      throw budgetError;
    }
    const latencyMs = Date.now() - startedAt;

    // Trace metadata
    const promptSources: Array<{
      source: string;
      order: number;
      rendered: boolean;
      present: boolean;
    }> = [];
    if (systemPrompt)
      promptSources.push({ source: "system", order: -1, rendered: false, present: true });
    if (
      inputs.userInput !== undefined &&
      inputs.userInput !== null &&
      String(inputs.userInput).length > 0
    )
      promptSources.push({
        source: "userInput",
        order: inputOrder.userInput ?? 1,
        rendered: false,
        present: true,
      });
    if (
      inputs.instruction !== undefined &&
      inputs.instruction !== null &&
      String(inputs.instruction).length > 0
    )
      promptSources.push({
        source: "instruction",
        order: inputOrder.instruction ?? 2,
        rendered: false,
        present: true,
      });
    if (
      inputs.context !== undefined &&
      inputs.context !== null &&
      String(inputs.context).length > 0
    )
      promptSources.push({
        source: "context",
        order: inputOrder.context ?? 3,
        rendered: false,
        present: true,
      });
    if (inputs.data !== undefined && inputs.data !== null)
      promptSources.push({
        source: "data",
        order: inputOrder.data ?? 4,
        rendered: jsonRendererEnabled,
        present: true,
      });
    promptSources.sort((a, b) => a.order - b.order);

    const metadata: Record<string, unknown> = {
      providerId: resolvedModel.providerId,
      model: resolvedModel.model,
      temperature: resolvedModel.temperature,
      topP: resolvedModel.topP,
      maxTokens: resolvedModel.maxTokens,
      responseFormat: resolvedModel.responseFormat,
      latencyMs,
      tokenUsage: coerceLlmTokenUsage(llmResult.tokenUsage),
      profileId: profile?.profileId ?? null,
      jsonRendererEnabled,
      sectionCount: promptAssembly.sections.length,
      promptTokens: promptAssembly.fullPrompt.length,
      promptSources,
    };

    return {
      outputs: {
        result: llmResult.text,
      },
      metadata,
    };
  };
}

function resolveTelemetryRole(
  nodeType: string,
  profileId: string | undefined,
  config: Record<string, unknown>,
): LlmInvocationRoleV1 {
  const telemetry = config.telemetry as Record<string, unknown> | undefined;
  const configured = telemetry?.role;
  if (
    configured === "writer" ||
    configured === "critic" ||
    configured === "memory-curator" ||
    configured === "generic" ||
    configured === "other"
  ) {
    return configured;
  }
  if (nodeType === "genericAgent") return "generic";
  if (profileId === "rp-writer") return "writer";
  if (profileId === "rp-critic") return "critic";
  if (profileId === "rp-memory-curator") return "memory-curator";
  return "other";
}

function resolveTelemetryAttempt(config: Record<string, unknown>): number | undefined {
  const telemetry = config.telemetry as Record<string, unknown> | undefined;
  const attempt = telemetry?.attempt;
  return typeof attempt === "number" && Number.isInteger(attempt) && attempt >= 0
    ? attempt
    : undefined;
}

function createInvocationId(): string {
  return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getStringValue(values: Readonly<Record<string, unknown>> | undefined, key: string) {
  const value = values?.[key];
  return typeof value === "string" ? value : undefined;
}

function getNumberValue(values: Readonly<Record<string, unknown>> | undefined, key: string) {
  const value = values?.[key];
  return typeof value === "number" ? value : undefined;
}
