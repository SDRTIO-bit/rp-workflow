import type { LlmAdapter, LlmCompletionInput, LlmCompletionResult } from "./types.js";
import type { NodeModelConfig, ResolvedModelRequest } from "./modelConfig.js";
import type { ProviderRegistry } from "./providerRegistry.js";
import { resolveModelConfig } from "./providerRegistry.js";

/**
 * LlmRouter — routes completion requests to the correct provider adapter.
 *
 * Each completion is routed based on the providerId in the ResolvedModelRequest.
 * Adapters are lazily created and cached per providerId.
 *
 * The router owns all provider adapters. Nodes never touch adapter instances directly.
 */
export class LlmRouter {
  private adapters = new Map<string, LlmAdapter>();

  constructor(private registry: ProviderRegistry) {}

  /** Expose the provider registry for external use (e.g., agent kernel model config resolution). */
  get providerRegistry(): ProviderRegistry {
    return this.registry;
  }

  /**
   * Get or create an adapter for a provider.
   * For use by legacy agent executors that need a direct LlmAdapter.
   * New code should use complete() or completeWithConfig().
   */
  adapter(providerId: string): LlmAdapter {
    return this.getAdapter(providerId);
  }

  private getAdapter(providerId: string): LlmAdapter {
    let adapter = this.adapters.get(providerId);
    if (!adapter) {
      adapter = this.registry.createAdapter(providerId);
      this.adapters.set(providerId, adapter);
    }
    return adapter;
  }

  /**
   * Resolve the effective config without making a call.
   * Used by bridges that need providerId/model for trace logging.
   */
  resolveConfig(
    nodeConfig: Partial<NodeModelConfig> | undefined,
    workflowDefaults: Partial<NodeModelConfig> | undefined,
  ): ResolvedModelRequest {
    return resolveModelConfig(nodeConfig, workflowDefaults, this.registry);
  }

  /**
   * Complete a prompt through the appropriate provider adapter.
   *
   * @param request - Resolved model request (providerId, model, temperature, ...)
   * @param prompt - The full prompt text
   */
  async complete(
    request: ResolvedModelRequest,
    prompt: string,
  ): Promise<{ text: string; tokenUsage: LlmCompletionResult["tokenUsage"] }> {
    const adapter = this.getAdapter(request.providerId);
    const input: LlmCompletionInput = {
      model: request.model,
      prompt,
      temperature: request.temperature,
    };
    return adapter.complete(input);
  }

  /**
   * Complete using node-level and workflow-level config resolution.
   * This is the primary entry point for RP nodes (Parser, Writer).
   */
  async completeWithConfig(
    nodeConfig: Partial<NodeModelConfig> | undefined,
    workflowDefaults: Partial<NodeModelConfig> | undefined,
    prompt: string,
  ): Promise<{ text: string; tokenUsage: LlmCompletionResult["tokenUsage"] }> {
    const request = this.resolveConfig(nodeConfig, workflowDefaults);
    return this.complete(request, prompt);
  }
}
