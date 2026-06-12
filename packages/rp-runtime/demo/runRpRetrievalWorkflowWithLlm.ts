/**
 * Manual LLM Smoke Test
 *
 * Runs the RP Retrieval Workflow with a real LLM adapter.
 * Reads API key and model from environment variables (same as server).
 *
 * Usage:
 *   $env:DEEPSEEK_API_KEY="sk-..."  # Set your API key
 *   npx tsx demo/runRpRetrievalWorkflowWithLlm.ts
 *
 * This script is NOT executed by "npm test" and must be run manually.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runWorkflow, validateWorkflow, type WorkflowDefinition } from "@awp/workflow-core";
import {
  registerRpRuntime,
  createRpLlmBridge,
  InMemoryTimelineStore,
  InMemoryChapterStore,
  InMemoryLoreStore,
  InMemoryTrackerStore,
} from "@awp/rp-runtime";
import { createDeepSeekAdapter } from "@awp/agent-runtime";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadWorkflow(): Promise<WorkflowDefinition> {
  const workflowPath = resolve(__dirname, "../../../data/workflows/rp-retrieval-workflow-v1.json");
  const content = await readFile(workflowPath, "utf-8");
  const envelope = JSON.parse(content);
  if (envelope.workflow) return envelope.workflow;
  return envelope;
}

async function seedTimelineData(stores: {
  timeline: InMemoryTimelineStore;
  chapter: InMemoryChapterStore;
  lore: InMemoryLoreStore;
  tracker: InMemoryTrackerStore;
}) {
  const sessionId = "demo-session";
  const worldId = "demo-world";

  await stores.timeline.putEvent({
    sessionId,
    worldId,
    event: {
      eventId: "evt-1",
      sessionId,
      worldId,
      chapterId: "ch1",
      sourceTurnId: "turn-0",
      summary: "Alice entered the Old Harbor Tavern seeking shelter from the storm.",
      characters: ["Alice"],
      locations: ["Old Harbor Tavern"],
      items: ["Sword"],
      time: null,
      emotionalChanges: [],
      createdAt: new Date().toISOString(),
    },
  });

  await stores.timeline.putEvent({
    sessionId,
    worldId,
    event: {
      eventId: "evt-2",
      sessionId,
      worldId,
      chapterId: "ch1",
      sourceTurnId: "turn-1",
      summary: "The bartender mentioned a mysterious stranger asking about Alice.",
      characters: ["Alice", "Bartender"],
      locations: ["Old Harbor Tavern"],
      items: [],
      time: null,
      emotionalChanges: [],
      createdAt: new Date().toISOString(),
    },
  });

  await stores.lore.putEntry({
    sessionId,
    worldId,
    entry: {
      id: "lore-alice",
      sessionId,
      worldId,
      title: "Alice the Swordswoman",
      content:
        "Alice is a seasoned swordswoman from the northern highlands, carrying a silver-etched blade.",
      keywords: ["Alice", "swordswoman", "northern highlands"],
      category: "character",
      priority: 10,
      activationMode: "always_on",
    },
  });

  await stores.lore.putEntry({
    sessionId,
    worldId,
    entry: {
      id: "lore-tavern",
      sessionId,
      worldId,
      title: "Old Harbor Tavern",
      content:
        "The Old Harbor Tavern is a dimly lit establishment near the docks, known for smuggler meetings.",
      keywords: ["tavern", "Old Harbor", "docks"],
      category: "location",
      priority: 5,
      activationMode: "triggered",
    },
  });

  await stores.chapter.putChapter({
    sessionId,
    worldId,
    chapter: {
      chapterId: "ch1",
      sessionId,
      worldId,
      title: "Chapter 1",
      summary: "Alice arrives at the Old Harbor Tavern.",
      events: ["evt-1", "evt-2"],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
}

async function main() {
  console.log("=== RP Retrieval Workflow with Real LLM ===\n");

  // Check environment
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error("ERROR: DEEPSEEK_API_KEY is not set in environment variables.");
    console.error("  Set it with: `$env:DEEPSEEK_API_KEY=''sk-...''`");
    console.error("  This test requires a real API key and will call the LLM provider.");
    process.exit(1);
  }

  // Never print the API key
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
  console.log("1. Configuration:");
  console.log("   Provider: DeepSeek");
  console.log("   Model: " + model);
  console.log("   API Key: [set] (length: " + apiKey.length + ")\n");

  // 2. Load workflow
  console.log("2. Loading retrieval workflow from JSON...");
  const workflow = await loadWorkflow();
  console.log("   Workflow: " + workflow.name + " (v" + workflow.version + ")");
  console.log("   Nodes: " + workflow.nodes.length);
  console.log("   Edges: " + workflow.edges.length + "\n");

  // 3. Initialize stores and seed test data
  console.log("3. Initializing stores and seeding test data...");
  const stores = {
    timeline: new InMemoryTimelineStore(),
    chapter: new InMemoryChapterStore(),
    lore: new InMemoryLoreStore(),
    tracker: new InMemoryTrackerStore(),
  };
  await seedTimelineData(stores);
  console.log("   Seeded: 2 timeline events, 2 lore entries, 1 chapter\n");

  // 4. Create LLM adapter using rpLlmBridge (shared with server)
  console.log("4. Creating LLM adapter via rpLlmBridge...");
  const agentAdapter = createDeepSeekAdapter({ apiKey });
  const llmAdapter = createRpLlmBridge(agentAdapter, model);
  console.log("   Adapter provider: " + llmAdapter.provider);
  console.log("   Adapter kind: " + (llmAdapter.kind ?? "llm") + "\n");

  // 5. Register RP Runtime
  console.log("5. Registering RP Runtime with real LLM adapter...");
  const rp = registerRpRuntime({
    stores,
    llmAdapter,
    writerConfig: {
      enableEchoFallback: false,
      strictMode: true,
    },
  });
  console.log("   Catalog: " + Object.keys(rp.catalog).length + " node types\n");

  // 6. Build catalog and executors
  console.log("6. Building catalog and executors...");
  const catalog = {
    userInput: {
      type: "userInput",
      label: "User Input",
      category: "core",
      ports: [{ id: "text", label: "Text", dataType: "text", direction: "output" }],
    },
    textOutput: {
      type: "textOutput",
      label: "Text Output",
      category: "core",
      ports: [
        { id: "text", label: "Text", dataType: "draft", direction: "input" },
        { id: "final", label: "Final", dataType: "text", direction: "output" },
      ],
    },
    ...rp.catalog,
  };

  const executors = {
    userInput: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
      outputs: { text: node.config.text ?? "" },
    }),
    textOutput: async ({ inputs }: { inputs: Record<string, unknown> }) => ({
      outputs: { final: inputs.text ?? "" },
    }),
    ...rp.executors,
  };

  // 7. Validate
  console.log("7. Validating workflow...");
  const issues = validateWorkflow(workflow, catalog);
  if (issues.some((i) => i.level === "error")) {
    console.error("   FAILED:");
    for (const i of issues.filter((i) => i.level === "error")) {
      console.error("     - " + i.message);
    }
    process.exit(1);
  }
  console.log("   PASS\n");

  // 8. Prepare context
  const context = {
    runId: "real-llm-run",
    values: {
      rp: { sessionId: "demo-session", worldId: "demo-world", turnId: "turn-002" },
    },
  };

  // 9. Run
  console.log("8. Running workflow (calling real LLM)...");
  const startedAt = Date.now();
  let result;
  try {
    result = await runWorkflow(workflow, executors, catalog, context);
  } catch (err) {
    console.error("Workflow execution threw:", err);
    process.exit(1);
  }
  const totalMs = Date.now() - startedAt;

  // 10. Results
  console.log("\n=== Results ===\n");
  console.log("Status: " + result.status);
  console.log("Total time: " + totalMs + "ms\n");

  let allPassed = true;

  for (const run of result.nodeRuns) {
    if (run.status === "error") {
      console.log("--- " + run.nodeId + " (error) ---");
      console.log("  ERROR: " + run.error);
      allPassed = false;
      continue;
    }

    if (run.nodeId === "timeline") {
      const tc = run.outputs.timelineContext as Record<string, unknown> | undefined;
      console.log("Timeline:");
      console.log("  chapters: " + ((tc?.chapters as unknown[] | undefined)?.length ?? 0));
      console.log("  events: " + ((tc?.relevantEvents as unknown[] | undefined)?.length ?? 0));
      const queryMs = tc?.queryTimeMs as number | undefined;
      if (queryMs !== undefined) console.log("  queryTimeMs: " + queryMs);
    } else if (run.nodeId === "lore") {
      const lc = run.outputs.loreContext as Record<string, unknown> | undefined;
      console.log("Lore:");
      console.log("  entries: " + lc?.totalEntries);
      console.log("  activatedBy: " + JSON.stringify(lc?.activatedBy));
    } else if (run.nodeId === "writer") {
      const wo = run.outputs.writerOutput as Record<string, unknown> | undefined;
      const narrative = run.outputs.narrative as string | undefined;
      console.log("Writer:");
      console.log("  generationMode: " + wo?.generationMode);
      if (narrative) {
        console.log("  narrative (" + narrative.length + " chars):");
        console.log("  " + narrative.slice(0, 200) + (narrative.length > 200 ? "..." : ""));
      }
      if (wo?.metadata) {
        const meta = wo.metadata as Record<string, unknown>;
        console.log("  model: " + meta.model);
        console.log("  latencyMs: " + meta.latencyMs);
        const usage = meta.tokenUsage as Record<string, unknown> | undefined;
        if (usage) {
          console.log("  tokenUsage:");
          console.log("    input: " + usage.input);
          console.log("    output: " + usage.output);
          if (usage.cached !== undefined) console.log("    cached: " + usage.cached);
        }
      }
      if (wo?.warnings) {
        console.log("  warnings: " + JSON.stringify(wo.warnings));
      }

      // Verify narrative is real LLM output
      if (wo?.generationMode !== "llm") {
        console.log("  ** FAIL: expected generationMode 'llm'");
        allPassed = false;
      }
      if (!narrative || narrative.includes("[User Input]")) {
        console.log("  ** WARN: narrative may be echo (contains [User Input])");
      }
    }
    console.log();
  }

  // 11. Final verdict
  console.log("=== Final ===");
  if (result.status === "success" && allPassed) {
    console.log("Real LLM Smoke Test: PASS");
    process.exit(0);
  } else {
    console.log("Real LLM Smoke Test: FAIL");
    if (result.status !== "success") {
      const writerRun = result.nodeRuns.find((r) => r.nodeId === "writer");
      if (writerRun?.error) {
        // Sanitize: never print full API error messages that might contain keys
        const errorMsg = writerRun.error;
        if (errorMsg.includes("key") || errorMsg.includes("token") || errorMsg.includes("auth")) {
          console.error("  Writer error: [API error redacted - check network/credentials]");
        } else {
          console.error("  Writer error: " + errorMsg);
        }
      }
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Smoke test failed:", error.message);
  process.exit(1);
});
