import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type { RecentMessage } from "../types.js";

/**
 * NodeDefinition for rpRecentMessagesV1.
 * Provides recent messages from config for workflow integration.
 */
export const rpRecentMessagesV1Definition: NodeDefinition = {
  type: "rpRecentMessagesV1",
  label: "RP Recent Messages",
  category: "roleplay",
  description: "Provides recent conversation messages for context assembly",
  color: "#9333ea",
  ports: [
    {
      id: "recentMessages",
      label: "Recent Messages",
      dataType: "json",
      direction: "output",
    },
  ],
};

/**
 * Factory function that creates the executor for rpRecentMessagesV1.
 * Reads messages from node config and passes them through.
 */
export function createRpRecentMessagesV1Executor(): NodeExecutor {
  return async (input: NodeExecutionInput) => {
    const messages = input.node.config?.messages as RecentMessage[] | undefined;

    // If no messages in config, return empty array
    if (!messages || !Array.isArray(messages)) {
      return { outputs: { recentMessages: [] } };
    }

    return { outputs: { recentMessages: messages } };
  };
}
