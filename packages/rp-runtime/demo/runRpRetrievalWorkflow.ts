/**
 * RP Retrieval Workflow Demo
 *
 * This demo runs the full RP retrieval workflow:
 * userInput -> rpInputParserV1 -> rpTimelineQueryV1 + rpLoreRetrieverV1
 *            -> rpContextAssemblerV1 -> rpWriterV1 -> textOutput
 *
 * Seeds test data into Timeline and Lore stores,
 * then verifies the retrieval pipeline produces a narrative.
 *
 * Usage:
 *   npx tsx demo/runRpRetrievalWorkflow.ts
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
} from "../src/index.js";

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

  // Seed timeline events
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
    },
  });

  // Seed lore entries
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

  // Seed a chapter
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
    },
  });
}

async function main() {
  console.log("=== RP Retrieval Workflow Demo ===\n");

  // 1. Load workflow
  console.log("1. Loading retrieval workflow from JSON...");
  const workflow = await loadWorkflow();
  console.log("   Workflow: " + workflow.name + " (v" + workflow.version + ")");
  console.log("   Nodes: " + workflow.nodes.length);
  console.log("   Edges: " + workflow.edges.length + "\n");

  // 2. Initialize stores and seed test data
  console.log("2. Initializing stores and seeding test data...");
  const stores = {
    timeline: new InMemoryTimelineStore(),
    chapter: new InMemoryChapterStore(),
    lore: new InMemoryLoreStore(),
    tracker: new InMemoryTrackerStore(),
  };

  await seedTimelineData(stores);
  console.log("   Seeded: 2 timeline events, 2 lore entries, 1 chapter\n");

  // 3. Register RP Runtime
  console.log("3. Registering RP Runtime...");
  const services = { stores };
  const rpRegistration = registerRpRuntime(services);
  console.log("   Catalog: " + Object.keys(rpRegistration.catalog).length + " node types");
  console.log("   Executors: " + Object.keys(rpRegistration.executors).length + " executors\n");

  // 4. Build catalog and executors
  console.log("4. Building workflow catalog and executors...");
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
    ...rpRegistration.catalog,
  };

  const executors = {
    userInput: async ({ node }) => ({ outputs: { text: node.config.text ?? "" } }),
    textOutput: async ({ inputs }) => ({ outputs: { final: inputs.text ?? "" } }),
    ...rpRegistration.executors,
  };

  // 5. Validate
  console.log("5. Validating workflow...");
  const issues = validateWorkflow(workflow, catalog);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length > 0) {
    console.error("   FAILED:");
    for (const e of errors) console.error("     - " + e.message);
    process.exit(1);
  }
  console.log("   PASS\n");

  // 6. Prepare context
  console.log("6. Preparing WorkflowRunContext...");
  const context = {
    runId: "retrieval-demo-run",
    values: {
      rp: { sessionId: "demo-session", worldId: "demo-world", turnId: "turn-002" },
    },
  };
  console.log("   sessionId: demo-session");
  console.log("   worldId: demo-world");
  console.log("   turnId: turn-002\n");

  // 7. Run
  console.log("7. Running workflow...\n");
  let result;
  try {
    result = await runWorkflow(workflow, executors, catalog, context);
  } catch (err) {
    console.error("Workflow execution threw:", err);
    process.exit(1);
  }

  // 8. Verify results
  console.log("=== Results ===\n");
  console.log("Status: " + result.status);
  console.log("Batches: " + JSON.stringify(result.batches));
  console.log("Node runs: " + result.nodeRuns.length + "\n");

  let allPassed = true;

  for (const run of result.nodeRuns) {
    console.log("--- " + run.nodeId + " (" + run.status + ") ---");
    if (run.status === "error") {
      console.log("  ERROR: " + run.error);
      allPassed = false;
      continue;
    }

    if (run.nodeId === "parser") {
      const parsed = run.outputs.parsedInput as Record<string, unknown> | undefined;
      if (parsed) {
        console.log("  rawText length: " + (parsed.rawText as string).length);
        console.log("  dialogues: " + (parsed.dialogues as unknown[]).length);
      }
    } else if (run.nodeId === "timeline") {
      const tc = run.outputs.timelineContext as Record<string, unknown> | undefined;
      if (tc) {
        const chapters = tc.chapters as unknown[];
        const events = tc.relevantEvents as unknown[];
        console.log("  chapters: " + chapters.length);
        console.log("  relevantEvents: " + events.length);

        // VERIFY: timeline data was hit
        if (chapters.length === 0) {
          console.log("  ** FAIL: expected timeline chapters to be retrieved");
          allPassed = false;
        } else {
          console.log("  ** Timeline hit confirmed");
        }

        if (events.length === 0) {
          console.log("  ** FAIL: expected timeline events to be retrieved");
          allPassed = false;
        } else {
          console.log("  ** Event retrieval confirmed");
        }
      }
    } else if (run.nodeId === "lore") {
      const lc = run.outputs.loreContext as Record<string, unknown> | undefined;
      if (lc) {
        const entries = lc.entries as unknown[];
        const activatedBy = lc.activatedBy as unknown[];
        console.log("  totalEntries: " + lc.totalEntries);
        console.log("  activatedBy: " + JSON.stringify(activatedBy));

        // VERIFY: lore data was hit
        if (entries.length === 0) {
          console.log("  ** FAIL: expected lore entries to be retrieved");
          allPassed = false;
        } else {
          console.log("  ** Lore hit confirmed");

          // Check always_on entry is present
          const hasAlwaysOn = entries.some(
            (e: unknown) => (e as Record<string, unknown>).id === "lore-alice",
          );
          if (!hasAlwaysOn) {
            console.log("  ** FAIL: expected always_on entry 'lore-alice'");
            allPassed = false;
          } else {
            console.log("  ** always_on entry present");
          }
        }
      }
    } else if (run.nodeId === "assembler") {
      const assembled = run.outputs.assembledContext as Record<string, unknown> | undefined;
      const budget = run.outputs.budgetReport as Record<string, unknown> | undefined;
      if (assembled) {
        console.log("  fullContext length: " + (assembled.fullContext as string).length + " chars");
      }
      if (budget) {
        console.log("  actual tokens: " + (budget.actual as Record<string, unknown>).total);
      }
    } else if (run.nodeId === "writer") {
      const narrative = run.outputs.narrative as string | undefined;
      const wo = run.outputs.writerOutput as Record<string, unknown> | undefined;

      // VERIFY: narrative is a non-empty string
      if (typeof narrative !== "string" || narrative.length === 0) {
        console.log("  ** FAIL: narrative must be a non-empty string, got: " + typeof narrative);
        allPassed = false;
      } else {
        console.log("  narrative type: " + typeof narrative + " (" + narrative.length + " chars)");
        console.log("  narrative preview: " + narrative.slice(0, 80) + "...");
      }

      if (wo) {
        console.log("  generationMode: " + wo.generationMode);
        if (wo.warnings) {
          console.log("  warnings: " + JSON.stringify(wo.warnings));
        }
      }
    } else if (run.nodeId === "output") {
      const final = run.outputs.final;

      // VERIFY: final output is a string
      if (typeof final !== "string" || final.length === 0) {
        console.log("  ** FAIL: final output must be a non-empty string, got: " + typeof final);
        allPassed = false;
      } else {
        console.log("  final type: string (" + final.length + " chars)");
      }
    }
    console.log();
  }

  // 9. Final verdict
  if (result.status === "success" && allPassed) {
    console.log("=== Retrieval E2E: PASS ===");
    process.exit(0);
  } else {
    console.error("=== Retrieval E2E: FAIL ===");
    if (result.status !== "success") {
      console.error("  Reason: workflow status is " + result.status);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Demo failed:", error);
  process.exit(1);
});
