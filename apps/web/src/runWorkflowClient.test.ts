import { describe, expect, it } from "vitest";
import { runWorkflowStreamViaServer, runWorkflowViaServer } from "./runWorkflowClient";
import { parallelWorkflow } from "./state/sampleWorkflows";

describe("runWorkflowViaServer", () => {
  it("posts the workflow to the local server endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await runWorkflowViaServer(parallelWorkflow, async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ status: "success", nodeRuns: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/run-workflow");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ workflow: parallelWorkflow });
    expect(result).toEqual({ status: "success", nodeRuns: [] });
  });

  it("returns undefined when the local server endpoint is unavailable", async () => {
    const result = await runWorkflowViaServer(parallelWorkflow, async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(result).toBeUndefined();
  });

  it("streams workflow node run events from the local server", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const events: string[] = [];
    const payload = [
      JSON.stringify({ type: "nodeRun", run: { nodeId: "input", status: "success" } }),
      JSON.stringify({
        type: "done",
        result: { workflowId: "parallel_agents", status: "success" },
      }),
    ].join("\n");

    const result = await runWorkflowStreamViaServer(
      parallelWorkflow,
      (event) => {
        events.push(event.type);
      },
      async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(payload, {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
        });
      },
    );

    expect(calls[0]?.url).toBe("/api/run-workflow-stream");
    expect(calls[0]?.init.method).toBe("POST");
    expect(events).toEqual(["nodeRun", "done"]);
    expect(result).toEqual({ workflowId: "parallel_agents", status: "success" });
  });
});
