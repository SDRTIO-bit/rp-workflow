/**
 * Workflow Persistence & Checkpoint 鈥?Tests
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  InMemoryWorkflowCheckpointStore,
  FileWorkflowCheckpointStore,
  InMemoryWorkflowArtifactStore,
} from "./stores.js";
import {
  runWorkflowWithCheckpoint,
  resumeWorkflow,
  computeWorkflowHash,
  nodeRegistry,
} from "@awp/workflow-core";
import type { NodeCatalog, WorkflowDefinition } from "@awp/workflow-core";
import type { WorkflowCheckpointV1, WorkflowArtifactV1 } from "./types.js";

// ============ Helpers ============

function makeCheckpoint(overrides?: Partial<WorkflowCheckpointV1>): WorkflowCheckpointV1 {
  return {
    checkpointVersion: 1,
    runId: "run-test-1",
    workflowId: "wf-test",
    workflowVersion: 1,
    workflowHash: "wf_abc123",
    status: "running",
    completedNodeIds: [],
    pendingNodeIds: [],
    nodeStates: {},
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWorkflow(): WorkflowDefinition {
  return {
    id: "wf-test",
    name: "Test Workflow",
    version: 1,
    nodes: [
      { id: "step1", type: "testStep", position: { x: 0, y: 0 }, config: { value: "a" } },
      { id: "step2", type: "testStep", position: { x: 200, y: 0 }, config: { value: "b" } },
      { id: "out", type: "textOutput", position: { x: 400, y: 0 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "step1", sourcePort: "result", target: "step2", targetPort: "input" },
      { id: "e2", source: "step2", sourcePort: "result", target: "out", targetPort: "text" },
    ],
  };
}

// ============ InMemory Store Tests ============

describe("InMemoryWorkflowCheckpointStore", () => {
  let store: InMemoryWorkflowCheckpointStore;

  beforeEach(() => {
    store = new InMemoryWorkflowCheckpointStore();
  });

  it("save and load checkpoint", async () => {
    const cp = makeCheckpoint();
    await store.save(cp);
    const loaded = await store.load("run-test-1");
    expect(loaded).toBeDefined();
    expect(loaded!.runId).toBe("run-test-1");
  });

  it("load returns null for unknown runId", async () => {
    expect(await store.load("nonexistent")).toBeNull();
  });

  it("delete removes checkpoint", async () => {
    await store.save(makeCheckpoint());
    await store.delete("run-test-1");
    expect(await store.load("run-test-1")).toBeNull();
  });

  it("list filters by workflowId", async () => {
    await store.save(makeCheckpoint({ runId: "r1", workflowId: "wf-a" }));
    await store.save(makeCheckpoint({ runId: "r2", workflowId: "wf-b" }));
    const list = await store.list("wf-a");
    expect(list.length).toBe(1);
    expect(list[0]!.runId).toBe("r1");
  });
});

// ============ File Store Tests ============

describe("FileWorkflowCheckpointStore", () => {
  let dir: string;
  let store: FileWorkflowCheckpointStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "wf-checkpoint-test-"));
    store = new FileWorkflowCheckpointStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("save and load survives re-instantiation", async () => {
    await store.save(makeCheckpoint({ runId: "persist-1" }));

    // New store instance (simulates restart)
    const store2 = new FileWorkflowCheckpointStore(dir);
    const loaded = await store2.load("persist-1");
    expect(loaded).toBeDefined();
    expect(loaded!.runId).toBe("persist-1");
  });

  it("corrupted file returns clear error", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "bad.checkpoint.json"), "not valid json{", "utf-8");
    await store.save(makeCheckpoint({ runId: "bad" })); // overwrites the bad file for this id
    // Test a different corrupt file
    await writeFile(join(dir, "corrupt.checkpoint.json"), "{broken", "utf-8");
    // Actually, filenames are based on runId. Let's create a proper corrupt file
    await store.save(makeCheckpoint({ runId: "corrupt" }));
    // Overwrite with garbage
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    const corruptFile = files.find((f) => f.includes("corrupt"));
    if (corruptFile) {
      await writeFile(join(dir, corruptFile), "{broken", "utf-8");
      await expect(store.load("corrupt")).rejects.toThrow(/corrupted|invalid/i);
    }
  });

  it("two runIds are isolated", async () => {
    await store.save(makeCheckpoint({ runId: "r1" }));
    await store.save(makeCheckpoint({ runId: "r2" }));
    expect((await store.load("r1"))!.runId).toBe("r1");
    expect((await store.load("r2"))!.runId).toBe("r2");
    await store.delete("r1");
    expect(await store.load("r1")).toBeNull();
    expect(await store.load("r2")).toBeDefined();
  });

  it("checkpoint does not contain secret-like keys", async () => {
    const cp = makeCheckpoint({
      nodeStates: {
        step1: {
          status: "success",
          outputs: { result: "ok" },
        },
      },
    });
    await store.save(cp);
    const loaded = await store.load("run-test-1");
    const json = JSON.stringify(loaded);
    expect(json).not.toContain("apiKey");
    expect(json).not.toContain("Authorization");
    expect(json).not.toContain("Bearer");
    expect(json).not.toContain("sk-");
  });
});

// ============ Artifact Store Tests ============

describe("InMemoryWorkflowArtifactStore", () => {
  let store: InMemoryWorkflowArtifactStore;

  beforeEach(() => {
    store = new InMemoryWorkflowArtifactStore();
  });

  it("save and load artifact", async () => {
    const a: WorkflowArtifactV1 = {
      artifactId: "art-1",
      runId: "r1",
      name: "output.txt",
      contentType: "text/plain",
      data: "hello",
      createdAt: new Date().toISOString(),
    };
    await store.save("r1", a);
    const loaded = await store.load("r1", "art-1");
    expect(loaded).toBeDefined();
    expect(loaded!.data).toBe("hello");
  });

  it("lists artifacts by runId", async () => {
    await store.save("r1", {
      artifactId: "a1",
      runId: "r1",
      name: "x",
      contentType: "text",
      data: "",
      createdAt: "",
    });
    await store.save("r2", {
      artifactId: "a2",
      runId: "r2",
      name: "y",
      contentType: "text",
      data: "",
      createdAt: "",
    });
    expect((await store.list("r1")).length).toBe(1);
  });
});

// ============ Workflow Hash ============

describe("computeWorkflowHash", () => {
  it("same workflow produces same hash", () => {
    const wf = makeWorkflow();
    expect(computeWorkflowHash(wf)).toBe(computeWorkflowHash(wf));
  });

  it("different workflow produces different hash", () => {
    const wf1 = makeWorkflow();
    const wf2 = makeWorkflow();
    wf2.nodes.push({ id: "extra", type: "testStep", position: { x: 0, y: 0 }, config: {} });
    expect(computeWorkflowHash(wf1)).not.toBe(computeWorkflowHash(wf2));
  });
});

// ============ Resume Workflow E2E ============

describe("runWorkflowWithCheckpoint and resumeWorkflow", () => {
  it("resume skips completed nodes", async () => {
    const workflow = makeWorkflow();
    const catalog: NodeCatalog = {
      ...nodeRegistry,
      testStep: {
        type: "testStep",
        label: "TS",
        category: "core",
        ports: [
          { id: "input", label: "In", dataType: "text", direction: "input", required: false },
          { id: "result", label: "Out", dataType: "text", direction: "output" },
        ],
      },
    };

    let _step1Calls = 0;
    let _step2Calls = 0;
    const executors = {
      testStep: async ({ node }: { node: { config: Record<string, unknown>; id: string } }) => {
        if (node.id === "step1") _step1Calls++;
        if (node.id === "step2") _step2Calls++;
        return { outputs: { result: String(node.config.value) } };
      },
      textOutput: async (p: { inputs: Record<string, unknown> }) => ({
        outputs: { final: String(p.inputs.text ?? "") },
      }),
    };

    const completedNodes: string[] = [];
    const nodeOutputs: Record<string, Record<string, unknown>> = {};

    // First run: complete step1, then simulate interruption (don't run step2)
    const _r1 = await runWorkflowWithCheckpoint(
      workflow,
      executors,
      catalog,
      undefined,
      {
        onNodeCompleted: async (_runId, nodeId, outputs) => {
          completedNodes.push(nodeId);
          nodeOutputs[nodeId] = outputs;
          // Simulate: don't save checkpoint for step2 (interruption)
          if (nodeId === "step1") {
            // checkpoint saved for step1 only
          }
        },
      },
      "run-resume-1",
    );

    // In this test setup, runWorkflowWithCheckpoint runs ALL nodes.
    // A real interruption would require external process kill.
    // Instead, we test the resume mechanism:
    // Manually build a checkpoint with only step1 completed.
    const _hash = computeWorkflowHash(workflow);
    const checkpoint = {
      runId: "run-resume-1",
      workflowId: workflow.id,
      workflowHash: _hash,
      completedNodeIds: ["step1"],
      skippedNodeIds: [],
      nodeOutputs: { step1: { result: "a" } },
    };

    // Resume: should skip step1, execute step2
    const r2 = await resumeWorkflow(workflow, executors, checkpoint, catalog);
    if (r2.status !== "success")
      console.log("Resume validation:", JSON.stringify(r2.validationIssues));
    expect(r2.status).toBe("success");

    // step2 should have executed (received step1's restored output)
    const step2Run = r2.nodeRuns.find((n) => n.nodeId === "step2");
    expect(step2Run).toBeDefined();
    expect(step2Run!.status).toBe("success");

    // step1 should be marked as resumed
    const step1Run = r2.nodeRuns.find((n) => n.nodeId === "step1");
    expect(step1Run).toBeDefined();
    expect((step1Run!.metadata as Record<string, unknown>)?.resumed).toBe(true);
  });

  it("rejects resume when workflowHash mismatches", async () => {
    const workflow = makeWorkflow();
    const _hash = computeWorkflowHash(workflow);
    const checkpoint = {
      runId: "run-hash-mismatch",
      workflowId: workflow.id,
      workflowHash: "wf_different_hash",
      completedNodeIds: [],
      skippedNodeIds: [],
      nodeOutputs: {},
    };

    const executors = {
      testStep: async () => ({ outputs: { result: "x" } }),
      textOutput: async () => ({ outputs: { final: "x" } }),
    };

    const result = await resumeWorkflow(workflow, executors, checkpoint, nodeRegistry);
    expect(result.status).toBe("error");
    expect(result.validationIssues[0]!.message).toContain("hash mismatch");
  });
});
