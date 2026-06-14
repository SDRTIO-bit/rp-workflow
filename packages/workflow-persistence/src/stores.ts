/**
 * Workflow Checkpoint & Artifact Store Implementations
 *
 * InMemory: for testing and single-process use.
 * File: atomic writes, cross-restart persistence.
 */

import { readFile, writeFile, unlink, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  WorkflowCheckpointV1,
  WorkflowCheckpointSummaryV1,
  WorkflowCheckpointStore,
  WorkflowArtifactV1,
  WorkflowArtifactSummaryV1,
  WorkflowArtifactStore,
} from "./types.js";

// ============ InMemory Checkpoint Store ============

export class InMemoryWorkflowCheckpointStore implements WorkflowCheckpointStore {
  private checkpoints = new Map<string, WorkflowCheckpointV1>();

  async save(cp: WorkflowCheckpointV1): Promise<void> {
    const existing = this.checkpoints.get(cp.runId);
    if (existing && existing.status === "completed") {
      // Don't overwrite completed checkpoints
      return;
    }
    this.checkpoints.set(cp.runId, { ...cp, updatedAt: new Date().toISOString() });
  }

  async load(runId: string): Promise<WorkflowCheckpointV1 | null> {
    return this.checkpoints.get(runId) ?? null;
  }

  async delete(runId: string): Promise<void> {
    this.checkpoints.delete(runId);
  }

  async list(workflowId?: string): Promise<WorkflowCheckpointSummaryV1[]> {
    const result: WorkflowCheckpointSummaryV1[] = [];
    for (const cp of this.checkpoints.values()) {
      if (workflowId && cp.workflowId !== workflowId) continue;
      result.push({
        runId: cp.runId,
        workflowId: cp.workflowId,
        status: cp.status,
        startedAt: cp.startedAt,
        updatedAt: cp.updatedAt,
      });
    }
    return result;
  }
}

// ============ File Checkpoint Store ============

/** Sanitize a runId for use in filenames. */
function safeFilename(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
}

export class FileWorkflowCheckpointStore implements WorkflowCheckpointStore {
  constructor(private baseDir: string) {}

  private filePath(runId: string): string {
    return resolve(this.baseDir, `${safeFilename(runId)}.checkpoint.json`);
  }

  private tmpPath(runId: string): string {
    return resolve(this.baseDir, `${safeFilename(runId)}.checkpoint.tmp`);
  }

  async save(cp: WorkflowCheckpointV1): Promise<void> {
    await this.ensureDir();
    const obj = { ...cp, updatedAt: new Date().toISOString() };
    const json = JSON.stringify(obj, null, 2);
    const tmp = this.tmpPath(cp.runId);
    const dest = this.filePath(cp.runId);

    // Atomic write: write to temp, then rename
    await writeFile(tmp, json, "utf-8");
    await rename(tmp, dest);
  }

  async load(runId: string): Promise<WorkflowCheckpointV1 | null> {
    const path = this.filePath(runId);
    if (!existsSync(path)) return null;

    try {
      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw) as WorkflowCheckpointV1;

      // Validate required fields
      if (parsed.checkpointVersion !== 1) {
        throw new Error(`Unknown checkpoint version: ${parsed.checkpointVersion}`);
      }
      if (!parsed.runId || !parsed.workflowId) {
        throw new Error("Checkpoint missing required fields (runId, workflowId)");
      }

      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Checkpoint file corrupted for runId "${runId}": invalid JSON`);
      }
      throw error;
    }
  }

  async delete(runId: string): Promise<void> {
    const path = this.filePath(runId);
    if (existsSync(path)) {
      await unlink(path);
    }
    // Clean up temp file if present
    const tmp = this.tmpPath(runId);
    if (existsSync(tmp)) {
      await unlink(tmp);
    }
  }

  async list(workflowId?: string): Promise<WorkflowCheckpointSummaryV1[]> {
    await this.ensureDir();
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(this.baseDir);
    const results: WorkflowCheckpointSummaryV1[] = [];

    for (const entry of entries) {
      if (!entry.endsWith(".checkpoint.json")) continue;
      try {
        const raw = await readFile(resolve(this.baseDir, entry), "utf-8");
        const cp = JSON.parse(raw) as WorkflowCheckpointV1;
        if (workflowId && cp.workflowId !== workflowId) continue;
        results.push({
          runId: cp.runId,
          workflowId: cp.workflowId,
          status: cp.status,
          startedAt: cp.startedAt,
          updatedAt: cp.updatedAt,
        });
      } catch {
        // Skip corrupted files
      }
    }

    return results;
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.baseDir)) {
      await mkdir(this.baseDir, { recursive: true });
    }
  }
}

// ============ InMemory Artifact Store ============

export class InMemoryWorkflowArtifactStore implements WorkflowArtifactStore {
  private artifacts = new Map<string, WorkflowArtifactV1>();

  async save(_runId: string, artifact: WorkflowArtifactV1): Promise<void> {
    this.artifacts.set(artifact.artifactId, artifact);
  }

  async load(_runId: string, artifactId: string): Promise<WorkflowArtifactV1 | null> {
    return this.artifacts.get(artifactId) ?? null;
  }

  async list(runId: string): Promise<WorkflowArtifactSummaryV1[]> {
    const result: WorkflowArtifactSummaryV1[] = [];
    for (const a of this.artifacts.values()) {
      if (a.runId !== runId) continue;
      result.push({
        artifactId: a.artifactId,
        runId: a.runId,
        name: a.name,
        contentType: a.contentType,
        createdAt: a.createdAt,
      });
    }
    return result;
  }
}
