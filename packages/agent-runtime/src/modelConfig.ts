/**
 * Model Configuration Types
 *
 * Public types for node-level model configuration.
 * These types contain NO secrets, API keys, or provider credentials.
 * They are safe to appear in Workflow JSON, node config, and trace output.
 */

/** Public model request — safe for Workflow JSON, trace, and logs. */
export interface ResolvedModelRequest {
  providerId: string;
  model: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  timeoutMs?: number;
  responseFormat?: "text" | "json_object";
}

/** Node-level or workflow-level model configuration. All fields optional. */
export interface NodeModelConfig {
  provider?: string;
  model?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  timeoutMs?: number;
  responseFormat?: "text" | "json_object";
}
