/**
 * Specialized Agent Profile Registry — P-1
 *
 * Manages SpecializedAgentProfile instances. Profiles are resolved by profileId
 * at execution time. The registry supports built-in, project-local, and future
 * plugin-provided profiles.
 *
 * Workflow JSON stores only profileId. NodeDefinition NEVER hardcodes profile lists.
 */

import type { LocalizedText } from "@awp/workflow-core";

// ============ Types ============

/** Declared tool permission — declaration only in P-1, no runtime execution. */
export interface DeclaredToolPermission {
  toolId: string;
  toolName: string;
  description: string;
}

/** Per-slot input configuration for a specialized agent profile. */
export interface ProfileInputSlot {
  required: boolean;
  order: number;
  /** Enable JSON → Markdown rendering for this slot (only applicable to data:JSON). */
  jsonRenderer?: boolean;
}

/** Default model configuration for a profile. */
export interface ProfileModelDefaults {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  timeoutMs?: number;
  responseFormat?: "text" | "json_object";
}

/**
 * A specialized agent profile — pre-configured agent behavior.
 *
 * Profiles are DATA, not CODE. They do not execute anything directly.
 * The agent kernel reads profile data to configure prompt assembly and model calls.
 */
export interface SpecializedAgentProfile {
  /** Unique profile identifier (e.g. "rp-writer", "story-writer"). */
  profileId: string;
  /** Human-readable label. */
  label: LocalizedText;
  /** Description of what this profile does. */
  description: LocalizedText;
  /** Foundational system prompt — the agent's core identity and constraints. */
  foundationalSystemPrompt: string;
  /** Per-input-slot configuration. Only references the 4 fixed physical ports. */
  requiredInputs: {
    userInput: ProfileInputSlot;
    instruction: ProfileInputSlot;
    context: ProfileInputSlot;
    data: ProfileInputSlot;
  };
  /** Input ordering for prompt assembly. Lower numbers appear first. */
  inputOrder: {
    userInput: number;
    instruction: number;
    context: number;
    data: number;
  };
  /** Default model configuration (overridable by node config). */
  defaultModelConfig: ProfileModelDefaults;
  /** Config keys that the user CANNOT change in the node editor. */
  lockedFields: string[];
  /** Declared tool capabilities — declaration only in P-1. */
  declaredToolPermissions: DeclaredToolPermission[];
}

// ============ Registry Interface ============

export interface SpecializedAgentProfileRegistry {
  /** Get a profile by ID. Returns undefined if not found. */
  get(profileId: string): SpecializedAgentProfile | undefined;
  /** List all registered profile summaries. */
  list(): SpecializedAgentProfileSummary[];
}

export interface SpecializedAgentProfileSummary {
  profileId: string;
  label: LocalizedText;
}

// ============ In-Memory Implementation ============

export class InMemorySpecializedAgentProfileRegistry implements SpecializedAgentProfileRegistry {
  private profiles = new Map<string, SpecializedAgentProfile>();

  /** Register a profile. Throws if profileId already exists. */
  register(profile: SpecializedAgentProfile): void {
    if (this.profiles.has(profile.profileId)) {
      throw new Error(`ProfileRegistry: duplicate profileId "${profile.profileId}"`);
    }
    this.profiles.set(profile.profileId, profile);
  }

  get(profileId: string): SpecializedAgentProfile | undefined {
    return this.profiles.get(profileId);
  }

  list(): SpecializedAgentProfileSummary[] {
    const result: SpecializedAgentProfileSummary[] = [];
    for (const [profileId, profile] of this.profiles) {
      result.push({ profileId, label: profile.label });
    }
    return result;
  }
}

// ============ P-1 Built-in Mock Profiles ============

const RP_WRITER_PROFILE: SpecializedAgentProfile = {
  profileId: "rp-writer",
  label: { zh: "RP 写手", en: "RP Writer" },
  description: {
    zh: "生成沉浸式角色扮演叙事文本。维持角色一致性、世界连贯性和玩家行动权。",
    en: "Generates immersive roleplay narrative text. Maintains character consistency, world coherence, and player agency.",
  },
  foundationalSystemPrompt: [
    "You are a creative roleplay writing assistant. Your output will be shown directly to the player.",
    "",
    "## Core Rules",
    "- Continue the story naturally from the provided context.",
    "- Maintain strict character consistency — each character acts according to their established personality, knowledge, and goals.",
    "- Respect world coherence — all facts from the worldbook and scene state are canonical.",
    "- NEVER control the player's character or make decisions for them.",
    "- NEVER output analysis, reasoning, or meta-commentary — only narrative prose.",
    "- Show emotions through action and dialogue rather than stating them directly.",
    "- Include sensory details (sight, sound, smell, touch) to enhance immersion.",
    "- End at a natural break point to invite the player's next action.",
    "",
    "## Knowledge Boundaries",
    "- Characters only know what they have personally experienced or been told.",
    "- Do not reveal information that the current POV character could not know.",
    "- If context is insufficient, describe what the character perceives rather than fabricating facts.",
    "- Never contradict established world facts, even if they seem to create tension.",
    "",
    "## Output Format",
    "- Output ONLY the narrative text — no headers, labels, or explanations.",
    "- Follow the preset's style, length, and formatting requirements.",
    "- Use the appropriate language and tone for the setting.",
    "- If a preset specifies a particular format (e.g., first-person, present tense), adhere to it strictly.",
  ].join("\n"),
  requiredInputs: {
    userInput: { required: true, order: 5 },
    instruction: { required: false, order: 1 },
    context: { required: false, order: 4 },
    data: { required: false, order: 2, jsonRenderer: true },
  },
  inputOrder: {
    instruction: 1,
    data: 2,
    context: 4,
    userInput: 5,
  },
  defaultModelConfig: {
    temperature: 0.8,
    topP: 0.95,
    maxTokens: 2048,
    responseFormat: "text",
  },
  lockedFields: ["responseFormat"],
  declaredToolPermissions: [],
};

const STORY_WRITER_PROFILE: SpecializedAgentProfile = {
  profileId: "story-writer",
  label: { zh: "故事写手", en: "Story Writer" },
  description: {
    zh: "生成创意故事文本。侧重叙事结构和文学质量。",
    en: "Generates creative story text. Focuses on narrative structure and literary quality.",
  },
  foundationalSystemPrompt:
    "You are a creative story writer. Craft compelling narratives with strong structure. " +
    "Use vivid descriptions and maintain consistent tone. " +
    "Develop characters through their actions and choices. " +
    "End scenes at meaningful moments.",
  requiredInputs: {
    userInput: { required: true, order: 1 },
    instruction: { required: false, order: 2 },
    context: { required: false, order: 3 },
    data: { required: false, order: 4, jsonRenderer: true },
  },
  inputOrder: {
    userInput: 1,
    instruction: 2,
    context: 3,
    data: 4,
  },
  defaultModelConfig: {
    temperature: 0.9,
    maxTokens: 4096,
    responseFormat: "text",
  },
  lockedFields: ["responseFormat"],
  declaredToolPermissions: [],
};

const RP_MEMORY_CURATOR_PROFILE: SpecializedAgentProfile = {
  profileId: "rp-memory-curator",
  label: { zh: "RP 记忆策展人", en: "RP Memory Curator" },
  description: {
    zh: "从一轮 RP 对话中提取值得长期保存的关键事件、关系变化和状态变更。",
    en: "Extracts key events, relationship changes, and state changes from an RP turn worth preserving in long-term memory.",
  },
  foundationalSystemPrompt: [
    "You are an RP memory curator. Your job is to extract structured memory candidates from a completed RP turn.",
    "",
    "## What to capture",
    "- Events where characters gain, lose, or transfer important items",
    "- Relationship changes (trust broken, alliance formed, betrayal)",
    "- Secrets discovered or identities revealed",
    "- Commitments, promises, or decisions made",
    "- Scene state changes with lasting consequences",
    "- New goals, conflicts, or unresolved threads",
    "",
    "## What NOT to capture",
    "- Casual greetings or small talk",
    "- Atmospheric descriptions or weather (unless plot-critical)",
    "- Literary style or word choices",
    "- Routine actions without consequence",
    "- Transient emotions without lasting impact",
    "- Static world facts already in the worldbook",
    "- Unconfirmed speculation or guesses",
    "- The full writer output verbatim",
    "",
    "## Output format",
    "Output a JSON array of memory candidates. Each candidate must have:",
    "- kind: one of event, relationship-change, state-change, commitment, discovery, unresolved-thread",
    "- summary: one concise sentence describing what happened (max 200 chars)",
    "- entityIds: array of entity IDs involved (must be non-empty)",
    "- tags: optional array of tags",
    "- importance: number 0.0-1.0 (how critical this is for future rounds)",
    "- confidence: number 0.0-1.0 (how certain you are this should be saved)",
    "- evidence: optional short supporting quote (max 150 chars)",
    "",
    "Output ONLY the JSON array. No explanation, no markdown wrapping.",
  ].join("\n"),
  requiredInputs: {
    userInput: { required: true, order: 5 },
    instruction: { required: false, order: 1 },
    context: { required: true, order: 2 },
    data: { required: false, order: 3, jsonRenderer: false },
  },
  inputOrder: {
    instruction: 1,
    context: 2,
    data: 3,
    userInput: 5,
  },
  defaultModelConfig: {
    temperature: 0.3,
    maxTokens: 1024,
    responseFormat: "text",
  },
  lockedFields: [],
  declaredToolPermissions: [],
};

const RP_CRITIC_PROFILE: SpecializedAgentProfile = {
  profileId: "rp-critic",
  label: { zh: "RP 审查人", en: "RP Critic" },
  description: {
    zh: "审查 RP Writer 生成的正文，检查世界一致性、角色一致性、玩家代理权和格式合规。",
    en: "Reviews RP Writer output for world consistency, character consistency, player agency, and format compliance.",
  },
  foundationalSystemPrompt: [
    "You are an RP quality critic. Review the writer's draft against the provided context.",
    "",
    "## Review Checklist",
    "1. World consistency — does the draft contradict established world facts or retrieved worldbook?",
    "2. Character consistency — do characters act, speak, and react according to their established traits and relationships?",
    "3. Player agency — does the draft make key decisions for the player or control the player character?",
    "4. Knowledge boundary — does the draft reveal information a character should not know?",
    "5. Input completeness — does the draft address the player's current input?",
    "6. Style & format — does the draft follow the preset's style, tense, and format?",
    "7. Quality — is the draft repetitive, mechanical, or empty filler?",
    "8. Purity — does the draft contain meta-analysis, explanations, or non-narrative content?",
    "",
    "## Output Format",
    "Output ONLY a JSON object matching this schema:",
    "{",
    '  "decision": "accept" | "revise",',
    '  "scores": {',
    '    "continuity": 0.0-1.0,',
    '    "characterConsistency": 0.0-1.0,',
    '    "playerAgency": 0.0-1.0,',
    '    "knowledgeBoundary": 0.0-1.0,',
    '    "styleAndFormat": 0.0-1.0',
    "  },",
    '  "issues": [',
    "    {",
    '      "code": "continuity|character-inconsistency|player-agency|knowledge-leak|worldbook-conflict|format|style|repetition|other",',
    '      "severity": "warning|error",',
    '      "message": "concise description",',
    '      "evidence": "short quote (optional)",',
    '      "suggestion": "specific fix suggestion"',
    "    }",
    "  ],",
    '  "revisionInstruction": "if decision is revise, provide specific guidance for the writer"',
    "}",
    "",
    "If decision is accept, omit revisionInstruction.",
    "Output ONLY the JSON. No markdown, no explanation.",
  ].join("\n"),
  requiredInputs: {
    userInput: { required: false, order: 3 },
    instruction: { required: false, order: 1 },
    context: { required: true, order: 2 },
    data: { required: false, order: 4, jsonRenderer: false },
  },
  inputOrder: {
    instruction: 1,
    context: 2,
    userInput: 3,
    data: 4,
  },
  defaultModelConfig: {
    temperature: 0.2,
    maxTokens: 1024,
    responseFormat: "json_object",
  },
  lockedFields: ["responseFormat"],
  declaredToolPermissions: [],
};

// ============ Factory ============

/**
 * Create a profile registry pre-populated with P-1 built-in mock profiles.
 */
export function createP1ProfileRegistry(): InMemorySpecializedAgentProfileRegistry {
  const registry = new InMemorySpecializedAgentProfileRegistry();
  registry.register(RP_WRITER_PROFILE);
  registry.register(STORY_WRITER_PROFILE);
  registry.register(RP_MEMORY_CURATOR_PROFILE);
  registry.register(RP_CRITIC_PROFILE);
  return registry;
}
