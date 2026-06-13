// RP Runtime Registration - Phase B

import type { NodeCatalog, NodeExecutor } from "@awp/workflow-core";
import type { RpRuntimeServices } from "./stores/types.js";
import type { SchemaValidator } from "./schemas.js";
import { schemaValidators } from "./schemas.js";
import {
  rpInputParserV1Definition,
  createRpInputParserV1Executor,
  rpContextAssemblerV1Definition,
  createRpContextAssemblerV1Executor,
  rpWriterV1Definition,
  createRpWriterV1Executor,
  rpTimelineQueryV1Definition,
  createRpTimelineQueryV1Executor,
  rpLoreRetrieverV1Definition,
  createRpLoreRetrieverV1Executor,
  rpChapterSummaryV1Definition,
  createRpChapterSummaryV1Executor,
  rpTrackerUpdateV1Definition,
  createRpTrackerUpdateV1Executor,
  rpMemoryCommitV1Definition,
  createRpMemoryCommitV1Executor,
  rpRecentMessagesV1Definition,
  createRpRecentMessagesV1Executor,
  rpPresetResolverV1Definition,
  createRpPresetResolverV1Executor,
  rpPromptCompilerV1Definition,
  createRpPromptCompilerV1Executor,
  rpOutputComposerV1Definition,
  createRpOutputComposerV1Executor,
  rpFormatValidatorV1Definition,
  createRpFormatValidatorV1Executor,
} from "./nodes/index.js";
import {
  rpWorldbookRetrieverV1Definition,
  createRpWorldbookRetrieverV1Executor,
} from "./worldbook/rpWorldbookRetrieverV1.js";
import {
  rpInputParserLlmV1Definition,
  createRpInputParserLlmV1Executor,
} from "./parser/rpInputParserLlmV1.js";
import {
  rpSemanticExpanderV1Definition,
  createRpSemanticExpanderV1Executor,
} from "./parser/rpSemanticExpanderV1.js";
import {
  rpParserInputBuilderV1Definition,
  createRpParserInputBuilderV1Executor,
} from "./parser/rpParserInputBuilderV1.js";

export interface RpRuntimeRegistration {
  catalog: NodeCatalog;
  executors: Record<string, NodeExecutor>;
  schemas: Record<string, SchemaValidator>;
}

/**
 * Register RP Runtime nodes, executors, and schemas.
 *
 * This function only receives stable services (stores, adapters, config).
 * Session scope (sessionId, worldId, turnId) is passed per-run via WorkflowRunContext.values.rp.
 *
 * ARCHITECTURE: Services injected here are captured in executor closures.
 * - ALLOWED: Store instances, LLM adapter, config, logger (stable, long-lived)
 * - FORBIDDEN: sessionId, worldId, turnId, per-run input (session state)
 */
export function registerRpRuntime(services: RpRuntimeServices): RpRuntimeRegistration {
  const catalog: NodeCatalog = {
    rpInputParserV1: rpInputParserV1Definition,
    rpTimelineQueryV1: rpTimelineQueryV1Definition,
    rpLoreRetrieverV1: rpLoreRetrieverV1Definition,
    rpContextAssemblerV1: rpContextAssemblerV1Definition,
    rpWriterV1: rpWriterV1Definition,
    rpChapterSummaryV1: rpChapterSummaryV1Definition,
    rpTrackerUpdateV1: rpTrackerUpdateV1Definition,
    rpMemoryCommitV1: rpMemoryCommitV1Definition,
    rpRecentMessagesV1: rpRecentMessagesV1Definition,
    rpPresetResolverV1: rpPresetResolverV1Definition,
    rpPromptCompilerV1: rpPromptCompilerV1Definition,
    rpOutputComposerV1: rpOutputComposerV1Definition,
    rpFormatValidatorV1: rpFormatValidatorV1Definition,
    rpWorldbookRetrieverV1: rpWorldbookRetrieverV1Definition,
    rpInputParserLlmV1: rpInputParserLlmV1Definition,
    rpSemanticExpanderV1: rpSemanticExpanderV1Definition,
    rpParserInputBuilderV1: rpParserInputBuilderV1Definition,
  };

  const executors: Record<string, NodeExecutor> = {
    rpInputParserV1: createRpInputParserV1Executor(),
    rpTimelineQueryV1: createRpTimelineQueryV1Executor({
      stores: services.stores,
    }),
    rpLoreRetrieverV1: createRpLoreRetrieverV1Executor({
      stores: services.stores,
    }),
    rpContextAssemblerV1: createRpContextAssemblerV1Executor({
      config: services.assemblerConfig,
    }),
    rpWriterV1: createRpWriterV1Executor({
      llmAdapter: services.llmAdapter,
      config: services.writerConfig,
    }),
    rpChapterSummaryV1: createRpChapterSummaryV1Executor(),
    rpTrackerUpdateV1: createRpTrackerUpdateV1Executor(),
    rpMemoryCommitV1: createRpMemoryCommitV1Executor({
      stores: services.stores,
    }),
    rpRecentMessagesV1: createRpRecentMessagesV1Executor(),
    rpPresetResolverV1: createRpPresetResolverV1Executor(),
    rpPromptCompilerV1: createRpPromptCompilerV1Executor(),
    rpOutputComposerV1: createRpOutputComposerV1Executor(),
    rpFormatValidatorV1: createRpFormatValidatorV1Executor(),
    rpWorldbookRetrieverV1: createRpWorldbookRetrieverV1Executor(),
    rpInputParserLlmV1: createRpInputParserLlmV1Executor({
      llmAdapter: services.llmAdapter,
    }),
    rpSemanticExpanderV1: createRpSemanticExpanderV1Executor(),
    rpParserInputBuilderV1: createRpParserInputBuilderV1Executor(),
  };

  return {
    catalog,
    executors,
    schemas: { ...schemaValidators },
  };
}
