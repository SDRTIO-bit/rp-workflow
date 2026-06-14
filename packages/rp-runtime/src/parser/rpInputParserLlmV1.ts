/**
 * RP Input Parser LLM V1 - Phase B-2.8
 *
 * Uses LLM to parse complex Chinese RP input into structured ParsedRpInputV1.
 * Grounded by worldbook candidates to prevent entity invention.
 *
 * Degradation path:
 * 1. LLM available → call LLM
 * 2. LLM succeeds → validate JSON structure → Grounding → output
 * 3. LLM fails or unavailable → Regex fallback → validate structure → Grounding → output
 * 4. Regex fails or returns invalid structure → Empty fallback → output
 */

import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type { RpLlmAdapter } from "../nodes/rpWriterV1.js";
import type { WorldbookEntryV1 } from "../worldbook/types.js";
import type { ParsedRpInputV1, ParserInputV1 } from "./types.js";
import { validateAndGround } from "./grounding.js";
import { regexParseInput } from "./regexFallback.js";
import { validateParsedRpInputV1 } from "./validator.js";

/**
 * Configuration for rpInputParserLlmV1 executor.
 */
export interface RpInputParserLlmConfig {
  /** Model temperature. Default: 0.1 */
  temperature?: number;
  /** Max output tokens. Default: 1400 */
  maxOutputTokens?: number;
  /** Max parse attempts (retry on failure). Default: 1 */
  maxParseAttempts?: number;
}

/**
 * Services for rpInputParserLlmV1 executor.
 */
export interface RpInputParserLlmServices {
  llmAdapter?: RpLlmAdapter;
  config?: RpInputParserLlmConfig;
  /** Optional regex parser function for fallback. Defaults to regexParseInput. */
  regexParser?: (rawText: string) => ParsedRpInputV1;
}

/**
 * NodeDefinition for rpInputParserLlmV1.
 */
export const rpInputParserLlmV1Definition: NodeDefinition = {
  type: "rpInputParserLlmV1",
  label: "RP Input Parser (LLM)",
  category: "roleplay",
  description: "Parses complex Chinese RP input using LLM, grounded by worldbook candidates",
  color: "#9333ea",
  ports: [
    {
      id: "parserInput",
      label: "Parser Input",
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
      id: "parsedInput",
      label: "Parsed Input",
      dataType: "json",
      direction: "output",
      // B-2.9: this port emits ParsedRpInputV1, not the legacy ParsedInput.
      // The legacy schemaId was a B-2.8 misnomer; corrected here so the
      // output can be connected to rpContextAssemblerV2.parsedRpInput.
      schemaId: "rp.parsed-rp-input.v1",
    },
  ],
};

/**
 * Build the Parser prompt for complex Chinese RP input.
 */
function buildParserPrompt(input: ParserInputV1): string {
  const candidateList = input.candidateEntities
    .map(
      (c) =>
        `- ${c.entityId} (${c.name}): ${c.aliases.length > 0 ? "别名: " + c.aliases.join(", ") : ""} [${c.category}]${c.shortDescription ? " - " + c.shortDescription : ""}`,
    )
    .join("\n");

  const recentMsgs = input.recentMessages
    .slice(-5)
    .map((m) => `${m.role}: ${m.text}`)
    .join("\n");

  return `你是一个中文角色扮演输入解析器。分析玩家的原始输入，提取实体、指代、动作和意图。

## 候选实体目录（只使用这些ID）

${candidateList}

## 当前场景

地点: ${input.currentLocation ?? "未知"}
在场角色: ${input.charactersPresent.join(", ") || "无"}

## 最近消息

${recentMsgs || "无"}

## 玩家输入

${input.rawInput}

## 输出要求

返回严格的JSON格式，不要包含任何解释文字。只返回JSON对象。

JSON Schema:
{
  "version": "parsed-rp-input-v1",
  "rawText": "玩家原文",
  "mentions": [
    {
      "text": "原文中的提及",
      "entityId": "候选实体ID或player",
      "entryId": "世界书条目ID",
      "category": "worldbook分类",
      "confidence": 0.0到1.0,
      "evidence": "判断依据"
    }
  ],
  "references": [
    {
      "text": "原文中的指代词",
      "resolvedEntityId": "解析后的实体ID",
      "resolutionSource": "current_input|recent_messages|scene|unresolved",
      "confidence": 0.0到1.0
    }
  ],
  "dialogues": [
    {
      "speakerEntityId": "player或实体ID",
      "targetEntityIds": ["目标实体ID"],
      "text": "对白内容",
      "toneHints": ["语气提示"]
    }
  ],
  "actions": [
    {
      "actorEntityId": "player或实体ID",
      "action": "动作描述",
      "targetEntityIds": ["目标实体ID"],
      "objectEntityIds": ["对象实体ID"],
      "locationEntityIds": ["地点实体ID"],
      "purpose": "动作目的"
    }
  ],
  "intents": [
    {
      "type": "investigate|question|protect|escape|delay|conceal|confront|use_item|move|observe|wait",
      "targetEntityIds": ["目标实体ID"]
    }
  ],
  "historicalReferences": [
    {
      "text": "引用历史的原文",
      "entryId": "关联的世界书条目ID",
      "confidence": 0.0到1.0
    }
  ],
  "relationshipSignals": [
    {
      "type": "关系类型",
      "subjectEntityId": "主体实体ID",
      "objectEntityId": "客体实体ID",
      "evidence": "判断依据"
    }
  ],
  "unresolvedReferences": [
    {
      "text": "无法解析的文本",
      "reason": "无法解析的原因"
    }
  ]
}

## 重要规则

1. entityId 必须来自候选实体目录或 "player"
2. entryId 必须来自候选实体目录
3. 无法确定的指代放入 unresolvedReferences
4. 不要猜测或创造不存在的实体
5. 置信度低于0.5的引用放入 unresolvedReferences
6. 只返回JSON，不要返回其他内容`;
}

/**
 * Parse LLM response JSON, handling common issues.
 * Returns null if JSON is invalid or doesn't match expected structure.
 */
function parseLlmResponse(response: string): ParsedRpInputV1 | null {
  // Try to extract JSON from the response
  let jsonStr = response.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith("```json")) {
    jsonStr = jsonStr.slice(7);
  }
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith("```")) {
    jsonStr = jsonStr.slice(0, -3);
  }
  jsonStr = jsonStr.trim();

  // Try to find JSON object
  const jsonStart = jsonStr.indexOf("{");
  const jsonEnd = jsonStr.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    jsonStr = jsonStr.slice(jsonStart, jsonEnd + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // Add default diagnostics if missing (LLM doesn't know about this field)
    if (!parsed.diagnostics) {
      parsed.diagnostics = {
        parserMode: "llm",
        parseAttempts: 1,
        removedInvalidEntityIds: [],
        removedInvalidEntryIds: [],
        warnings: [],
      };
    }

    // Validate structure
    const validation = validateParsedRpInputV1(parsed);
    if (!validation.valid) {
      return null;
    }

    // Ensure version is set
    if (parsed.version !== "parsed-rp-input-v1") {
      parsed.version = "parsed-rp-input-v1";
    }

    return parsed as ParsedRpInputV1;
  } catch {
    // JSON parse failed
    return null;
  }
}

/**
 * Factory function that creates the executor for rpInputParserLlmV1.
 */
export function createRpInputParserLlmV1Executor(
  services?: RpInputParserLlmServices,
): NodeExecutor {
  const maxParseAttempts = services?.config?.maxParseAttempts ?? 1;

  return async (input: NodeExecutionInput) => {
    const { parserInput, worldbookEntries } = input.inputs;

    if (!parserInput || typeof parserInput !== "object") {
      throw new Error("rpInputParserLlmV1: parserInput is required");
    }

    if (!worldbookEntries || !Array.isArray(worldbookEntries)) {
      throw new Error("rpInputParserLlmV1: worldbookEntries is required");
    }

    const pi = parserInput as ParserInputV1;
    const entries = worldbookEntries as WorldbookEntryV1[];

    // Path 1: No LLM adapter → Regex fallback
    if (!services?.llmAdapter) {
      const regexParser = services?.regexParser ?? regexParseInput;
      try {
        const regexResult = regexParser(pi.rawInput);
        // Validate regex result structure
        const validation = validateParsedRpInputV1(regexResult);
        if (!validation.valid) {
          throw new Error(`Regex result validation failed: ${validation.errors.join(", ")}`);
        }
        const candidateEntityIds = pi.candidateEntities.map((c) => c.entityId);
        const groundingResult = validateAndGround(regexResult, entries, candidateEntityIds);

        // Update diagnostics
        groundingResult.validated.diagnostics = {
          ...groundingResult.validated.diagnostics,
          parserMode: "regex-fallback",
          warnings: [
            ...groundingResult.validated.diagnostics.warnings,
            "No LLM adapter configured, using regex fallback",
          ],
        };

        return { outputs: { parsedInput: groundingResult.validated } };
      } catch (error) {
        // Regex failed → Empty fallback
        const regexError = error instanceof Error ? error.message : String(error);
        const emptyResult = emptyFallback(pi.rawInput, undefined, regexError);
        const candidateEntityIds = pi.candidateEntities.map((c) => c.entityId);
        const groundingResult = validateAndGround(emptyResult, entries, candidateEntityIds);
        return { outputs: { parsedInput: groundingResult.validated } };
      }
    }

    // Path 2: LLM available → Call LLM with retry
    const prompt = buildParserPrompt(pi);
    let lastError: Error | null = null;
    let parsedResult: ParsedRpInputV1 | null = null;
    let parseAttempts = 0;

    for (let attempt = 0; attempt < maxParseAttempts; attempt++) {
      parseAttempts = attempt + 1;
      try {
        const result = await services.llmAdapter.complete(prompt);
        parsedResult = parseLlmResponse(result.text);

        if (parsedResult) {
          break; // Success
        }
        lastError = new Error("Failed to parse LLM response as JSON");
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    // Path 2a: LLM succeeded → Validate and Ground
    if (parsedResult) {
      // Ground the parsed result
      const candidateEntityIds = pi.candidateEntities.map((c) => c.entityId);
      const groundingResult = validateAndGround(parsedResult, entries, candidateEntityIds);

      // Update diagnostics
      groundingResult.validated.diagnostics = {
        ...groundingResult.validated.diagnostics,
        parserMode: "llm",
        model: services.llmAdapter.provider,
        parseAttempts,
      };

      return { outputs: { parsedInput: groundingResult.validated } };
    }

    // Path 2b: LLM failed → Regex fallback
    const regexParser = services?.regexParser ?? regexParseInput;
    try {
      const regexResult = regexParser(pi.rawInput);
      // Validate regex result structure
      const validation = validateParsedRpInputV1(regexResult);
      if (!validation.valid) {
        throw new Error(`Regex result validation failed: ${validation.errors.join(", ")}`);
      }
      const candidateEntityIds = pi.candidateEntities.map((c) => c.entityId);
      const groundingResult = validateAndGround(regexResult, entries, candidateEntityIds);

      // Update diagnostics with LLM failure info
      groundingResult.validated.diagnostics = {
        ...groundingResult.validated.diagnostics,
        parserMode: "regex-fallback",
        model: services.llmAdapter.provider,
        parseAttempts,
        warnings: [
          ...groundingResult.validated.diagnostics.warnings,
          `LLM failed after ${parseAttempts} attempts: ${lastError?.message}`,
        ],
      };

      return { outputs: { parsedInput: groundingResult.validated } };
    } catch (error) {
      // Regex failed → Empty fallback
      const regexError = error instanceof Error ? error.message : String(error);
      const llmErrorMessage = lastError?.message ?? "Unknown LLM error";
      const emptyResult = emptyFallback(pi.rawInput, llmErrorMessage, regexError);
      const candidateEntityIds = pi.candidateEntities.map((c) => c.entityId);
      const groundingResult = validateAndGround(emptyResult, entries, candidateEntityIds);
      groundingResult.validated.diagnostics = {
        ...groundingResult.validated.diagnostics,
        parserMode: "empty-fallback",
        model: services.llmAdapter.provider,
        parseAttempts,
        warnings: [
          `LLM failed after ${parseAttempts} attempts: ${llmErrorMessage}`,
          `Regex failed: ${regexError}`,
        ],
      };
      return { outputs: { parsedInput: groundingResult.validated } };
    }
  };
}

/**
 * Empty fallback parser - returns minimal ParsedRpInputV1 with rawText preserved.
 * Used when both LLM and Regex fail.
 */
function emptyFallback(rawText: string, llmError?: string, regexError?: string): ParsedRpInputV1 {
  const warnings: string[] = [];
  if (llmError) {
    warnings.push(`LLM failed: ${llmError}`);
  }
  if (regexError) {
    warnings.push(`Regex failed: ${regexError}`);
  }

  return {
    version: "parsed-rp-input-v1",
    rawText,
    mentions: [],
    references: [],
    dialogues: [],
    actions: [],
    intents: [],
    historicalReferences: [],
    relationshipSignals: [],
    unresolvedReferences: [
      {
        text: rawText,
        reason: `Both LLM and Regex parsing failed. ${warnings.join("; ")}`,
      },
    ],
    diagnostics: {
      parserMode: "empty-fallback",
      parseAttempts: 0,
      removedInvalidEntityIds: [],
      removedInvalidEntryIds: [],
      warnings,
    },
  };
}
