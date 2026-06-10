import { hashText } from "./promptBuilder";
import type { LlmAdapter } from "./types";

export const mockLlmAdapter: LlmAdapter = {
  provider: "mock",
  async complete(input) {
    const promptHash = hashText(input.prompt);
    const preview = input.prompt.slice(-180).replace(/\s+/g, " ").trim();

    return {
      text: `[mock:${input.model}:${promptHash}] ${preview}`,
      tokenUsage: {
        input: Math.ceil(input.prompt.length / 4),
        output: 48,
        cachedInput: Math.ceil(input.prompt.length / 8),
      },
    };
  },
};
