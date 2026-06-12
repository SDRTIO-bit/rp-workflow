import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type { ParsedInput, TrackerState, TrackerPatch, PatchOperation } from "../types.js";
import { extractScope } from "./utils.js";
import { validateSchema } from "../schemas.js";

/**
 * Configuration for rpTrackerUpdateV1 executor.
 */
export interface RpTrackerUpdateConfig {
  /** Enable automatic character detection from parsedInput. Default: true */
  autoDetectCharacters?: boolean;
  /** Enable automatic location detection from parsedInput. Default: true */
  autoDetectLocations?: boolean;
  /** Enable automatic item detection from parsedInput. Default: true */
  autoDetectItems?: boolean;
  /** Enable automatic time state update from parsedInput. Default: true */
  autoDetectTime?: boolean;
}

/**
 * Services for rpTrackerUpdateV1 executor.
 */
export interface RpTrackerUpdateServices {
  config?: RpTrackerUpdateConfig;
}

/**
 * NodeDefinition for rpTrackerUpdateV1.
 * Generates tracker patch based on parsed input and current state.
 * Only outputs patch, not full state.
 */
export const rpTrackerUpdateV1Definition: NodeDefinition = {
  type: "rpTrackerUpdateV1",
  label: "RP Tracker Update",
  category: "roleplay",
  description: "Generates tracker patch based on parsed input and current state",
  color: "#9333ea",
  ports: [
    {
      id: "parsedInput",
      label: "Parsed Input",
      dataType: "json",
      direction: "input",
      required: true,
      schemaId: "rp.parsed-input.v1",
    },
    {
      id: "currentState",
      label: "Current State",
      dataType: "json",
      direction: "input",
      required: true,
      schemaId: "rp.tracker-state.v1",
    },
    {
      id: "trackerPatch",
      label: "Tracker Patch",
      dataType: "json",
      direction: "output",
      schemaId: "rp.tracker-patch.v1",
    },
  ],
};

/**
 * Factory function that creates the executor for rpTrackerUpdateV1.
 */
export function createRpTrackerUpdateV1Executor(services?: RpTrackerUpdateServices): NodeExecutor {
  const autoDetectCharacters = services?.config?.autoDetectCharacters ?? true;
  const autoDetectLocations = services?.config?.autoDetectLocations ?? true;
  const autoDetectItems = services?.config?.autoDetectItems ?? true;
  const autoDetectTime = services?.config?.autoDetectTime ?? true;

  return async (input: NodeExecutionInput) => {
    const scope = extractScope(input.context);
    const { parsedInput, currentState } = input.inputs;

    if (!parsedInput || typeof parsedInput !== "object") {
      throw new Error("rpTrackerUpdateV1: parsedInput is required");
    }

    if (!currentState || typeof currentState !== "object") {
      throw new Error("rpTrackerUpdateV1: currentState is required");
    }

    const parsed = parsedInput as ParsedInput;
    const state = currentState as TrackerState;

    const operations: PatchOperation[] = [];

    // Detect new characters
    if (autoDetectCharacters) {
      for (const charName of parsed.entities.characters) {
        const existingChar = state.characters.find(
          (c) => c.name.toLowerCase() === charName.toLowerCase(),
        );
        if (!existingChar) {
          operations.push({
            type: "add",
            target: "characters",
            targetId: `char-${charName.toLowerCase().replace(/\s+/g, "-")}`,
            value: {
              id: `char-${charName.toLowerCase().replace(/\s+/g, "-")}`,
              name: charName,
              relationships: {},
            },
          });
        }
      }
    }

    // Detect new locations
    if (autoDetectLocations) {
      for (const locName of parsed.entities.locations) {
        const existingLoc = state.locations.find(
          (l) => l.name.toLowerCase() === locName.toLowerCase(),
        );
        if (!existingLoc) {
          operations.push({
            type: "add",
            target: "locations",
            targetId: `loc-${locName.toLowerCase().replace(/\s+/g, "-")}`,
            value: {
              id: `loc-${locName.toLowerCase().replace(/\s+/g, "-")}`,
              name: locName,
            },
          });
        }
      }
    }

    // Detect new items
    if (autoDetectItems) {
      for (const itemName of parsed.entities.items) {
        const existingItem = state.items.find(
          (i) => i.name.toLowerCase() === itemName.toLowerCase(),
        );
        if (!existingItem) {
          operations.push({
            type: "add",
            target: "items",
            targetId: `item-${itemName.toLowerCase().replace(/\s+/g, "-")}`,
            value: {
              id: `item-${itemName.toLowerCase().replace(/\s+/g, "-")}`,
              name: itemName,
            },
          });
        }
      }
    }

    // Update time state
    if (autoDetectTime && parsed.entities.timeHints.length > 0) {
      operations.push({
        type: "update",
        target: "timeState",
        targetId: "timeState",
        field: "currentTime",
        value: parsed.entities.timeHints[0],
      });
    }

    const trackerPatch: TrackerPatch = {
      sessionId: scope.sessionId,
      worldId: scope.worldId,
      sourceTurnId: scope.turnId,
      operations,
      timestamp: new Date().toISOString(),
    };

    validateSchema("rp.tracker-patch.v1", trackerPatch);

    return {
      outputs: { trackerPatch },
    };
  };
}
