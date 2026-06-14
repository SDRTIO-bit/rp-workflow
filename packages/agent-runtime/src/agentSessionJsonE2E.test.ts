/**
 * Agent Session Memory V1 - Formal Workflow JSON E2E Tests
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { nodeRegistry, runWorkflow } from "@awp/workflow-core";
import type { WorkflowDefinition } from "@awp/workflow-core";
import { InMemoryAgentSessionStore } from "../src/agentSessionStore.js";
import {
  createAgentSessionLoadV1Executor,
  createAgentSessionCommitV1Executor,
} from "../src/agentSessionNode.js";
import { createAgentV2Executor } from "../src/agentV2.js";
import type { LlmAdapter, LlmCompletionInput, LlmCompletionResult } from "../src/types.js";

const T1_IN = "The project codename is BlueWhale.";
const T2_IN = "What is the project codename?";
const T1_OUT = "turn-one-agent-output";
const T2_OUT = "turn-two-agent-output";

async function loadWF(name: string): Promise<WorkflowDefinition> {
  const p = resolve(__dirname, "..", "..", "..", "data", "workflows", name);
  const raw = await readFile(p, "utf-8");
  return (JSON.parse(raw) as { workflow: WorkflowDefinition }).workflow;
}

function mockLlm(text: string) {
  const calls: Array<{ model: string; prompt: string }> = [];
  return {
    adapter: {
      provider: "mock",
      complete: async (i: LlmCompletionInput): Promise<LlmCompletionResult> => {
        calls.push({ model: i.model, prompt: i.prompt });
        return { text, tokenUsage: { input: i.prompt.length, output: text.length } };
      },
    },
    getCalls: () => calls,
  };
}

function port(id: string, dir: "input" | "output", dt: string, req?: boolean, sid?: string) {
  return {
    id,
    label: id,
    dataType: dt as never,
    direction: dir,
    required: req ?? false,
    ...(sid ? { schemaId: sid } : {}),
  };
}

const a2Ports = [
  port("context", "input", "context"),
  port("instruction", "input", "text"),
  port("sessionContext", "input", "json", false, "agent.session-context.v1"),
  port("result", "output", "draft"),
  port("sessionDelta", "output", "json", false, "agent.session-delta.v1"),
];
const slPorts = [
  port("sessionKey", "input", "json", true, "agent.session-key.v1"),
  port("sessionConfig", "input", "json", false, "agent.session-config.v1"),
  port("sessionContext", "output", "json", false, "agent.session-context.v1"),
];
const scPorts = [
  port("sessionDelta", "input", "json", true, "agent.session-delta.v1"),
  port("sessionConfig", "input", "json", false, "agent.session-config.v1"),
  port("commitResult", "output", "json", false, "agent.session-commit-result.v1"),
];

describe("Stateless Workflow JSON E2E", () => {
  it("R2 prompt does NOT contain R1 history", async () => {
    const wf = await loadWF("agent-stateless-v1.json");
    expect(wf.nodes.length).toBe(3);
    const cat = {
      ...nodeRegistry,
      agentV2: { type: "agentV2", label: "A2", category: "core", ports: a2Ports },
    };
    const mkExec = (ad: LlmAdapter) => ({
      resourceSource: async () => ({ outputs: { entries: [] } }),
      userInput: async (x: { node: { config: Record<string, unknown> } }) => ({
        outputs: { text: String(x.node.config.text ?? "") },
      }),
      agentV2: createAgentV2Executor({ adapter: ad }),
      textOutput: async (x: { inputs: Record<string, unknown> }) => ({
        outputs: { final: String(x.inputs.text ?? "") },
      }),
    });
    // R1
    const m1 = mockLlm(T1_OUT);
    wf.nodes = wf.nodes.map((n) =>
      n.id === "input" ? { ...n, config: { ...n.config, text: T1_IN } } : n,
    );
    expect((await runWorkflow(wf, mkExec(m1.adapter), cat, { runId: "sl1" })).status).toBe(
      "success",
    );
    // R2
    const m2 = mockLlm(T2_OUT);
    wf.nodes = wf.nodes.map((n) =>
      n.id === "input" ? { ...n, config: { ...n.config, text: T2_IN } } : n,
    );
    expect((await runWorkflow(wf, mkExec(m2.adapter), cat, { runId: "sl2" })).status).toBe(
      "success",
    );
    const p = m2.getCalls()[0]!.prompt;
    expect(p).not.toContain("BlueWhale");
    expect(p).not.toContain(T1_OUT);
    expect(p).not.toContain("Conversation History");
    expect(p).toContain(T2_IN);
  });
});

describe("Stateful Workflow JSON E2E", () => {
  it("R2 prompt contains R1 history, store has 2 turns", async () => {
    const wf = await loadWF("agent-stateful-v1.json");
    expect(wf.nodes.length).toBe(6);
    const store = new InMemoryAgentSessionStore();
    const cat = {
      ...nodeRegistry,
      sessionKeyProvider: {
        type: "sessionKeyProvider",
        label: "SK",
        category: "core",
        ports: [port("sessionKey", "output", "json", false, "agent.session-key.v1")],
      },
      agentSessionLoadV1: {
        type: "agentSessionLoadV1",
        label: "Ld",
        category: "core",
        ports: slPorts,
      },
      agentV2: { type: "agentV2", label: "A2", category: "core", ports: a2Ports },
      agentSessionCommitV1: {
        type: "agentSessionCommitV1",
        label: "Cm",
        category: "core",
        ports: scPorts,
      },
    };
    const mkExec = (ad: LlmAdapter) => ({
      resourceSource: async () => ({ outputs: { entries: [] } }),
      sessionKeyProvider: async () => ({
        outputs: {
          sessionKey: {
            tenantId: "demo",
            workflowInstanceId: "wf-demo",
            conversationId: "conv-demo",
            agentNodeId: "agent-1",
          },
        },
      }),
      userInput: async (x: { node: { config: Record<string, unknown> } }) => ({
        outputs: { text: String(x.node.config.text ?? "") },
      }),
      agentSessionLoadV1: createAgentSessionLoadV1Executor({ store }),
      agentV2: createAgentV2Executor({ adapter: ad }),
      agentSessionCommitV1: createAgentSessionCommitV1Executor({ store }),
      textOutput: async (x: { inputs: Record<string, unknown> }) => ({
        outputs: { final: String(x.inputs.text ?? "") },
      }),
    });
    // R1
    const m1 = mockLlm(T1_OUT);
    wf.nodes = wf.nodes.map((n) =>
      n.id === "input" ? { ...n, config: { ...n.config, text: T1_IN } } : n,
    );
    const r1 = await runWorkflow(wf, mkExec(m1.adapter), cat, { runId: "sf1" });
    expect(r1.status).toBe("success");
    expect(r1.nodeRuns.find((n) => n.nodeId === "agent")!.outputs.result).toBe(T1_OUT);
    // R2
    const m2 = mockLlm(T2_OUT);
    wf.nodes = wf.nodes.map((n) =>
      n.id === "input" ? { ...n, config: { ...n.config, text: T2_IN } } : n,
    );
    const r2 = await runWorkflow(wf, mkExec(m2.adapter), cat, { runId: "sf2" });
    expect(r2.status).toBe("success");
    const p = m2.getCalls()[0]!.prompt;
    expect(p).toContain("Conversation History");
    expect(p).toContain("BlueWhale");
    expect(p).toContain(T1_OUT);
    expect(p).toContain(T2_IN);
    expect(p).not.toContain(T2_OUT);
    const s = await store.load({
      tenantId: "demo",
      workflowInstanceId: "wf-demo",
      conversationId: "conv-demo",
      agentNodeId: "agent-1",
    });
    expect(s!.turns.length).toBe(2);
    expect(s!.turns[0]!.assistantOutput).toBe(T1_OUT);
    expect(s!.turns[1]!.assistantOutput).toBe(T2_OUT);
  });
});
