import type { PluginDefinition } from "@awp/plugin-sdk";

export type AgentNodeConfig = {
  model: string;
  systemPrompt: string;
  skills: string[];
  plugins: string[];
  outputType: string;
  temperature?: number;
};

export type SkillDefinition = {
  id: string;
  label: string;
  content: string;
};

export type AgentExecutionInput = {
  nodeId: string;
  config: AgentNodeConfig;
  inputs: Record<string, unknown>;
  availableSkills: SkillDefinition[];
  availablePlugins: PluginDefinition[];
};

export type PromptAssembly = {
  cacheablePrefix: string;
  dynamicSuffix: string;
  fullPrompt: string;
  cacheablePrefixHash: string;
  dynamicInputHash: string;
  visibleSkillIds: string[];
  visiblePluginIds: string[];
};

export type AgentExecutionResult = {
  text: string;
  metadata: {
    nodeId: string;
    model: string;
    provider: string;
    cacheablePrefixHash: string;
    dynamicInputHash: string;
    visibleSkillIds: string[];
    visiblePluginIds: string[];
    tokenUsage: {
      input: number;
      output: number;
      cachedInput?: number;
    };
    latencyMs: number;
  };
};

export type LlmAdapter = {
  provider: string;
  complete: (input: LlmCompletionInput) => Promise<LlmCompletionResult>;
  stream?: (
    input: LlmCompletionInput & { onToken?: (token: string) => void },
  ) => Promise<LlmCompletionResult>;
};

export type LlmCompletionInput = {
  model: string;
  prompt: string;
  temperature?: number;
};

export type LlmCompletionResult = {
  text: string;
  tokenUsage: AgentExecutionResult["metadata"]["tokenUsage"];
};
