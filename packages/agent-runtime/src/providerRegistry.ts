import type { LlmAdapter } from "./types.js";
import type { NodeModelConfig, ResolvedModelRequest } from "./modelConfig.js";

// ============ Provider Config (server-side, holds secrets) ============

export interface ProviderConfig {
  providerId: string;
  /** API key — NEVER exposed to nodes, Workflow JSON, or trace. */
  apiKey: string;
  /** Base URL for the provider API. */
  baseUrl: string;
  /** Default model when none is specified by node or workflow. */
  defaultModel: string;
  /** Factory that creates an LlmAdapter for this provider. */
  createAdapter: (apiKey: string, baseUrl: string) => LlmAdapter;
}

// ============ Provider Registry ============

export class ProviderRegistry {
  private providers = new Map<string, ProviderConfig>();
  private _defaultProviderId: string;

  constructor(defaultProviderId: string) {
    this._defaultProviderId = defaultProviderId;
  }

  /** Register a provider. Throws if providerId already exists. */
  register(config: ProviderConfig): void {
    if (this.providers.has(config.providerId)) {
      throw new Error(`ProviderRegistry: duplicate providerId "${config.providerId}"`);
    }
    this.providers.set(config.providerId, config);
  }

  /** Get a provider by id. Throws if not found. */
  get(providerId: string): ProviderConfig {
    const config = this.providers.get(providerId);
    if (!config) {
      const available = [...this.providers.keys()].join(", ") || "(none)";
      throw new Error(
        `ProviderRegistry: unknown providerId "${providerId}". Available: ${available}`,
      );
    }
    return config;
  }

  /** Get the default provider. Throws if not registered. */
  getDefault(): ProviderConfig {
    return this.get(this._defaultProviderId);
  }

  /** Create an adapter for a given provider. */
  createAdapter(providerId: string): LlmAdapter {
    const config = this.get(providerId);
    return config.createAdapter(config.apiKey, config.baseUrl);
  }

  /** Create the default adapter. */
  createDefaultAdapter(): LlmAdapter {
    return this.createAdapter(this._defaultProviderId);
  }

  get defaultProviderId(): string {
    return this._defaultProviderId;
  }
}

// ============ resolveModelConfig ============

/**
 * Resolve the effective model configuration from node, workflow, and server defaults.
 *
 * Priority: node.modelConfig > workflow.defaults.modelConfig > server provider defaults.
 *
 * Returns a ResolvedModelRequest containing ONLY public fields.
 * API keys and base URLs are NEVER returned.
 */
export function resolveModelConfig(
  nodeConfig: Partial<NodeModelConfig> | undefined,
  workflowDefaults: Partial<NodeModelConfig> | undefined,
  registry: ProviderRegistry,
): ResolvedModelRequest {
  // 1. Determine providerId
  const providerId =
    nodeConfig?.provider ?? workflowDefaults?.provider ?? registry.defaultProviderId;

  // 2. Get provider config (throws if providerId not registered)
  const providerConfig = registry.get(providerId);

  // 3. Determine model
  const model = nodeConfig?.model ?? workflowDefaults?.model ?? providerConfig.defaultModel;

  // 4. Validate model is available
  // (Model validation is opt-in — providers may not expose a static model list)

  // 5. Merge other parameters
  return {
    providerId,
    model,
    temperature: nodeConfig?.temperature ?? workflowDefaults?.temperature,
    topP: nodeConfig?.topP ?? workflowDefaults?.topP,
    maxTokens: nodeConfig?.maxTokens ?? workflowDefaults?.maxTokens,
    timeoutMs: nodeConfig?.timeoutMs ?? workflowDefaults?.timeoutMs,
    responseFormat: nodeConfig?.responseFormat ?? workflowDefaults?.responseFormat,
  };
}
