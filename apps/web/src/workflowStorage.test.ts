import { describe, expect, it } from "vitest";
import { loadWorkflowFromStorage, saveWorkflowToStorage } from "./workflowStorage";
import { parallelWorkflow } from "./state/sampleWorkflows";

const createStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  };
};

describe("workflow storage", () => {
  it("saves and loads a workflow", () => {
    const storage = createStorage();

    saveWorkflowToStorage(parallelWorkflow, storage);

    expect(loadWorkflowFromStorage(storage)).toEqual(parallelWorkflow);
  });

  it("returns undefined for empty or invalid storage", () => {
    expect(loadWorkflowFromStorage(createStorage())).toBeUndefined();

    const storage = createStorage();
    storage.setItem("awp.workflow", "not json");
    expect(loadWorkflowFromStorage(storage)).toBeUndefined();
  });
});
