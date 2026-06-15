/**
 * P-12: Official RP Service
 *
 * Single entry point for running an official RP turn.
 *
 * Responsibilities:
 *  - Select workflow (unified-v1 or legacy)
 *  - Load workflow from Registry
 *  - Adapt input → workflow + context
 *  - Run via Branch-aware Runner
 *  - Adapt output → API response
 *
 * DOES NOT:
 *  - Handle HTTP concerns (routes do that)
 *  - Hardcode file paths
 *  - Create test-only executors
 */
import { validateWorkflow, runWorkflowWithBranches } from "@awp/workflow-core";
import type {
  OfficialRpRequestV1,
  OfficialRpResponseV1,
  OfficialRpServiceContext,
} from "./officialRpTypes.js";
import { OfficialWorkflowRegistry } from "./officialWorkflowRegistry.js";
import { adaptRpInput } from "./officialRpInputAdapter.js";
import { adaptRpOutput } from "./officialRpOutputAdapter.js";
import { createRpExecutors } from "./officialRpExecutorFactory.js";

export class OfficialRpService {
  private registry: OfficialWorkflowRegistry;
  private ctx: OfficialRpServiceContext;

  constructor(ctx: OfficialRpServiceContext) {
    this.ctx = ctx;
    this.registry = new OfficialWorkflowRegistry(ctx.dataDir);
  }

  /**
   * Run an official RP turn.
   *
   * @throws on validation failure, missing workflow, or runtime errors
   */
  async runTurn(request: OfficialRpRequestV1): Promise<OfficialRpResponseV1> {
    // 1. Resolve workflow version
    const mode = request.workflowVersion ?? this.ctx.serverWorkflowVersion;
    if (!["unified-v1", "legacy"].includes(mode)) {
      throw new Error(`Unsupported workflow version: "${mode}"`);
    }

    // 2. Legacy fallback
    if (mode === "legacy") {
      return this.runLegacyTurn(request);
    }

    // 3. Unified path
    return this.runUnifiedTurn(request);
  }

  private async runUnifiedTurn(request: OfficialRpRequestV1): Promise<OfficialRpResponseV1> {
    // Load workflow from registry
    const entry = this.registry.getStableRpDefault();
    const workflow = this.registry.loadWorkflow(entry);

    // Validate
    const validationIssues = validateWorkflow(workflow, this.ctx.runtimeNodeCatalog);
    const errors = validationIssues.filter((i) => i.level === "error");
    if (errors.length > 0) {
      throw new Error(`Workflow validation failed: ${errors.map((e) => e.message).join("; ")}`);
    }

    // Adapt input
    const { workflow: adaptedWf, context } = adaptRpInput(request, workflow);

    // Create executors
    const executors = createRpExecutors(this.ctx, request);

    // Run with branch-aware runner
    const result = await runWorkflowWithBranches(
      adaptedWf,
      executors,
      this.ctx.runtimeNodeCatalog,
      context,
    );

    // Adapt output
    return adaptRpOutput(
      result,
      request.sessionId,
      request.turnId,
      entry.id,
      entry.version,
      "unified-v1",
    );
  }

  private async runLegacyTurn(request: OfficialRpRequestV1): Promise<OfficialRpResponseV1> {
    // If a legacy executor is configured, use it
    if (this.ctx.legacyRpExecutor) {
      return this.ctx.legacyRpExecutor(request);
    }

    // Otherwise run the legacy workflow through the branch-aware runner
    const entry = this.registry.getLegacyRp();
    const workflow = this.registry.loadWorkflow(entry);

    // Adapt input (reuse same adapter — sets playerInput text, etc.)
    const { workflow: adaptedWf, context } = adaptRpInput(request, workflow);

    const executors = createRpExecutors(this.ctx, request);

    const result = await runWorkflowWithBranches(
      adaptedWf,
      executors,
      this.ctx.runtimeNodeCatalog,
      context,
    );

    return adaptRpOutput(
      result,
      request.sessionId,
      request.turnId,
      entry.id,
      entry.version,
      "legacy",
    );
  }

  /** Expose registry for testing */
  getRegistry(): OfficialWorkflowRegistry {
    return this.registry;
  }
}
