/**
 * P-12: Official RP Executor Factory
 *
 * Creates executors for the official RP service.
 * Reuses production stores and adapters — never creates test-only instances.
 */
import { type NodeExecutor } from "@awp/workflow-core";
import { createStdlibExecutors } from "@awp/workflow-stdlib";
import {
  createSpecializedAgentExecutor,
  createAgentSessionLoadV1Executor,
  createAgentSessionCommitV1Executor,
  rpMemoryCommitPolicyExecutor,
  rpCriticQualityGateExecutor,
  rpSideEffectDecisionExecutor,
  failWorkflowExecutor,
  sessionContextToMarkdown,
} from "@awp/agent-runtime";
import { createDynamicWorldbookExecutor } from "@awp/workflow-worldbook";
import {
  genericRetrieverExecutor,
  retrievalResultToMarkdownExecutor,
} from "@awp/workflow-retrieval";
import { createMemoryWriteExecutor, createMemoryCorpusExecutor } from "@awp/workflow-memory";
import type { OfficialRpRequestV1, OfficialRpServiceContext } from "./officialRpTypes.js";

export function createRpExecutors(
  ctx: OfficialRpServiceContext,
  _request: OfficialRpRequestV1,
): Record<string, NodeExecutor> {
  const { llmRouter, profileRegistry, sessionStore, memoryStore, worldbookStore } = ctx;

  return {
    // ── Stdlib ──
    ...createStdlibExecutors(),

    // ── Input nodes ──
    playerInput: async ({ node }) => ({
      outputs: { text: String(node.config.text ?? "") },
    }),

    // ── Output nodes ──
    playerOutput: async ({ inputs }) => ({
      outputs: { final: inputs.text ?? "" },
    }),

    inspectOutput: async ({ inputs }) => {
      const parts: string[] = [];
      if (inputs.jsonInput !== undefined && inputs.jsonInput !== null) {
        parts.push(`[JSON]\n${JSON.stringify(inputs.jsonInput, null, 2)}`);
      }
      if (inputs.markdownInput !== undefined && inputs.markdownInput !== null) {
        parts.push(`[Markdown]\n${String(inputs.markdownInput)}`);
      }
      if (inputs.textInput !== undefined && inputs.textInput !== null) {
        parts.push(`[Text]\n${String(inputs.textInput)}`);
      }
      return { outputs: { debug: parts.join("\n\n") || "(no inputs connected)" } };
    },

    // ── Specialized Agents ──
    specializedAgent: createSpecializedAgentExecutor({
      registry: llmRouter.providerRegistry,
      profileRegistry,
      createAdapter: (providerId) => llmRouter.adapter(providerId),
    }),

    // ── Session ──
    agentSessionLoadV1: createAgentSessionLoadV1Executor({ store: sessionStore }),
    agentSessionCommitV1: createAgentSessionCommitV1Executor({ store: sessionStore }),

    sessionToMarkdown: async ({ inputs }) => {
      const sc = inputs.sessionContext as Record<string, unknown> | undefined;
      if (!sc || typeof sc !== "object") {
        return { outputs: { markdown: "(No session history.)" } };
      }
      const markdown = sessionContextToMarkdown(
        sc as unknown as Parameters<typeof sessionContextToMarkdown>[0],
      );
      return { outputs: { markdown } };
    },

    // ── Worldbook ──
    dynamicWorldbook: createDynamicWorldbookExecutor({
      store: worldbookStore,
      scopeContext: { sessionId: _request.sessionId },
    }),

    // ── Retrieval ──
    genericRetriever: genericRetrieverExecutor,
    retrievalResultToMarkdown: retrievalResultToMarkdownExecutor,

    // ── Memory ──
    memoryWrite: createMemoryWriteExecutor(memoryStore),
    memoryCorpus: createMemoryCorpusExecutor(memoryStore),

    // ── RP-specific ──
    rpMemoryCommitPolicy: rpMemoryCommitPolicyExecutor,
    rpCriticQualityGate: rpCriticQualityGateExecutor,
    rpSideEffectDecision: rpSideEffectDecisionExecutor,
    failWorkflow: failWorkflowExecutor,
  };
}
