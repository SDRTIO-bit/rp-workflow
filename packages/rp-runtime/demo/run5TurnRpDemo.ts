/**
 * 5-Turn RP Demo Script
 *
 * Runs 5 consecutive turns of RP interaction using the retrieval workflow.
 * Uses the same sessionId/worldId across all turns.
 *
 * Usage:
 *   npx tsx packages/rp-runtime/demo/run5TurnRpDemo.ts
 *
 * This script does NOT require a real LLM API key - it uses a fake adapter.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runWorkflow, validateWorkflow, type WorkflowDefinition } from "@awp/workflow-core";
import {
  registerRpRuntime,
  InMemoryTimelineStore,
  InMemoryChapterStore,
  InMemoryLoreStore,
  InMemoryTrackerStore,
  type RecentMessage,
} from "@awp/rp-runtime";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadWorkflow(): Promise<WorkflowDefinition> {
  const workflowPath = resolve(__dirname, "../../../data/workflows/rp-retrieval-workflow-v1.json");
  const content = await readFile(workflowPath, "utf-8");
  const envelope = JSON.parse(content);
  if (envelope.workflow) return envelope.workflow;
  return envelope;
}

function makeFakeLlmAdapter(responses: string[]) {
  let callIndex = 0;
  return {
    provider: "fake-5turn",
    kind: "llm" as const,
    complete: async (_prompt: string) => {
      const text = responses[callIndex % responses.length];
      callIndex++;
      return {
        text,
        tokenUsage: { prompt: 100 + callIndex * 10, completion: 50 + callIndex * 5 },
      };
    },
  };
}

interface TurnResult {
  turnId: string;
  userInput: string;
  narrative: string;
  generationMode: string;
  timelineMatchedCount: number;
  loreMatchedCount: number;
  recentMessagesCount: number;
  estimatedTokens: number;
  truncatedSections: string[];
  droppedSections: string[];
  durationMs: number;
}

async function runTurn(
  workflow: WorkflowDefinition,
  rp: ReturnType<typeof registerRpRuntime>,
  userInput: string,
  turnId: string,
  sessionId: string,
  worldId: string,
  recentMessages: RecentMessage[],
): Promise<TurnResult> {
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

  // Update the workflow's userInput node config
  const workflowWithInput = {
    ...workflow,
    nodes: workflow.nodes.map((n) =>
      n.id === "input" ? { ...n, config: { ...n.config, text: userInput } } : n,
    ),
  };

  // Update recentMessages node config
  const workflowWithMessages = {
    ...workflowWithInput,
    nodes: workflowWithInput.nodes.map((n) =>
      n.id === "recentMessages" ? { ...n, config: { ...n.config, messages: recentMessages } } : n,
    ),
  };

  const context = {
    runId: `turn-${turnId}`,
    values: { rp: { sessionId, worldId, turnId } },
  };

  const startedAt = Date.now();
  const result = await runWorkflow(workflowWithMessages, executors, catalog, context);
  const durationMs = Date.now() - startedAt;

  // Extract metrics
  const writerRun = result.nodeRuns.find((r) => r.nodeId === "writer");
  const timelineRun = result.nodeRuns.find((r) => r.nodeId === "timeline");
  const loreRun = result.nodeRuns.find((r) => r.nodeId === "lore");
  const assemblerRun = result.nodeRuns.find((r) => r.nodeId === "assembler");

  const wo = writerRun?.outputs?.writerOutput as Record<string, unknown> | undefined;
  const tc = timelineRun?.outputs?.timelineContext as Record<string, unknown> | undefined;
  const lc = loreRun?.outputs?.loreContext as Record<string, unknown> | undefined;
  const br = assemblerRun?.outputs?.budgetReport as Record<string, unknown> | undefined;

  return {
    turnId,
    userInput,
    narrative: (writerRun?.outputs?.narrative as string) ?? "",
    generationMode: (wo?.generationMode as string) ?? "unknown",
    timelineMatchedCount: (tc?.relevantEvents as unknown[] | undefined)?.length ?? 0,
    loreMatchedCount: (lc?.entries as unknown[] | undefined)?.length ?? 0,
    recentMessagesCount: recentMessages.length,
    estimatedTokens: ((br?.actual as Record<string, unknown> | undefined)?.total as number) ?? 0,
    truncatedSections: (br?.truncatedSections as string[]) ?? [],
    droppedSections: (br?.droppedSections as string[]) ?? [],
    durationMs,
  };
}

async function main() {
  console.log("=== 5-Turn RP Demo ===\n");

  // Load workflow
  console.log("1. Loading retrieval workflow...");
  const workflow = await loadWorkflow();
  console.log("   Workflow: " + workflow.name + " (v" + workflow.version + ")\n");

  // Initialize stores
  console.log("2. Initializing stores...");
  const stores = {
    timeline: new InMemoryTimelineStore(),
    chapter: new InMemoryChapterStore(),
    lore: new InMemoryLoreStore(),
    tracker: new InMemoryTrackerStore(),
  };

  // Seed test data
  const sessionId = "demo-5turn";
  const worldId = "demo-world";

  await stores.timeline.putEvent({
    sessionId,
    worldId,
    event: {
      eventId: "evt-1",
      sessionId,
      worldId,
      chapterId: "ch1",
      sourceTurnId: "turn-000",
      summary: "Alice entered the Old Harbor Tavern seeking shelter from the storm.",
      characters: ["Alice"],
      locations: ["Old Harbor Tavern"],
      items: ["Sword"],
      time: null,
      emotionalChanges: [],
      createdAt: new Date(Date.now() - 3600000).toISOString(),
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
      keywords: ["Alice", "swordswoman", "northern highlands", "sword"],
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
      keywords: ["tavern", "Old Harbor", "docks", "smuggler"],
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
      title: "Chapter 1: Arrival",
      summary: "Alice arrives at the Old Harbor Tavern.",
      events: ["evt-1"],
      startedAt: new Date(Date.now() - 7200000).toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });

  console.log("   Seeded: 1 timeline event, 2 lore entries, 1 chapter\n");

  // Create fake LLM adapter with varied responses
  const fakeResponses = [
    "The tavern door creaks as Alice pushes it open, her cloak dripping rainwater onto the worn wooden floor. The bartender looks up nervously.",
    "Alice approaches the bar, her hand never straying far from the hilt of her sword. 'A room for the night,' she says, her voice carrying the accent of the northern highlands.",
    "The bartender slides a key across the counter. 'Room's upstairs, last door on the left. And miss... keep that blade out of sight. We had some trouble here last week.'",
    "Alice nods, understanding the warning. She's heard rumors about smugglers using this place. 'I'm just passing through,' she replies, taking the key.",
    "As Alice climbs the stairs, she notices a hooded figure in the corner watching her every move. The sword at her hip seems to hum with anticipation.",
  ];

  const llmAdapter = makeFakeLlmAdapter(fakeResponses);

  // Register RP Runtime
  console.log("3. Registering RP Runtime with fake LLM adapter...");
  const rp = registerRpRuntime({
    stores,
    llmAdapter,
    writerConfig: { enableEchoFallback: false },
  });
  console.log("   Catalog: " + Object.keys(rp.catalog).length + " node types\n");

  // Validate workflow
  console.log("4. Validating workflow...");
  const fullCatalog = {
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
  const issues = validateWorkflow(workflow, fullCatalog);
  if (issues.some((i) => i.level === "error")) {
    console.error("   FAILED:");
    for (const i of issues.filter((i) => i.level === "error")) {
      console.error("     - " + i.message);
    }
    process.exit(1);
  }
  console.log("   PASS\n");

  // Define 5 turns
  const turns = [
    {
      turnId: "turn-001",
      userInput:
        "Alice walks into the dimly lit tavern, her hand resting on the hilt of her sword. The bartender glances up nervously.",
    },
    {
      turnId: "turn-002",
      userInput:
        'Alice approaches the bar. "A room for the night," she says, her voice carrying the accent of the northern highlands.',
    },
    {
      turnId: "turn-003",
      userInput:
        "Alice notices the bartender's warning glance at her sword. She keeps her hand steady on the hilt, ready for anything.",
    },
    {
      turnId: "turn-004",
      userInput:
        "As Alice climbs the stairs to her room, she hears whispers from the corner booth. Someone is watching her.",
    },
    {
      turnId: "turn-005",
      userInput:
        "Alice reaches her room and locks the door. She draws her silver-etched blade, examining the runes that glow faintly in the darkness. Tomorrow she continues her journey north, but tonight she must rest.",
    },
  ];

  // Run 5 turns
  console.log("5. Running 5 turns...\n");
  const results: TurnResult[] = [];
  const recentMessages: RecentMessage[] = [];

  for (const turn of turns) {
    console.log(`--- Turn ${turn.turnId} ---`);
    console.log(`User Input: ${turn.userInput.slice(0, 80)}...`);

    const result = await runTurn(workflow, rp, turn.userInput, turn.turnId, sessionId, worldId, [
      ...recentMessages,
    ]);

    console.log(`  generationMode: ${result.generationMode}`);
    console.log(`  narrative: ${result.narrative.slice(0, 80)}...`);
    console.log(`  timelineMatched: ${result.timelineMatchedCount}`);
    console.log(`  loreMatched: ${result.loreMatchedCount}`);
    console.log(`  recentMessages: ${result.recentMessagesCount}`);
    console.log(`  estimatedTokens: ${result.estimatedTokens}`);
    console.log(`  truncatedSections: ${result.truncatedSections.join(", ") || "none"}`);
    console.log(`  droppedSections: ${result.droppedSections.join(", ") || "none"}`);
    console.log(`  durationMs: ${result.durationMs}`);
    console.log();

    results.push(result);

    // Add to recent messages for next turn
    recentMessages.push({
      messageId: `msg-${turn.turnId}-user`,
      sessionId,
      worldId,
      turnId: turn.turnId,
      role: "user",
      text: turn.userInput,
      timestamp: new Date().toISOString(),
    });
    recentMessages.push({
      messageId: `msg-${turn.turnId}-assistant`,
      sessionId,
      worldId,
      turnId: turn.turnId,
      role: "assistant",
      text: result.narrative,
      timestamp: new Date().toISOString(),
    });
  }

  // Summary
  console.log("\n=== Summary ===\n");
  console.log("Total turns: " + results.length);
  console.log("Total duration: " + results.reduce((sum, r) => sum + r.durationMs, 0) + "ms");
  console.log(
    "Avg duration: " +
      Math.round(results.reduce((sum, r) => sum + r.durationMs, 0) / results.length) +
      "ms",
  );
  console.log("Total tokens: " + results.reduce((sum, r) => sum + r.estimatedTokens, 0));
  console.log(
    "Avg tokens: " +
      Math.round(results.reduce((sum, r) => sum + r.estimatedTokens, 0) / results.length),
  );

  console.log("\nPer-turn breakdown:");
  for (const r of results) {
    console.log(
      `  ${r.turnId}: ${r.generationMode}, ${r.timelineMatchedCount} timeline, ${r.loreMatchedCount} lore, ${r.recentMessagesCount} recent, ${r.estimatedTokens} tokens, ${r.durationMs}ms`,
    );
  }

  console.log("\n=== 5-Turn RP Demo Complete ===");
}

main().catch((error) => {
  console.error("Demo failed:", error);
  process.exit(1);
});
