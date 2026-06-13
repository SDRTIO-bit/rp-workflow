/**
 * ParsedRpInputV1 Runtime Validator - Phase B-2.8
 *
 * Validates the structure of LLM output against ParsedRpInputV1 schema.
 * Lightweight validator without external dependencies.
 */

/**
 * Valid intent types.
 */
const VALID_INTENT_TYPES: Set<string> = new Set([
  "investigate",
  "question",
  "protect",
  "escape",
  "delay",
  "conceal",
  "confront",
  "use_item",
  "move",
  "observe",
  "wait",
]);

/**
 * Valid resolution sources.
 */
const VALID_RESOLUTION_SOURCES: Set<string> = new Set([
  "current_input",
  "recent_messages",
  "scene",
  "unresolved",
]);

/**
 * Validation result.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Check if a value is a plain object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check if a value is a string.
 */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Check if a value is an array.
 */
function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Check if a value is a number.
 */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && !isNaN(value);
}

/**
 * Validate a single mention object.
 */
function validateMention(obj: unknown, errors: string[]): void {
  if (!isObject(obj)) {
    errors.push("mention must be an object");
    return;
  }

  if (!isString(obj.text)) {
    errors.push("mention.text must be a string");
  }

  // entityId is optional but must be string if present (null treated as absent)
  if (obj.entityId != null && !isString(obj.entityId)) {
    errors.push("mention.entityId must be a string");
  }

  // entryId is optional but must be string if present (null treated as absent)
  if (obj.entryId != null && !isString(obj.entryId)) {
    errors.push("mention.entryId must be a string");
  }

  if (!isNumber(obj.confidence)) {
    errors.push("mention.confidence must be a number");
  }

  if (!isString(obj.evidence)) {
    errors.push("mention.evidence must be a string");
  }
}

/**
 * Validate a single reference object.
 */
function validateReference(obj: unknown, errors: string[]): void {
  if (!isObject(obj)) {
    errors.push("reference must be an object");
    return;
  }

  if (!isString(obj.text)) {
    errors.push("reference.text must be a string");
  }

  // resolvedEntityId is optional but must be string if present (null treated as absent)
  if (obj.resolvedEntityId != null && !isString(obj.resolvedEntityId)) {
    errors.push("reference.resolvedEntityId must be a string");
  }

  if (!isString(obj.resolutionSource)) {
    errors.push("reference.resolutionSource must be a string");
  } else if (!VALID_RESOLUTION_SOURCES.has(obj.resolutionSource)) {
    errors.push(
      `reference.resolutionSource must be one of: ${[...VALID_RESOLUTION_SOURCES].join(", ")}`,
    );
  }

  if (!isNumber(obj.confidence)) {
    errors.push("reference.confidence must be a number");
  }
}

/**
 * Validate a single dialogue object.
 */
function validateDialogue(obj: unknown, errors: string[]): void {
  if (!isObject(obj)) {
    errors.push("dialogue must be an object");
    return;
  }

  if (!isString(obj.speakerEntityId)) {
    errors.push("dialogue.speakerEntityId must be a string");
  }

  if (!isArray(obj.targetEntityIds)) {
    errors.push("dialogue.targetEntityIds must be an array");
  } else if (!obj.targetEntityIds.every((id) => isString(id))) {
    errors.push("dialogue.targetEntityIds must contain only strings");
  }

  if (!isString(obj.text)) {
    errors.push("dialogue.text must be a string");
  }

  if (!isArray(obj.toneHints)) {
    errors.push("dialogue.toneHints must be an array");
  } else if (!obj.toneHints.every((h) => isString(h))) {
    errors.push("dialogue.toneHints must contain only strings");
  }
}

/**
 * Validate a single action object.
 */
function validateAction(obj: unknown, errors: string[]): void {
  if (!isObject(obj)) {
    errors.push("action must be an object");
    return;
  }

  if (!isString(obj.actorEntityId)) {
    errors.push("action.actorEntityId must be a string");
  }

  if (!isString(obj.action)) {
    errors.push("action.action must be a string");
  }

  if (!isArray(obj.targetEntityIds)) {
    errors.push("action.targetEntityIds must be an array");
  } else if (!obj.targetEntityIds.every((id) => isString(id))) {
    errors.push("action.targetEntityIds must contain only strings");
  }

  if (!isArray(obj.objectEntityIds)) {
    errors.push("action.objectEntityIds must be an array");
  } else if (!obj.objectEntityIds.every((id) => isString(id))) {
    errors.push("action.objectEntityIds must contain only strings");
  }

  if (!isArray(obj.locationEntityIds)) {
    errors.push("action.locationEntityIds must be an array");
  } else if (!obj.locationEntityIds.every((id) => isString(id))) {
    errors.push("action.locationEntityIds must contain only strings");
  }

  // purpose is optional but must be string if present (null treated as absent)
  if (obj.purpose != null && !isString(obj.purpose)) {
    errors.push("action.purpose must be a string");
  }
}

/**
 * Validate a single intent object.
 */
function validateIntent(obj: unknown, errors: string[]): void {
  if (!isObject(obj)) {
    errors.push("intent must be an object");
    return;
  }

  if (!isString(obj.type)) {
    errors.push("intent.type must be a string");
  } else if (!VALID_INTENT_TYPES.has(obj.type)) {
    errors.push(`intent.type must be one of: ${[...VALID_INTENT_TYPES].join(", ")}`);
  }

  if (!isArray(obj.targetEntityIds)) {
    errors.push("intent.targetEntityIds must be an array");
  } else if (!obj.targetEntityIds.every((id) => isString(id))) {
    errors.push("intent.targetEntityIds must contain only strings");
  }
}

/**
 * Validate a single historical reference object.
 */
function validateHistoricalReference(obj: unknown, errors: string[]): void {
  if (!isObject(obj)) {
    errors.push("historicalReference must be an object");
    return;
  }

  if (!isString(obj.text)) {
    errors.push("historicalReference.text must be a string");
  }

  // entryId is optional but must be string if present (null treated as absent)
  if (obj.entryId != null && !isString(obj.entryId)) {
    errors.push("historicalReference.entryId must be a string");
  }

  if (!isNumber(obj.confidence)) {
    errors.push("historicalReference.confidence must be a number");
  }
}

/**
 * Validate a single relationship signal object.
 */
function validateRelationshipSignal(obj: unknown, errors: string[]): void {
  if (!isObject(obj)) {
    errors.push("relationshipSignal must be an object");
    return;
  }

  if (!isString(obj.type)) {
    errors.push("relationshipSignal.type must be a string");
  }

  if (!isString(obj.subjectEntityId)) {
    errors.push("relationshipSignal.subjectEntityId must be a string");
  }

  // objectEntityId is optional but must be string if present (null treated as absent)
  if (obj.objectEntityId != null && !isString(obj.objectEntityId)) {
    errors.push("relationshipSignal.objectEntityId must be a string");
  }

  if (!isString(obj.evidence)) {
    errors.push("relationshipSignal.evidence must be a string");
  }
}

/**
 * Validate a single unresolved reference object.
 */
function validateUnresolvedReference(obj: unknown, errors: string[]): void {
  if (!isObject(obj)) {
    errors.push("unresolvedReference must be an object");
    return;
  }

  if (!isString(obj.text)) {
    errors.push("unresolvedReference.text must be a string");
  }

  if (!isString(obj.reason)) {
    errors.push("unresolvedReference.reason must be a string");
  }
}

/**
 * Validate the diagnostics object.
 */
function validateDiagnostics(obj: unknown, errors: string[]): void {
  if (!isObject(obj)) {
    errors.push("diagnostics must be an object");
    return;
  }

  // parserMode is required
  if (!isString(obj.parserMode)) {
    errors.push("diagnostics.parserMode must be a string");
  } else if (!["llm", "regex-fallback", "empty-fallback"].includes(obj.parserMode)) {
    errors.push("diagnostics.parserMode must be 'llm', 'regex-fallback', or 'empty-fallback'");
  }

  // model is optional but must be string if present (null treated as absent)
  if (obj.model != null && !isString(obj.model)) {
    errors.push("diagnostics.model must be a string");
  }

  if (!isNumber(obj.parseAttempts)) {
    errors.push("diagnostics.parseAttempts must be a number");
  }

  if (!isArray(obj.removedInvalidEntityIds)) {
    errors.push("diagnostics.removedInvalidEntityIds must be an array");
  } else if (!obj.removedInvalidEntityIds.every((id) => isString(id))) {
    errors.push("diagnostics.removedInvalidEntityIds must contain only strings");
  }

  if (!isArray(obj.removedInvalidEntryIds)) {
    errors.push("diagnostics.removedInvalidEntryIds must be an array");
  } else if (!obj.removedInvalidEntryIds.every((id) => isString(id))) {
    errors.push("diagnostics.removedInvalidEntryIds must contain only strings");
  }

  if (!isArray(obj.warnings)) {
    errors.push("diagnostics.warnings must be an array");
  } else if (!obj.warnings.every((w) => isString(w))) {
    errors.push("diagnostics.warnings must contain only strings");
  }
}

/**
 * Validate that a value matches the ParsedRpInputV1 structure.
 *
 * This is a lightweight runtime validator that checks:
 * - Top-level structure
 * - Required fields and their types
 * - Array element structures
 * - Enum values
 *
 * Does NOT validate:
 * - Semantic correctness (that's Grounding's job)
 * - Entity ID existence (that's Grounding's job)
 *
 * @param data - The data to validate
 * @returns ValidationResult with valid flag and any errors
 */
export function validateParsedRpInputV1(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data)) {
    return { valid: false, errors: ["data must be an object"] };
  }

  // version
  if (data.version !== "parsed-rp-input-v1") {
    errors.push('version must be "parsed-rp-input-v1"');
  }

  // rawText
  if (!isString(data.rawText)) {
    errors.push("rawText must be a string");
  }

  // mentions
  if (!isArray(data.mentions)) {
    errors.push("mentions must be an array");
  } else {
    data.mentions.forEach((m) => validateMention(m, errors));
  }

  // references
  if (!isArray(data.references)) {
    errors.push("references must be an array");
  } else {
    data.references.forEach((r) => validateReference(r, errors));
  }

  // dialogues
  if (!isArray(data.dialogues)) {
    errors.push("dialogues must be an array");
  } else {
    data.dialogues.forEach((d) => validateDialogue(d, errors));
  }

  // actions
  if (!isArray(data.actions)) {
    errors.push("actions must be an array");
  } else {
    data.actions.forEach((a) => validateAction(a, errors));
  }

  // intents
  if (!isArray(data.intents)) {
    errors.push("intents must be an array");
  } else {
    data.intents.forEach((intent) => validateIntent(intent, errors));
  }

  // historicalReferences
  if (!isArray(data.historicalReferences)) {
    errors.push("historicalReferences must be an array");
  } else {
    data.historicalReferences.forEach((hr) => validateHistoricalReference(hr, errors));
  }

  // relationshipSignals
  if (!isArray(data.relationshipSignals)) {
    errors.push("relationshipSignals must be an array");
  } else {
    data.relationshipSignals.forEach((rs) => validateRelationshipSignal(rs, errors));
  }

  // unresolvedReferences
  if (!isArray(data.unresolvedReferences)) {
    errors.push("unresolvedReferences must be an array");
  } else {
    data.unresolvedReferences.forEach((ur) => validateUnresolvedReference(ur, errors));
  }

  // diagnostics
  if (!data.diagnostics) {
    errors.push("diagnostics is required");
  } else {
    validateDiagnostics(data.diagnostics, errors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
