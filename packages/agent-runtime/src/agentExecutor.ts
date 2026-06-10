import { buildPromptAssembly } from "./promptBuilder";
import { mockLlmAdapter } from "./mockLlm";
import type { AgentExecutionInput, AgentExecutionResult, LlmAdapter } from "./types";

export const executeAgentNode = async (
  input: AgentExecutionInput,
  adapter: LlmAdapter = mockLlmAdapter,
  options: { onToken?: (token: string) => void } = {},
): Promise<AgentExecutionResult> => {
  const startedAt = performance.now();
  const assembly = buildPromptAssembly(input);
  const completionInput = {
    model: input.config.model,
    prompt: assembly.fullPrompt,
    temperature: input.config.temperature,
  };
  const completion =
    options.onToken && adapter.stream
      ? await adapter.stream({ ...completionInput, onToken: options.onToken })
      : await adapter.complete(completionInput);

  return {
    text: completion.text,
    metadata: {
      nodeId: input.nodeId,
      model: input.config.model,
      provider: adapter.provider,
      cacheablePrefixHash: assembly.cacheablePrefixHash,
      dynamicInputHash: assembly.dynamicInputHash,
      visibleSkillIds: assembly.visibleSkillIds,
      visiblePluginIds: assembly.visiblePluginIds,
      tokenUsage: completion.tokenUsage,
      latencyMs: Math.round(performance.now() - startedAt),
    },
  };
};
