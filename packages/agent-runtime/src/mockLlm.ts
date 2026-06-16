import { createMockLlmAdapter } from "./llmUsage";
import type { LlmAdapter } from "./types";

export const mockLlmAdapter: LlmAdapter = createMockLlmAdapter();
