/**
 * Profile Registry Tests — P-1
 */
import { describe, expect, it } from "vitest";
import {
  InMemorySpecializedAgentProfileRegistry,
  createP1ProfileRegistry,
} from "./profileRegistry";

describe("InMemorySpecializedAgentProfileRegistry", () => {
  it("returns undefined for missing profiles", () => {
    const registry = new InMemorySpecializedAgentProfileRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("lists empty when no profiles registered", () => {
    const registry = new InMemorySpecializedAgentProfileRegistry();
    expect(registry.list()).toHaveLength(0);
  });

  it("throws on duplicate profileId", () => {
    const registry = new InMemorySpecializedAgentProfileRegistry();
    registry.register({
      profileId: "test",
      label: { zh: "测试", en: "Test" },
      description: { zh: "测试", en: "Test" },
      foundationalSystemPrompt: "test",
      requiredInputs: {
        userInput: { required: true, order: 1 },
        instruction: { required: false, order: 2 },
        context: { required: false, order: 3 },
        data: { required: false, order: 4 },
      },
      inputOrder: { userInput: 1, instruction: 2, context: 3, data: 4 },
      defaultModelConfig: {},
      lockedFields: [],
      declaredToolPermissions: [],
    });
    expect(() =>
      registry.register({
        profileId: "test",
        label: { zh: "重复", en: "Duplicate" },
        description: { zh: "重复", en: "Duplicate" },
        foundationalSystemPrompt: "dup",
        requiredInputs: {
          userInput: { required: true, order: 1 },
          instruction: { required: false, order: 2 },
          context: { required: false, order: 3 },
          data: { required: false, order: 4 },
        },
        inputOrder: { userInput: 1, instruction: 2, context: 3, data: 4 },
        defaultModelConfig: {},
        lockedFields: [],
        declaredToolPermissions: [],
      }),
    ).toThrow("duplicate profileId");
  });
});

describe("createP1ProfileRegistry", () => {
  it("creates registry with 4 built-in profiles", () => {
    const registry = createP1ProfileRegistry();
    const list = registry.list();
    expect(list).toHaveLength(4);
  });

  it("contains rp-writer profile", () => {
    const registry = createP1ProfileRegistry();
    const profile = registry.get("rp-writer");
    expect(profile).toBeDefined();
    expect(profile!.profileId).toBe("rp-writer");
    expect(profile!.label.en).toBe("RP Writer");
    expect(profile!.foundationalSystemPrompt).toContain("roleplay");
    expect(profile!.lockedFields).toContain("responseFormat");
  });

  it("contains story-writer profile", () => {
    const registry = createP1ProfileRegistry();
    const profile = registry.get("story-writer");
    expect(profile).toBeDefined();
    expect(profile!.profileId).toBe("story-writer");
    expect(profile!.label.en).toBe("Story Writer");
  });

  it("rp-writer has correct input requirements", () => {
    const registry = createP1ProfileRegistry();
    const profile = registry.get("rp-writer")!;
    expect(profile.requiredInputs.userInput.required).toBe(true);
    expect(profile.requiredInputs.instruction.required).toBe(false);
    expect(profile.requiredInputs.data.jsonRenderer).toBe(true);
  });

  it("rp-writer has correct input ordering", () => {
    const registry = createP1ProfileRegistry();
    const profile = registry.get("rp-writer")!;
    expect(profile.inputOrder.instruction).toBe(1);
    expect(profile.inputOrder.context).toBe(4);
  });

  it("profile summaries contain localized labels", () => {
    const registry = createP1ProfileRegistry();
    const list = registry.list();
    for (const summary of list) {
      expect(summary.label.zh).toBeTruthy();
      expect(summary.label.en).toBeTruthy();
    }
  });
});
