import { describe, it, expect } from "vitest";
import { validateFormat } from "../../src/output/validator.js";
import type { OutputContractV1 } from "../../src/prompt/types.js";
import type { ComposedOutputV1 } from "../../src/output/composer.js";

const contract: OutputContractV1 = {
  version: "output-contract-v1",
  mode: "narrative_only",
  slots: [{ id: "narrative", required: true, order: 10, producer: "writer" }],
  forbiddenPatterns: ["```json", "<analysis>", "思考过程："],
  allowExtraText: false,
};

describe("validateFormat", () => {
  it("valid output passes", () => {
    const output: ComposedOutputV1 = {
      text: "The tavern door creaks open.",
      slotOutputs: { narrative: "The tavern door creaks open." },
    };

    const result = validateFormat(output, contract);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("missing required slot fails", () => {
    const output: ComposedOutputV1 = {
      text: "Something",
      slotOutputs: {},
    };

    const result = validateFormat(output, contract);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_REQUIRED_SLOT")).toBe(true);
  });

  it("forbidden pattern fails", () => {
    const output: ComposedOutputV1 = {
      text: "Story here\n```json\n{}```",
      slotOutputs: { narrative: "Story here\n```json\n{}```" },
    };

    const result = validateFormat(output, contract);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "FORBIDDEN_PATTERN")).toBe(true);
  });

  it("empty output fails", () => {
    const output: ComposedOutputV1 = {
      text: "",
      slotOutputs: { narrative: "" },
    };

    const result = validateFormat(output, contract);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "EMPTY_WRITER_OUTPUT")).toBe(true);
  });

  it("text mismatch in narrative_only mode fails", () => {
    const output: ComposedOutputV1 = {
      text: "Different text",
      slotOutputs: { narrative: "Original narrative" },
    };

    const result = validateFormat(output, contract);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "UNEXPECTED_EXTRA_TEXT")).toBe(true);
  });
});
