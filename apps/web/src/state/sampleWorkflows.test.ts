import { nodeRegistry, validateWorkflow } from "@awp/workflow-core";
import { describe, expect, test } from "vitest";
import {
  registerRpRuntime,
  InMemoryTimelineStore,
  InMemoryChapterStore,
  InMemoryLoreStore,
  InMemoryTrackerStore,
} from "@awp/rp-runtime";
import { parallelWorkflow, roleplayWorkflow } from "./sampleWorkflows";

// Build combined catalog: built-in nodes + RP runtime nodes
const rpRegistration = registerRpRuntime({
  stores: {
    timeline: new InMemoryTimelineStore(),
    chapter: new InMemoryChapterStore(),
    lore: new InMemoryLoreStore(),
    tracker: new InMemoryTrackerStore(),
  },
});
const combinedCatalog = { ...nodeRegistry, ...rpRegistration.catalog };

describe("sample workflows", () => {
  test("keeps the default parallel workflow valid", () => {
    expect(validateWorkflow(parallelWorkflow, combinedCatalog)).toEqual([]);
  });

  test("keeps the RP worldbook and memory workflow valid", () => {
    expect(validateWorkflow(roleplayWorkflow, combinedCatalog)).toEqual([]);
  });
});
