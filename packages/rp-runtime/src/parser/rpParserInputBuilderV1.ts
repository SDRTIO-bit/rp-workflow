/**
 * RP Parser Input Builder V1 - Phase B-2.8
 *
 * Adapter node that builds ParserInputV1 from B-2.7 deterministic retrieval output.
 * Connects WorldbookRetriever → LLM Parser.
 */

import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type { WorldbookEntryV1, WorldbookRetrievalResult } from "../worldbook/types.js";
import type { ParserInputV1, ParserEntityCandidateV1 } from "./types.js";

/**
 * NodeDefinition for rpParserInputBuilderV1.
 */
export const rpParserInputBuilderV1Definition: NodeDefinition = {
  type: "rpParserInputBuilderV1",
  label: "RP Parser Input Builder",
  category: "roleplay",
  description: "Builds ParserInputV1 from B-2.7 deterministic retrieval output",
  color: "#9333ea",
  ports: [
    {
      id: "rawInput",
      label: "Raw Input",
      dataType: "text",
      direction: "input",
      required: true,
    },
    {
      id: "retrievalResult",
      label: "Retrieval Result",
      dataType: "json",
      direction: "input",
      required: true,
    },
    {
      id: "worldbookEntries",
      label: "Worldbook Entries",
      dataType: "json",
      direction: "input",
      required: true,
    },
    {
      id: "recentMessages",
      label: "Recent Messages",
      dataType: "json",
      direction: "input",
      required: false,
    },
    {
      id: "currentLocation",
      label: "Current Location",
      dataType: "text",
      direction: "input",
      required: false,
    },
    {
      id: "charactersPresent",
      label: "Characters Present",
      dataType: "json",
      direction: "input",
      required: false,
    },
    {
      id: "parserInput",
      label: "Parser Input",
      dataType: "json",
      direction: "output",
    },
  ],
};

/**
 * Build ParserEntityCandidateV1 from WorldbookEntryV1.
 */
function buildCandidate(entry: WorldbookEntryV1): ParserEntityCandidateV1 {
  return {
    entityId: entry.id,
    entryId: entry.id,
    name: entry.title,
    aliases: entry.aliases ?? [],
    category: entry.category,
    shortDescription: entry.content.slice(0, 100),
  };
}

/**
 * Factory function that creates the executor for rpParserInputBuilderV1.
 */
export function createRpParserInputBuilderV1Executor(): NodeExecutor {
  return async (input: NodeExecutionInput) => {
    const {
      rawInput,
      retrievalResult,
      worldbookEntries,
      recentMessages,
      currentLocation,
      charactersPresent,
    } = input.inputs;

    if (!rawInput || typeof rawInput !== "string") {
      throw new Error("rpParserInputBuilderV1: rawInput is required");
    }

    if (!retrievalResult || typeof retrievalResult !== "object") {
      throw new Error("rpParserInputBuilderV1: retrievalResult is required");
    }

    if (!worldbookEntries || !Array.isArray(worldbookEntries)) {
      throw new Error("rpParserInputBuilderV1: worldbookEntries is required");
    }

    const detResult = retrievalResult as WorldbookRetrievalResult;

    // Build candidate entities from direct hits and expanded entries
    const allRetrievedEntries = [...detResult.directHits, ...detResult.expandedEntries];
    const candidateEntities = allRetrievedEntries.map(buildCandidate);

    // Build ParserInputV1
    const parserInput: ParserInputV1 = {
      rawInput,
      recentMessages: ((recentMessages as Array<{ text: string; role: string }>) ?? []).slice(-5),
      currentLocation: (currentLocation as string) ?? undefined,
      charactersPresent: (charactersPresent as string[]) ?? [],
      candidateEntities,
      directHitEntryIds: detResult.directHits.map((e) => e.id),
      expandedEntryIds: detResult.expandedEntries.map((e) => e.id),
    };

    return { outputs: { parserInput } };
  };
}
