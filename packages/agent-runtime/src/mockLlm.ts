import { createMockLlmAdapter } from "./llmUsage.js";
import type { LlmAdapter } from "./types.js";

export const mockLlmAdapter: LlmAdapter = createMockLlmAdapter();
