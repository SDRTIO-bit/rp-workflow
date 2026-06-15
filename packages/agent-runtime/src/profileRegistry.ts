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
    zh: "生成角色扮演叙事文本。维持角色一致性、世界连贯性和玩家行动权。",
    en: "Generates roleplay narrative text. Maintains character consistency, world coherence, and player agency.",
  },
  foundationalSystemPrompt:
    "You are a creative roleplay writing assistant. Continue the story naturally. " +
    "Maintain character consistency and world coherence. " +
    "Do not control the player's character. " +
    "Show emotions through action and dialogue rather than stating them directly. " +
    "Include sensory details to enhance immersion. " +
    "End at a natural break point to invite the player's next action.",
  requiredInputs: {
    userInput: { required: true, order: 1 },
    instruction: { required: false, order: 3 },
    context: { required: false, order: 2 },
    data: { required: false, order: 4, jsonRenderer: true },
  },
  inputOrder: {
    userInput: 1,
    context: 2,
    instruction: 3,
    data: 4,
  },
  defaultModelConfig: {
    temperature: 0.8,
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

// ============ Factory ============

/**
 * Create a profile registry pre-populated with P-1 built-in mock profiles.
 */
export function createP1ProfileRegistry(): InMemorySpecializedAgentProfileRegistry {
  const registry = new InMemorySpecializedAgentProfileRegistry();
  registry.register(RP_WRITER_PROFILE);
  registry.register(STORY_WRITER_PROFILE);
  return registry;
}
