import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type { ParsedInput, DialogueLine } from "../types.js";
import { validateSchema } from "../schemas.js";

/**
 * NodeDefinition for rpInputParserV1.
 * Parses raw user input into structured ParsedInput.
 */
export const rpInputParserV1Definition: NodeDefinition = {
  type: "rpInputParserV1",
  label: "RP Input Parser",
  category: "roleplay",
  description: "Parses raw user input into structured dialogue, actions, and entities",
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
      id: "parsedInput",
      label: "Parsed Input",
      dataType: "json",
      direction: "output",
      schemaId: "rp.parsed-input.v1",
    },
  ],
};

/**
 * Factory function that creates the executor for rpInputParserV1.
 * MVP implementation uses regex-based parsing (no LLM).
 */
export function createRpInputParserV1Executor(): NodeExecutor {
  return async (input: NodeExecutionInput) => {
    const rawInput = input.inputs.rawInput;
    if (typeof rawInput !== "string") {
      throw new Error("rpInputParserV1: rawInput must be a string");
    }

    const parsed = parseInput(rawInput);

    // Validate output against schema
    validateSchema("rp.parsed-input.v1", parsed);

    return {
      outputs: { parsedInput: parsed },
    };
  };
}

/**
 * MVP parser: extracts dialogues and actions using regex.
 * Future: replace with LLM-based extraction.
 */
function parseInput(rawText: string): ParsedInput {
  const dialogues: DialogueLine[] = [];
  const actions: string[] = [];

  // Extract dialogues: "text" or \u201ctext\u201d or 「text」
  const dialoguePatterns = [
    /[\u0022\u201c\u201d]([^\u0022\u201c\u201d]+)[\u0022\u201c\u201d]/g, // ASCII + curly quotes
    /\u300c([^\u300d]+)\u300d/g, // Japanese quotes
  ];

  for (const pattern of dialoguePatterns) {
    let match;
    while ((match = pattern.exec(rawText)) !== null) {
      const text = match[1];
      if (text !== undefined) {
        dialogues.push({
          speaker: "unknown",
          text,
        });
      }
    }
  }

  // Extract actions: *action*
  const actionPattern = /\*([^*]+)\*/g;
  let actionMatch;
  while ((actionMatch = actionPattern.exec(rawText)) !== null) {
    const action = actionMatch[1];
    if (action !== undefined) {
      actions.push(action);
    }
  }

  return {
    rawText,
    actions,
    dialogues,
    intents: [],
    entities: {
      characters: [],
      locations: [],
      items: [],
      timeHints: [],
    },
    parsedAt: new Date().toISOString(),
  };
}
