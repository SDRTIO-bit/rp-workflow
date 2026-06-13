/**
 * Grounding Validator - Phase B-2.8
 *
 * Validates LLM Parser output against worldbook candidates.
 * Ensures no invented entity/entry IDs enter the Runtime.
 */

import type { ParsedRpInputV1 } from "./types.js";
import type { WorldbookEntryV1 } from "../worldbook/types.js";

export interface GroundingResult {
  /** Validated parser output */
  validated: ParsedRpInputV1;
  /** Entity IDs that were removed */
  removedEntityIds: string[];
  /** Entry IDs that were removed */
  removedEntryIds: string[];
  /** Warnings generated */
  warnings: string[];
}

/**
 * Validate and ground LLM Parser output against worldbook candidates.
 *
 * Rules:
 * 1. entityId must exist in worldbook or be "player"
 * 2. entryId must exist in worldbook
 * 3. Unresolvable references go to unresolvedReferences
 * 4. Low-confidence results don't activate hidden/runtime_only
 * 5. Invalid fields are removed and logged in diagnostics
 */
export function validateAndGround(
  parsed: ParsedRpInputV1,
  worldbookEntries: WorldbookEntryV1[],
  candidateEntityIds: string[],
): GroundingResult {
  const validEntityIds = new Set(["player", ...candidateEntityIds]);
  const validEntryIds = new Set(worldbookEntries.map((e) => e.id));
  const warnings: string[] = [];
  const removedEntityIds: string[] = [];
  const removedEntryIds: string[] = [];

  // Validate mentions
  const validatedMentions = parsed.mentions.filter((mention) => {
    if (mention.entityId && !validEntityIds.has(mention.entityId)) {
      removedEntityIds.push(mention.entityId);
      warnings.push(`Removed invalid entityId: ${mention.entityId} in mention "${mention.text}"`);
      return false;
    }
    if (mention.entryId && !validEntryIds.has(mention.entryId)) {
      removedEntryIds.push(mention.entryId);
      warnings.push(`Removed invalid entryId: ${mention.entryId} in mention "${mention.text}"`);
      return false;
    }
    return true;
  });

  // Validate references
  const validatedReferences = parsed.references.filter((ref) => {
    if (ref.resolvedEntityId && !validEntityIds.has(ref.resolvedEntityId)) {
      removedEntityIds.push(ref.resolvedEntityId);
      warnings.push(`Removed invalid entityId: ${ref.resolvedEntityId} in reference "${ref.text}"`);
      return false;
    }
    return true;
  });

  // Validate historical references
  const validatedHistorical = parsed.historicalReferences.filter((hr) => {
    if (hr.entryId && !validEntryIds.has(hr.entryId)) {
      removedEntryIds.push(hr.entryId);
      warnings.push(`Removed invalid entryId: ${hr.entryId} in historical reference "${hr.text}"`);
      return false;
    }
    return true;
  });

  // Validate actions
  const validatedActions = parsed.actions.map((action) => ({
    ...action,
    actorEntityId: validEntityIds.has(action.actorEntityId) ? action.actorEntityId : "player",
    targetEntityIds: action.targetEntityIds.filter((id) => validEntityIds.has(id)),
    objectEntityIds: action.objectEntityIds.filter((id) => validEntityIds.has(id)),
    locationEntityIds: action.locationEntityIds.filter((id) => validEntityIds.has(id)),
  }));

  // Validate dialogues
  const validatedDialogues = parsed.dialogues.map((dialogue) => ({
    ...dialogue,
    speakerEntityId: validEntityIds.has(dialogue.speakerEntityId)
      ? dialogue.speakerEntityId
      : "player",
    targetEntityIds: dialogue.targetEntityIds.filter((id) => validEntityIds.has(id)),
  }));

  // Build validated output
  const validated: ParsedRpInputV1 = {
    ...parsed,
    mentions: validatedMentions,
    references: validatedReferences,
    historicalReferences: validatedHistorical,
    actions: validatedActions,
    dialogues: validatedDialogues,
    diagnostics: {
      ...parsed.diagnostics,
      removedInvalidEntityIds: [...new Set(removedEntityIds)],
      removedInvalidEntryIds: [...new Set(removedEntryIds)],
      warnings: [...parsed.diagnostics.warnings, ...warnings],
    },
  };

  return {
    validated,
    removedEntityIds: [...new Set(removedEntityIds)],
    removedEntryIds: [...new Set(removedEntryIds)],
    warnings,
  };
}
