/**
 * P-12: Official Workflow Registry
 *
 * Maps stable workflow IDs to workflow files.
 * Always use this registry instead of hardcoding file paths.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { WorkflowDefinition } from "@awp/workflow-core";

// ── Registry Entry ──

export type OfficialWorkflowEntry = {
  id: string;
  version: number;
  category: "rp";
  status: "stable" | "legacy";
  workflowFile: string;
  description: string;
};

// ── Registry ──

export class OfficialWorkflowRegistry {
  private entries = new Map<string, OfficialWorkflowEntry>();

  constructor(dataDir: string) {
    this.registerDefaults(dataDir);
  }

  private registerDefaults(dataDir: string): void {
    // Unified stable RP workflow
    this.register({
      id: "official-rp-unified-v1",
      version: 1,
      category: "rp",
      status: "stable",
      workflowFile: resolve(dataDir, "workflows", "rp-unified-stateful-production-v1.json"),
      description:
        "P-11.1 Unified stateful RP production workflow with idempotent session, memory curator, and side-effect safety",
    });

    // Legacy RP workflow (old retrieval-based pipeline)
    this.register({
      id: "official-rp-legacy-v1",
      version: 1,
      category: "rp",
      status: "legacy",
      workflowFile: resolve(dataDir, "workflows", "rp-retrieval-workflow-v1.json"),
      description:
        "Legacy RP retrieval workflow (rpInputParser → rpContextAssembler → rpWriter pipeline)",
    });
  }

  register(entry: OfficialWorkflowEntry): void {
    if (this.entries.has(entry.id)) {
      throw new Error(`OfficialWorkflowRegistry: duplicate ID "${entry.id}"`);
    }
    this.entries.set(entry.id, entry);
  }

  get(id: string): OfficialWorkflowEntry {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error(
        `OfficialWorkflowRegistry: unknown workflow ID "${id}". Known: ${[...this.entries.keys()].join(", ")}`,
      );
    }
    return entry;
  }

  getStableRpDefault(): OfficialWorkflowEntry {
    for (const entry of this.entries.values()) {
      if (entry.category === "rp" && entry.status === "stable") {
        return entry;
      }
    }
    throw new Error("OfficialWorkflowRegistry: no stable RP default workflow registered");
  }

  getLegacyRp(): OfficialWorkflowEntry {
    const entry = this.entries.get("official-rp-legacy-v1");
    if (!entry) {
      throw new Error("OfficialWorkflowRegistry: legacy RP workflow not registered");
    }
    return entry;
  }

  /** Load and validate a workflow from its file */
  loadWorkflow(entry: OfficialWorkflowEntry): WorkflowDefinition {
    if (!existsSync(entry.workflowFile)) {
      throw new Error(`OfficialWorkflowRegistry: workflow file not found: ${entry.workflowFile}`);
    }
    const raw = readFileSync(entry.workflowFile, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`OfficialWorkflowRegistry: invalid JSON in ${entry.workflowFile}`);
    }
    const wf = (parsed as { workflow?: unknown }).workflow;
    if (!wf || typeof wf !== "object") {
      throw new Error(`OfficialWorkflowRegistry: missing "workflow" key in ${entry.workflowFile}`);
    }
    return wf as WorkflowDefinition;
  }

  list(): OfficialWorkflowEntry[] {
    return [...this.entries.values()];
  }
}
