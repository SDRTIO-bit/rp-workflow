import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type { MemoryEvent, TrackerPatch, Chapter } from "../types.js";
import type { RpRuntimeServices } from "../stores/types.js";
import type { ChapterPatch } from "./rpChapterSummaryV1.js";
import { extractScope } from "./utils.js";
import { validateSchema } from "../schemas.js";

/**
 * Result of memory commit operation.
 */
export interface CommitResult {
  success: boolean;
  eventId?: string;
  chapterId?: string;
  trackerVersion?: number;
  errors: string[];
  committedAt: string;
}

/**
 * Services for rpMemoryCommitV1 executor.
 */
export interface RpMemoryCommitServices {
  stores: RpRuntimeServices["stores"];
}

/**
 * NodeDefinition for rpMemoryCommitV1.
 * Pure code node that writes memoryEvent, chapterPatch, and trackerPatch to stores.
 * Does NOT call LLM.
 */
export const rpMemoryCommitV1Definition: NodeDefinition = {
  type: "rpMemoryCommitV1",
  label: "RP Memory Commit",
  category: "roleplay",
  description:
    "Writes memory event, chapter patch, and tracker patch to stores (pure code, no LLM)",
  color: "#9333ea",
  ports: [
    {
      id: "memoryEvent",
      label: "Memory Event",
      dataType: "json",
      direction: "input",
      required: true,
      schemaId: "rp.memory-event.v1",
    },
    {
      id: "chapterPatch",
      label: "Chapter Patch",
      dataType: "json",
      direction: "input",
      required: true,
    },
    {
      id: "trackerPatch",
      label: "Tracker Patch",
      dataType: "json",
      direction: "input",
      required: true,
      schemaId: "rp.tracker-patch.v1",
    },
    {
      id: "commitResult",
      label: "Commit Result",
      dataType: "json",
      direction: "output",
      schemaId: "rp.commit-result.v1",
    },
  ],
};

/**
 * Factory function that creates the executor for rpMemoryCommitV1.
 */
export function createRpMemoryCommitV1Executor(services: RpMemoryCommitServices): NodeExecutor {
  return async (input: NodeExecutionInput) => {
    const scope = extractScope(input.context);
    const { memoryEvent, chapterPatch, trackerPatch } = input.inputs;

    if (!memoryEvent || typeof memoryEvent !== "object") {
      throw new Error("rpMemoryCommitV1: memoryEvent is required");
    }

    if (!chapterPatch || typeof chapterPatch !== "object") {
      throw new Error("rpMemoryCommitV1: chapterPatch is required");
    }

    if (!trackerPatch || typeof trackerPatch !== "object") {
      throw new Error("rpMemoryCommitV1: trackerPatch is required");
    }

    const event = memoryEvent as MemoryEvent;
    const cPatch = chapterPatch as ChapterPatch;
    const tPatch = trackerPatch as TrackerPatch;

    const errors: string[] = [];
    let trackerVersion: number | undefined;

    // Step 1: Write memory event to timeline store
    try {
      await services.stores.timeline.putEvent({
        sessionId: scope.sessionId,
        worldId: scope.worldId,
        event,
      });
    } catch (error) {
      errors.push(
        `Failed to write memory event: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Step 2: Update chapter with new event
    try {
      const existingChapter = await services.stores.chapter.getChapter({
        sessionId: scope.sessionId,
        worldId: scope.worldId,
        chapterId: cPatch.chapterId,
      });

      const now = new Date().toISOString();
      let chapter: Chapter;

      if (existingChapter) {
        // Update existing chapter
        chapter = {
          ...existingChapter,
          events: [...existingChapter.events, cPatch.addEventId],
          summary: cPatch.updateSummary ?? existingChapter.summary,
          updatedAt: now,
        };
      } else {
        // Create new chapter
        chapter = {
          chapterId: cPatch.chapterId,
          sessionId: scope.sessionId,
          worldId: scope.worldId,
          title: `Chapter ${cPatch.chapterId}`,
          summary: cPatch.updateSummary ?? "",
          events: [cPatch.addEventId],
          startedAt: now,
          updatedAt: now,
        };
      }

      await services.stores.chapter.putChapter({
        sessionId: scope.sessionId,
        worldId: scope.worldId,
        chapter,
      });
    } catch (error) {
      errors.push(
        `Failed to update chapter: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Step 3: Apply tracker patch
    try {
      if (tPatch.operations.length > 0) {
        const newState = await services.stores.tracker.applyPatch({
          sessionId: scope.sessionId,
          worldId: scope.worldId,
          patch: tPatch,
        });
        trackerVersion = newState.version;
      }
    } catch (error) {
      errors.push(
        `Failed to apply tracker patch: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const commitResult: CommitResult = {
      success: errors.length === 0,
      eventId: event.eventId,
      chapterId: cPatch.chapterId,
      trackerVersion,
      errors,
      committedAt: new Date().toISOString(),
    };

    validateSchema("rp.commit-result.v1", commitResult);

    return {
      outputs: { commitResult },
    };
  };
}
