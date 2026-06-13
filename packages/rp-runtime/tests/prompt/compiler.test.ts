import { describe, it, expect } from "vitest";
import { compilePrompt } from "../../src/prompt/compiler.js";
import type { PromptDocumentV1, PromptSectionV1 } from "../../src/prompt/types.js";
import type { ResolvedPresetV1 } from "../../src/preset/types.js";

function makeSection(overrides: Partial<PromptSectionV1> = {}): PromptSectionV1 {
  return {
    id: "test-section",
    title: "Test Section",
    source: "user_input",
    content: "Test content",
    priority: 50,
    visibility: "model_visible",
    trust: "user_content",
    ...overrides,
  };
}

function makeDocument(sections: PromptSectionV1[] = []): PromptDocumentV1 {
  return {
    version: "prompt-document-v1",
    target: "writer",
    sections,
  };
}

function makeResolvedPreset(sections: PromptSectionV1[] = []): ResolvedPresetV1 {
  return {
    presetId: "test-preset",
    modelConfig: {},
    promptSections: sections,
    outputContract: {
      version: "output-contract-v1",
      mode: "narrative_only",
      slots: [{ id: "narrative", required: true, order: 10, producer: "writer" }],
      allowExtraText: false,
    },
    diagnostics: {
      appliedDirectiveIds: [],
      conflicts: [],
    },
  };
}

describe("compilePrompt", () => {
  it("compiles document with static and dynamic sections", () => {
    const doc = makeDocument([
      makeSection({
        id: "user-input",
        title: "User Input",
        source: "user_input",
        content: "Alice enters the tavern",
        priority: 50,
        trust: "user_content",
      }),
    ]);

    const preset = makeResolvedPreset([
      makeSection({
        id: "core-rules",
        title: "Core Rules",
        source: "core_rules",
        content: "Do not control the player",
        priority: 100,
        trust: "system",
      }),
    ]);

    const result = compilePrompt(doc, preset);

    expect(result.staticPrefix).toContain("Do not control the player");
    expect(result.dynamicContext).toContain("Alice enters the tavern");
    expect(result.prompt).toContain(result.staticPrefix);
    expect(result.prompt).toContain(result.dynamicContext);
    expect(result.diagnostics.documentVersion).toBe("prompt-document-v1");
    expect(result.diagnostics.presetId).toBe("test-preset");
    expect(result.diagnostics.staticPrefixHash).toBeTruthy();
  });

  it("skips runtime_only sections", () => {
    const doc = makeDocument([
      makeSection({
        id: "runtime-data",
        visibility: "runtime_only",
        content: "Internal state",
      }),
      makeSection({
        id: "visible-data",
        visibility: "model_visible",
        content: "Visible content",
      }),
    ]);

    const result = compilePrompt(doc, makeResolvedPreset());

    expect(result.diagnostics.skippedRuntimeOnlySectionIds).toContain("runtime-data");
    expect(result.dynamicContext).not.toContain("Internal state");
    expect(result.dynamicContext).toContain("Visible content");
  });

  it("renders hidden_constraint sections with disclaimer", () => {
    const doc = makeDocument([
      makeSection({
        id: "secrets",
        title: "Hidden Secrets",
        visibility: "hidden_constraint",
        content: "Character X is actually a spy",
        priority: 80,
      }),
    ]);

    const result = compilePrompt(doc, makeResolvedPreset());

    expect(result.prompt).toContain("[Hidden Constraints]");
    expect(result.prompt).toContain("must NOT be directly revealed");
    expect(result.prompt).toContain("Character X is actually a spy");
  });

  it("five turns produce identical staticPrefixHash", () => {
    const preset = makeResolvedPreset([
      makeSection({
        id: "core-rules",
        source: "core_rules",
        content: "Core rules content",
        trust: "system",
        priority: 100,
      }),
    ]);

    const hashes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const doc = makeDocument([
        makeSection({
          id: `turn-${i}`,
          source: "user_input",
          content: `Turn ${i} user input`,
          trust: "user_content",
          priority: 50,
        }),
      ]);

      const result = compilePrompt(doc, preset);
      hashes.push(result.diagnostics.staticPrefixHash);
    }

    // All hashes should be identical
    expect(new Set(hashes).size).toBe(1);
  });

  it("dynamicContext changes each turn", () => {
    const preset = makeResolvedPreset();
    const contexts: string[] = [];

    for (let i = 0; i < 3; i++) {
      const doc = makeDocument([
        makeSection({
          id: `turn-${i}`,
          source: "user_input",
          content: `Turn ${i} different input`,
          trust: "user_content",
          priority: 50,
        }),
      ]);

      const result = compilePrompt(doc, preset);
      contexts.push(result.dynamicContext);
    }

    // All contexts should be different
    expect(new Set(contexts).size).toBe(3);
  });

  it("includes estimatedTokens in diagnostics", () => {
    const doc = makeDocument([makeSection({ content: "A".repeat(1000), trust: "user_content" })]);

    const result = compilePrompt(doc, makeResolvedPreset());

    expect(result.diagnostics.estimatedTokens).toBeGreaterThan(0);
  });
});
