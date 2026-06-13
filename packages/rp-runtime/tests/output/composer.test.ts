import { describe, it, expect } from "vitest";
import { composeOutput } from "../../src/output/composer.js";
import type { OutputContractV1 } from "../../src/prompt/types.js";
import type { WriterContentV1 } from "../../src/output/composer.js";

const narrativeOnlyContract: OutputContractV1 = {
  version: "output-contract-v1",
  mode: "narrative_only",
  slots: [{ id: "narrative", required: true, order: 10, producer: "writer" }],
  allowExtraText: false,
};

const templatedContract: OutputContractV1 = {
  version: "output-contract-v1",
  mode: "templated",
  slots: [
    { id: "narrative", required: true, order: 10, producer: "writer" },
    { id: "status", required: false, order: 20, producer: "runtime" },
  ],
  allowExtraText: false,
};

describe("composeOutput", () => {
  it("narrative_only mode returns narrative as text", () => {
    const writerContent: WriterContentV1 = {
      narrative: "The tavern door creaks open.",
    };

    const result = composeOutput(writerContent, narrativeOnlyContract);

    expect(result.text).toBe("The tavern door creaks open.");
    expect(result.slotOutputs.narrative).toBe("The tavern door creaks open.");
  });

  it("templated mode combines slots in order", () => {
    const writerContent: WriterContentV1 = {
      narrative: "The tavern door creaks open.",
    };

    const runtimeSlots = { status: "[Health: 100]" };
    const result = composeOutput(writerContent, templatedContract, runtimeSlots);

    expect(result.text).toContain("The tavern door creaks open.");
    expect(result.text).toContain("[Health: 100]");
    expect(result.slotOutputs.narrative).toBe("The tavern door creaks open.");
    expect(result.slotOutputs.status).toBe("[Health: 100]");
  });

  it("handles missing runtime slots gracefully", () => {
    const writerContent: WriterContentV1 = {
      narrative: "Story continues.",
    };

    const result = composeOutput(writerContent, templatedContract, {});

    expect(result.text).toContain("Story continues.");
    expect(result.slotOutputs.status).toBeUndefined();
  });
});
