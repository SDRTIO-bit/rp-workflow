import { describe, it, expect } from "vitest";
import { resolvePreset } from "../../src/preset/resolver.js";
import { DEFAULT_RP_PRESET } from "../../src/preset/defaultPreset.js";
import type { PresetDirectiveV1 } from "../../src/preset/types.js";

describe("resolvePreset", () => {
  it("resolves default preset without directives", () => {
    const resolved = resolvePreset(DEFAULT_RP_PRESET);

    expect(resolved.presetId).toBe("rp-default-v1");
    expect(resolved.promptSections.length).toBeGreaterThan(0);
    expect(resolved.outputContract.mode).toBe("narrative_only");
    expect(resolved.diagnostics.appliedDirectiveIds).toHaveLength(0);
    expect(resolved.diagnostics.conflicts).toHaveLength(0);
  });

  it("appends directive as new section", () => {
    const directive: PresetDirectiveV1 = {
      id: "custom-style",
      target: "style_rules",
      merge: "append",
      fragment: {
        id: "custom-fragment",
        content: "Use purple prose style",
        priority: 70,
      },
    };

    const resolved = resolvePreset(DEFAULT_RP_PRESET, [directive]);

    expect(resolved.diagnostics.appliedDirectiveIds).toContain("custom-style");
    expect(resolved.promptSections.some((s) => s.content === "Use purple prose style")).toBe(true);
  });

  it("override directive with higher priority replaces section", () => {
    // First append a section
    const appendDirective: PresetDirectiveV1 = {
      id: "original",
      target: "style_rules",
      merge: "append",
      fragment: {
        id: "original-fragment",
        content: "Original style",
        priority: 50,
      },
    };

    // Then override it with higher priority
    const overrideDirective: PresetDirectiveV1 = {
      id: "override",
      target: "style_rules",
      merge: "override",
      priority: 60,
      fragment: {
        id: "override-fragment",
        content: "Override style",
        priority: 60,
      },
    };

    const resolved = resolvePreset(DEFAULT_RP_PRESET, [appendDirective, overrideDirective]);

    expect(resolved.diagnostics.appliedDirectiveIds).toContain("override");
    expect(resolved.promptSections.some((s) => s.content === "Override style")).toBe(true);
  });

  it("override directive with lower priority does not replace", () => {
    const directive: PresetDirectiveV1 = {
      id: "weak-override",
      target: "style_rules",
      merge: "override",
      priority: 10, // Lower than core rules priority 100
      fragment: {
        id: "weak-fragment",
        content: "Weak override",
        priority: 10,
      },
    };

    const resolved = resolvePreset(DEFAULT_RP_PRESET, [directive]);

    expect(resolved.diagnostics.conflicts.length).toBeGreaterThan(0);
    expect(resolved.diagnostics.appliedDirectiveIds).not.toContain("weak-override");
  });

  it("preserves model config from preset", () => {
    const resolved = resolvePreset(DEFAULT_RP_PRESET);

    expect(resolved.modelConfig.temperature).toBe(0.8);
    expect(resolved.modelConfig.maxOutputTokens).toBe(2048);
  });
});
