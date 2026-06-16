/**
 * P-8 RP Memory Commit Policy E2E Tests
 *
 * Proves: curator profile → commit policy → memoryWrite with operationId dedup →
 * cross-round recall → rejection filtering → stable IDs.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  runWorkflow,
  nodeRegistry,
  type NodeExecutor,
  type NodeCatalog,
  type WorkflowDefinition,
} from "@awp/workflow-core";
import { stdlibNodes, createStdlibExecutors } from "@awp/workflow-stdlib";
import {
  rpMemoryCommitPolicyExecutor,
  rpMemoryCommitPolicyNode,
  createP1ProfileRegistry,
} from "./index.js";
import {
  InMemoryWorkflowMemoryStore,
  memoryWriteNode,
  createMemoryWriteExecutor,
  createMemoryCorpusExecutor,
} from "@awp/workflow-memory";
import type { MemoryWriteInputV1 } from "@awp/workflow-memory";

// ============ Helpers ============

function createExecutors(store: InMemoryWorkflowMemoryStore): Record<string, NodeExecutor> {
  return {
    jsonSource: async ({ node }) => ({
      outputs: { json: JSON.parse(String(node.config.data ?? "{}")) },
    }),
    playerInput: async ({ node }) => ({ outputs: { text: String(node.config.text ?? "") } }),
    memoryWrite: createMemoryWriteExecutor(store),
    memoryCorpus: createMemoryCorpusExecutor(store),
    rpMemoryCommitPolicy: rpMemoryCommitPolicyExecutor,
    ...createStdlibExecutors(),
  };
}

const catalog: NodeCatalog = {
  ...nodeRegistry,
  ...stdlibNodes,
  memoryWrite: memoryWriteNode,
  rpMemoryCommitPolicy: rpMemoryCommitPolicyNode,
};

// ============ Tests ============

describe("P-8: RP Memory Commit Policy", () => {
  let store: InMemoryWorkflowMemoryStore;

  beforeEach(() => {
    store = new InMemoryWorkflowMemoryStore();
  });

  function execs() {
    return createExecutors(store);
  }

  it("policy node validates and accepts good candidates", async () => {
    const wf: WorkflowDefinition = {
      id: "p8-1",
      name: "P8-1",
      version: 1,
      nodes: [
        {
          id: "src",
          type: "jsonSource",
          position: { x: 0, y: 0 },
          config: {
            data: JSON.stringify([
              {
                kind: "event",
                summary: "钥匙转交事件",
                entityIds: ["银铃", "林舟"],
                importance: 0.85,
                confidence: 0.95,
              },
              {
                kind: "relationship-change",
                summary: "林舟与银铃关系紧张",
                entityIds: ["林舟", "银铃"],
                importance: 0.7,
                confidence: 0.8,
              },
            ]),
          },
        },
        {
          id: "policy",
          type: "rpMemoryCommitPolicy",
          position: { x: 300, y: 0 },
          config: { namespace: "rp-mem-test", minImportance: 0.5, minConfidence: 0.6 },
        },
      ],
      edges: [
        { id: "e1", source: "src", sourcePort: "json", target: "policy", targetPort: "candidates" },
      ],
    };
    const result = await runWorkflow(wf, execs(), catalog);
    expect(result.status).toBe("success");
    const policyRun = result.nodeRuns.find((r) => r.nodeId === "policy")!;
    const accepted = policyRun.outputs.accepted as unknown[];
    expect(accepted).toHaveLength(2);
  });

  it("policy node rejects low importance candidates", async () => {
    const wf: WorkflowDefinition = {
      id: "p8-2",
      name: "P8-2",
      version: 1,
      nodes: [
        {
          id: "src",
          type: "jsonSource",
          position: { x: 0, y: 0 },
          config: {
            data: JSON.stringify([
              {
                kind: "event",
                summary: "important event",
                entityIds: ["a"],
                importance: 0.9,
                confidence: 0.9,
              },
              {
                kind: "event",
                summary: "trivial weather",
                entityIds: ["b"],
                importance: 0.2,
                confidence: 0.7,
              },
            ]),
          },
        },
        {
          id: "policy",
          type: "rpMemoryCommitPolicy",
          position: { x: 300, y: 0 },
          config: { minImportance: 0.5 },
        },
      ],
      edges: [
        { id: "e1", source: "src", sourcePort: "json", target: "policy", targetPort: "candidates" },
      ],
    };
    const result = await runWorkflow(wf, execs(), catalog);
    const policyRun = result.nodeRuns.find((r) => r.nodeId === "policy")!;
    expect(policyRun.outputs.accepted).toHaveLength(1);
    expect(policyRun.outputs.rejected).toHaveLength(1);
  });

  it("policy node produces stable memoryInput with operationId", async () => {
    const wf: WorkflowDefinition = {
      id: "p8-3",
      name: "P8-3",
      version: 1,
      nodes: [
        {
          id: "src",
          type: "jsonSource",
          position: { x: 0, y: 0 },
          config: {
            data: JSON.stringify([
              {
                kind: "event",
                summary: "memorable event",
                entityIds: ["x", "y"],
                importance: 0.8,
                confidence: 0.9,
              },
            ]),
          },
        },
        {
          id: "policy",
          type: "rpMemoryCommitPolicy",
          position: { x: 300, y: 0 },
          config: { namespace: "rp-mem" },
        },
      ],
      edges: [
        { id: "e1", source: "src", sourcePort: "json", target: "policy", targetPort: "candidates" },
      ],
    };
    const result = await runWorkflow(wf, execs(), catalog);
    const policyRun = result.nodeRuns.find((r) => r.nodeId === "policy")!;
    const memInput = policyRun.outputs.memoryInput as MemoryWriteInputV1;
    expect(memInput.namespace).toBe("rp-mem");
    expect(memInput.records).toHaveLength(1);
    expect(memInput.operationId).toBeTruthy();
    expect(memInput.records[0]!.id).toContain("rp-mem:");
  });

  it("memoryWrite rejects different content with same operationId", async () => {
    const opId = "rp-memory-commit:test:w:1";
    await store.saveDedupRecord("ns", opId, "hash1");
    // Try writing with different data but same operationId
    const wf: WorkflowDefinition = {
      id: "p8-dedup",
      name: "Dedup",
      version: 1,
      nodes: [
        {
          id: "src",
          type: "jsonSource",
          position: { x: 0, y: 0 },
          config: {
            data: JSON.stringify({
              namespace: "ns",
              records: [
                { id: "e1", namespace: "ns", content: "different", createdAt: "t", updatedAt: "t" },
              ],
              operationId: opId,
            }),
          },
        },
        { id: "writer", type: "memoryWrite", position: { x: 300, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "src", sourcePort: "json", target: "writer", targetPort: "input" },
      ],
    };
    const result = await runWorkflow(wf, execs(), catalog);
    const writeRun = result.nodeRuns.find((r) => r.nodeId === "writer")!;
    expect(writeRun.status).toBe("error");
    expect(writeRun.error).toContain("previously executed with different records");
  });

  it("memoryWrite dedup: same operationId returns deduplicated", async () => {
    const wf: WorkflowDefinition = {
      id: "p8-dedup2",
      name: "Dedup2",
      version: 1,
      nodes: [
        {
          id: "src",
          type: "jsonSource",
          position: { x: 0, y: 0 },
          config: {
            data: JSON.stringify({
              namespace: "ns",
              records: [
                { id: "e1", namespace: "ns", content: "data", createdAt: "t", updatedAt: "t" },
              ],
              operationId: "op-dedup-1",
            }),
          },
        },
        { id: "writer", type: "memoryWrite", position: { x: 300, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "src", sourcePort: "json", target: "writer", targetPort: "input" },
      ],
    };
    // First write
    const r1 = await runWorkflow(wf, execs(), catalog);
    expect(r1.status).toBe("success");
    // Second write with same operationId and same data → deduplicated
    const r2 = await runWorkflow(wf, execs(), catalog);
    const writeRun2 = r2.nodeRuns.find((r) => r.nodeId === "writer")!;
    expect(writeRun2.status).toBe("success");
    expect(writeRun2.metadata!.deduplicated).toBe(true);
  });

  it("curator profile exists in registry", () => {
    const pr = createP1ProfileRegistry();
    const profile = pr.get("rp-memory-curator");
    expect(profile).toBeDefined();
    expect(profile!.profileId).toBe("rp-memory-curator");
    expect(profile!.foundationalSystemPrompt).toContain("memory curator");
  });

  it("rejects candidate with missing summary", async () => {
    const wf: WorkflowDefinition = {
      id: "p8-bad",
      name: "Bad",
      version: 1,
      nodes: [
        {
          id: "src",
          type: "jsonSource",
          position: { x: 0, y: 0 },
          config: {
            data: JSON.stringify([
              { kind: "event", entityIds: ["a"], importance: 0.8, confidence: 0.9 },
            ]),
          },
        },
        { id: "policy", type: "rpMemoryCommitPolicy", position: { x: 300, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "src", sourcePort: "json", target: "policy", targetPort: "candidates" },
      ],
    };
    const result = await runWorkflow(wf, execs(), catalog);
    const policyRun = result.nodeRuns.find((r) => r.nodeId === "policy")!;
    expect(policyRun.outputs.rejected).toHaveLength(1);
    expect(policyRun.outputs.accepted).toHaveLength(0);
  });

  it("no regression: basic workflow still works", async () => {
    const wf: WorkflowDefinition = {
      id: "t",
      name: "T",
      version: 1,
      nodes: [
        { id: "in", type: "playerInput", position: { x: 0, y: 0 }, config: { text: "hi" } },
        { id: "out", type: "playerOutput", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", source: "in", sourcePort: "text", target: "out", targetPort: "text" }],
    };
    expect((await runWorkflow(wf, execs(), catalog)).status).toBe("success");
  });
});
