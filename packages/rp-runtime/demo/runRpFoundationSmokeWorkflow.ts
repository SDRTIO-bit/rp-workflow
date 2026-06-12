/**
 * RP Foundation Smoke Workflow Demo
 *
 * This demo runs the minimal RP workflow:
 * userInput → rpInputParserV1 → rpContextAssemblerV1 → rpWriterV1 → textOutput
 *
 * Usage:
 *   npx tsx demo/runRpFoundationSmokeWorkflow.ts
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
  const workflowPath = resolve(
    __dirname,
    "../../../data/workflows/rp-foundation-smoke-workflow-v1.json",
  );
  const content = await readFile(workflowPath, "utf-8");
  const envelope = JSON.parse(content);

  // Handle both wrapped and unwrapped formats
  if (envelope.workflow) {
    return envelope.workflow;
  }
  return envelope;
}

async function main() {
  console.log("=== RP Foundation Smoke Workflow Demo ===\n");

  // 1. Load workflow from JSON
  console.log("1. Loading workflow from JSON...");
  const workflow = await loadWorkflow();
  console.log(`   Workflow: ${workflow.name} (v${workflow.version})`);
  console.log(`   Nodes: ${workflow.nodes.length}`);
  console.log(`   Edges: ${workflow.edges.length}\n`);

  // 2. Initialize RP Runtime services
  console.log("2. Initializing RP Runtime services...");
  const services = {
    stores: {
      timeline: new InMemoryTimelineStore(),
      chapter: new InMemoryChapterStore(),
      lore: new InMemoryLoreStore(),
      tracker: new InMemoryTrackerStore(),
    },
  };
  console.log("   Stores: InMemory (timeline, chapter, lore, tracker)\n");

  // 3. Register RP Runtime
  console.log("3. Registering RP Runtime...");
  const rpRegistration = registerRpRuntime(services);
  console.log(`   Catalog entries: ${Object.keys(rpRegistration.catalog).length}`);
  console.log(`   Executor entries: ${Object.keys(rpRegistration.executors).length}\n`);

  // 4. Build combined catalog and executors for the workflow
  console.log("4. Building workflow catalog and executors...");

  // The smoke workflow uses: userInput, rpInputParserV1, rpContextAssemblerV1, rpWriterV1, textOutput
  // We need to provide executors for all of these

  const catalog = {
    // Built-in nodes used by the workflow
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
    // RP nodes
    ...rpRegistration.catalog,
  };

  const executors = {
    // Built-in executors
    userInput: async ({ node }) => ({
      outputs: { text: node.config.text ?? "" },
    }),
    textOutput: async ({ inputs }) => ({
      outputs: { final: inputs.text ?? "" },
    }),
    // RP executors
    ...rpRegistration.executors,
  };

  console.log(`   Catalog: ${Object.keys(catalog).length} node types`);
  console.log(`   Executors: ${Object.keys(executors).length} executors\n`);

  // 5. Validate workflow
  console.log("5. Validating workflow...");
  const issues = validateWorkflow(workflow, catalog);
  const errors = issues.filter((i) => i.level === "error");

  if (errors.length > 0) {
    console.error("   ❌ Validation failed:");
    for (const error of errors) {
      console.error(`      - ${error.message}`);
    }
    process.exit(1);
  }
  console.log("   ✅ Validation passed\n");

  // 6. Prepare WorkflowRunContext with RP scope
  console.log("6. Preparing WorkflowRunContext...");
  const context = {
    runId: "smoke-demo-run",
    values: {
      rp: {
        sessionId: "demo-session",
        worldId: "demo-world",
        turnId: "turn-001",
      },
    },
  };
  console.log(`   sessionId: ${context.values.rp.sessionId}`);
  console.log(`   worldId: ${context.values.rp.worldId}`);
  console.log(`   turnId: ${context.values.rp.turnId}\n`);

  // 7. Run workflow
  console.log("7. Running workflow...\n");
  const result = await runWorkflow(workflow, executors, catalog, context);

  // 8. Display results
  console.log("=== Workflow Results ===\n");
  console.log(`Status: ${result.status}`);
  console.log(`Batches: ${result.batches.length}`);
  console.log(`Node runs: ${result.nodeRuns.length}\n`);

  for (const run of result.nodeRuns) {
    console.log(`--- ${run.nodeId} (${run.status}) ---`);

    if (run.status === "error") {
      console.log(`   Error: ${run.error}`);
      continue;
    }

    // Display key outputs
    if (run.nodeId === "parser") {
      const parsed = run.outputs.parsedInput as Record<string, unknown> | undefined;
      if (parsed) {
        console.log(`   rawText: ${(parsed.rawText as string).slice(0, 60)}...`);
        console.log(`   dialogues: ${(parsed.dialogues as unknown[]).length}`);
        console.log(`   actions: ${(parsed.actions as unknown[]).length}`);
        console.log(
          `   entities.characters: ${((parsed.entities as Record<string, unknown>).characters as unknown[]).length}`,
        );
        console.log(
          `   entities.locations: ${((parsed.entities as Record<string, unknown>).locations as unknown[]).length}`,
        );
      }
    } else if (run.nodeId === "assembler") {
      const assembled = run.outputs.assembledContext as Record<string, unknown> | undefined;
      const budget = run.outputs.budgetReport as Record<string, unknown> | undefined;
      if (assembled) {
        console.log(`   fullContext length: ${(assembled.fullContext as string).length} chars`);
        console.log(`   systemPrompt: ${(assembled.systemPrompt as string).slice(0, 50)}...`);
      }
      if (budget) {
        console.log(`   targetTokens: ${budget.targetTokens}`);
        console.log(`   hardLimitTokens: ${budget.hardLimitTokens}`);
        console.log(`   actual.total: ${(budget.actual as Record<string, unknown>).total}`);
        console.log(`   truncatedSections: ${(budget.truncatedSections as unknown[]).length}`);
        console.log(`   droppedSections: ${(budget.droppedSections as unknown[]).length}`);
      }
    } else if (run.nodeId === "writer") {
      const output = run.outputs.writerOutput as Record<string, unknown> | undefined;
      const narrative = run.outputs.narrative as string | undefined;
      if (output) {
        console.log(`   generationMode: ${output.generationMode}`);
        console.log(`   writerOutput.text preview: ${(output.text as string).slice(0, 100)}...`);
        if (output.warnings) {
          console.log(`   warnings: ${(output.warnings as string[]).join(", ")}`);
        }
        const metadata = output.metadata as Record<string, unknown> | undefined;
        if (metadata) {
          console.log(`   model: ${metadata.model}`);
          console.log(`   latencyMs: ${metadata.latencyMs}`);
        }
      }
      if (narrative) {
        console.log(`   narrative (draft): ${narrative.slice(0, 100)}...`);
        console.log(`   narrative type: ${typeof narrative}`);
      }
    } else if (run.nodeId === "output") {
      const final = run.outputs.final;
      if (final) {
        const text = typeof final === "string" ? final : JSON.stringify(final);
        console.log(`   final output: ${text.slice(0, 100)}...`);
        console.log(`   final type: ${typeof final}`);
      }
    }
    console.log();
  }

  // 9. Final verdict
  if (result.status === "success") {
    console.log("✅ Smoke test PASSED");
    process.exit(0);
  } else {
    console.error("❌ Smoke test FAILED");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Demo failed:", error);
  process.exit(1);
});
