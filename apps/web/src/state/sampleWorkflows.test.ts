import { validateWorkflow } from "@awp/workflow-core";
import { describe, expect, test } from "vitest";
import { parallelWorkflow, roleplayWorkflow } from "./sampleWorkflows";

describe("sample workflows", () => {
  test("keeps the default parallel workflow valid", () => {
    expect(validateWorkflow(parallelWorkflow)).toEqual([]);
  });

  test("keeps the RP worldbook and memory workflow valid", () => {
    expect(validateWorkflow(roleplayWorkflow)).toEqual([]);
  });
});
