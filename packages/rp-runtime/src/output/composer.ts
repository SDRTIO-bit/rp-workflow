/**
 * Output Composer - Phase B-2.6
 *
 * Composes final output from Writer content and runtime-produced slots.
 */

import type { OutputContractV1 } from "../prompt/types.js";

// ============ Writer Content V1 ============

export interface WriterContentV1 {
  /** The narrative text from the Writer */
  narrative: string;
}

// ============ Composed Output V1 ============

export interface ComposedOutputV1 {
  /** Final text output */
  text: string;
  /** Individual slot outputs */
  slotOutputs: Record<string, string>;
}

/**
 * Compose output from Writer content.
 *
 * In narrative_only mode, the final text equals the Writer's narrative.
 * In templated mode, slots are filled in order.
 *
 * @param writerContent - Content from the Writer
 * @param contract - Output contract defining slots
 * @param runtimeSlots - Optional runtime-produced slots (for future use)
 * @returns Composed output
 */
export function composeOutput(
  writerContent: WriterContentV1,
  contract: OutputContractV1,
  runtimeSlots: Record<string, string> = {},
): ComposedOutputV1 {
  const slotOutputs: Record<string, string> = {};

  // Fill writer-produced slots
  for (const slot of contract.slots) {
    if (slot.producer === "writer") {
      slotOutputs[slot.id] = writerContent.narrative;
    } else if (slot.producer === "runtime") {
      const value = runtimeSlots[slot.id];
      if (value !== undefined) {
        slotOutputs[slot.id] = value;
      }
    }
  }

  // Compose final text based on mode
  let text: string;

  if (contract.mode === "narrative_only") {
    // Simple: just the narrative
    text = writerContent.narrative;
  } else {
    // Templated: combine slots in order
    const orderedSlots = [...contract.slots].sort((a, b) => a.order - b.order);
    text = orderedSlots
      .map((slot) => slotOutputs[slot.id] ?? "")
      .filter((t) => t.length > 0)
      .join("\n\n");
  }

  return {
    text,
    slotOutputs,
  };
}
