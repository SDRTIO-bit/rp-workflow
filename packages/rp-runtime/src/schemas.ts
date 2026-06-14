// Schema Validators - RP Runtime

export interface SchemaValidator {
  schemaId: string;
  validate(data: unknown): { valid: boolean; errors?: string[] };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (obj: Record<string, unknown>, field: string): string | null => {
  if (typeof obj[field] !== "string") return `${field} must be string`;
  return null;
};

const requireArray = (obj: Record<string, unknown>, field: string): string | null => {
  if (!Array.isArray(obj[field])) return `${field} must be array`;
  return null;
};

const requireObject = (obj: Record<string, unknown>, field: string): string | null => {
  if (!isObject(obj[field])) return `${field} must be object`;
  return null;
};

// ============ rp.parsed-input.v1 ============

const parsedInputValidator: SchemaValidator = {
  schemaId: "rp.parsed-input.v1",
  validate(data) {
    if (!isObject(data)) return { valid: false, errors: ["must be an object"] };
    const errors: string[] = [];
    const err = (msg: string | null) => {
      if (msg) errors.push(msg);
    };

    err(requireString(data, "rawText"));
    err(requireArray(data, "actions"));
    err(requireArray(data, "dialogues"));
    err(requireArray(data, "intents"));
    err(requireObject(data, "entities"));

    if (isObject(data.entities)) {
      const e = data.entities;
      err(requireArray(e, "characters"));
      err(requireArray(e, "locations"));
      err(requireArray(e, "items"));
      err(requireArray(e, "timeHints"));
    }

    err(requireString(data, "parsedAt"));

    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  },
};

// ============ rp.timeline-context.v1 ============

const timelineContextValidator: SchemaValidator = {
  schemaId: "rp.timeline-context.v1",
  validate(data) {
    if (!isObject(data)) return { valid: false, errors: ["must be an object"] };
    const errors: string[] = [];
    if (!Array.isArray(data.chapters)) errors.push("chapters must be array");
    if (!Array.isArray(data.relevantEvents)) errors.push("relevantEvents must be array");
    if (typeof data.totalChapters !== "number") errors.push("totalChapters must be number");
    if (typeof data.queryTimeMs !== "number") errors.push("queryTimeMs must be number");
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  },
};

// ============ rp.lore-context.v1 ============

const loreContextValidator: SchemaValidator = {
  schemaId: "rp.lore-context.v1",
  validate(data) {
    if (!isObject(data)) return { valid: false, errors: ["must be an object"] };
    const errors: string[] = [];
    if (!Array.isArray(data.entries)) errors.push("entries must be array");
    if (!Array.isArray(data.activatedBy)) errors.push("activatedBy must be array");
    if (typeof data.totalEntries !== "number") errors.push("totalEntries must be number");
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  },
};

// ============ rp.tracker-state.v1 ============

const trackerStateValidator: SchemaValidator = {
  schemaId: "rp.tracker-state.v1",
  validate(data) {
    if (!isObject(data)) return { valid: false, errors: ["must be an object"] };
    const errors: string[] = [];
    err(requireString(data, "sessionId"));
    err(requireString(data, "worldId"));
    err(requireArray(data, "characters"));
    err(requireArray(data, "locations"));
    err(requireArray(data, "items"));
    err(requireObject(data, "timeState"));
    if (typeof data.version !== "number") errors.push("version must be number");
    return errors.length > 0 ? { valid: false, errors } : { valid: true };

    function err(msg: string | null) {
      if (msg) errors.push(msg);
    }
  },
};

// ============ rp.tracker-patch.v1 ============

const trackerPatchValidator: SchemaValidator = {
  schemaId: "rp.tracker-patch.v1",
  validate(data) {
    if (!isObject(data)) return { valid: false, errors: ["must be an object"] };
    const errors: string[] = [];
    err(requireString(data, "sessionId"));
    err(requireString(data, "worldId"));
    err(requireString(data, "sourceTurnId"));
    err(requireArray(data, "operations"));
    err(requireString(data, "timestamp"));
    return errors.length > 0 ? { valid: false, errors } : { valid: true };

    function err(msg: string | null) {
      if (msg) errors.push(msg);
    }
  },
};

// ============ rp.memory-event.v1 ============

const memoryEventValidator: SchemaValidator = {
  schemaId: "rp.memory-event.v1",
  validate(data) {
    if (!isObject(data)) return { valid: false, errors: ["must be an object"] };
    const errors: string[] = [];
    err(requireString(data, "eventId"));
    err(requireString(data, "sessionId"));
    err(requireString(data, "worldId"));
    err(requireString(data, "chapterId"));
    err(requireString(data, "sourceTurnId"));
    err(requireString(data, "summary"));
    err(requireArray(data, "characters"));
    err(requireArray(data, "locations"));
    err(requireArray(data, "items"));
    err(requireArray(data, "emotionalChanges"));
    err(requireString(data, "createdAt"));
    return errors.length > 0 ? { valid: false, errors } : { valid: true };

    function err(msg: string | null) {
      if (msg) errors.push(msg);
    }
  },
};

// ============ rp.assembled-context.v1 ============

const assembledContextValidator: SchemaValidator = {
  schemaId: "rp.assembled-context.v1",
  validate(data) {
    if (!isObject(data)) return { valid: false, errors: ["must be an object"] };
    const errors: string[] = [];
    err(requireString(data, "systemPrompt"));
    err(requireString(data, "loreSection"));
    err(requireString(data, "timelineSection"));
    err(requireString(data, "trackerSection"));
    err(requireString(data, "recentMessagesSection"));
    err(requireString(data, "userInputSection"));
    err(requireString(data, "fullContext"));
    return errors.length > 0 ? { valid: false, errors } : { valid: true };

    function err(msg: string | null) {
      if (msg) errors.push(msg);
    }
  },
};

// ============ rp.budget-report.v1 ============

const budgetReportValidator: SchemaValidator = {
  schemaId: "rp.budget-report.v1",
  validate(data) {
    if (!isObject(data)) return { valid: false, errors: ["must be an object"] };
    const errors: string[] = [];
    if (typeof data.targetTokens !== "number") errors.push("targetTokens must be number");
    if (typeof data.hardLimitTokens !== "number") errors.push("hardLimitTokens must be number");
    if (!isObject(data.allocated)) errors.push("allocated must be object");
    if (!isObject(data.actual)) errors.push("actual must be object");
    if (!Array.isArray(data.truncatedSections)) errors.push("truncatedSections must be array");
    if (!Array.isArray(data.droppedSections)) errors.push("droppedSections must be array");
    const method = (data as Record<string, unknown>).tokenEstimationMethod;
    if (typeof method !== "string" || !["character_ratio", "tokenizer"].includes(method)) {
      errors.push("tokenEstimationMethod must be 'character_ratio' or 'tokenizer'");
    }
    if (!Array.isArray(data.warnings)) errors.push("warnings must be array");
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  },
};

// ============ rp.writer-output.v1 ============

const writerOutputValidator: SchemaValidator = {
  schemaId: "rp.writer-output.v1",
  validate(data) {
    if (!isObject(data)) return { valid: false, errors: ["must be an object"] };
    const errors: string[] = [];
    err(requireString(data, "text"));

    // Validate generationMode
    const mode = (data as Record<string, unknown>).generationMode;
    if (typeof mode !== "string" || !["llm", "mock", "echo_fallback"].includes(mode)) {
      errors.push("generationMode must be 'llm', 'mock', or 'echo_fallback'");
    }

    // Validate warnings (optional array of strings)
    const warnings = (data as Record<string, unknown>).warnings;
    if (warnings !== undefined && !Array.isArray(warnings)) {
      errors.push("warnings must be an array if present");
    }

    if (!isObject(data.metadata)) errors.push("metadata must be object");
    return errors.length > 0 ? { valid: false, errors } : { valid: true };

    function err(msg: string | null) {
      if (msg) errors.push(msg);
    }
  },
};

// ============ rp.commit-result.v1 ============

const commitResultValidator: SchemaValidator = {
  schemaId: "rp.commit-result.v1",
  validate(data) {
    if (!isObject(data)) return { valid: false, errors: ["must be an object"] };
    const errors: string[] = [];
    if (typeof data.success !== "boolean") errors.push("success must be boolean");
    if (!Array.isArray(data.errors)) errors.push("errors must be array");
    err(requireString(data, "committedAt"));
    return errors.length > 0 ? { valid: false, errors } : { valid: true };

    function err(msg: string | null) {
      if (msg) errors.push(msg);
    }
  },
};

// ============ rp.parsed-rp-input.v1 (B-2.9) ============
//
// Lightweight runtime validator for ParsedRpInputV1.
// Semantic correctness (entity ID existence, etc.) is enforced by
// validateAndGround at parse time, not here. This validator only checks
// shape so the runtime can route on it.

const parsedRpInputValidator: SchemaValidator = {
  schemaId: "rp.parsed-rp-input.v1",
  validate(data) {
    if (!isObject(data)) return { valid: false, errors: ["must be an object"] };
    const errors: string[] = [];
    if (data.version !== "parsed-rp-input-v1") {
      errors.push('version must be "parsed-rp-input-v1"');
    }
    if (typeof data.rawText !== "string") errors.push("rawText must be string");
    for (const field of [
      "mentions",
      "references",
      "dialogues",
      "actions",
      "intents",
      "historicalReferences",
      "relationshipSignals",
      "unresolvedReferences",
    ]) {
      if (!Array.isArray(data[field])) errors.push(`${field} must be array`);
    }
    if (!isObject(data.diagnostics)) errors.push("diagnostics must be object");
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  },
};

// ============ rp.worldbook-retrieval-result.v1 (B-2.9) ============

const worldbookRetrievalResultValidator: SchemaValidator = {
  schemaId: "rp.worldbook-retrieval-result.v1",
  validate(data) {
    if (!isObject(data)) return { valid: false, errors: ["must be an object"] };
    const errors: string[] = [];
    for (const field of ["directHits", "expandedEntries", "excludedEntries", "activatedKeywords"]) {
      if (!Array.isArray(data[field])) errors.push(`${field} must be array`);
    }
    if (typeof data.totalEntries !== "number") errors.push("totalEntries must be number");
    if (!isObject(data.byVisibility)) errors.push("byVisibility must be object");
    if (data.provenance !== undefined && !isObject(data.provenance)) {
      errors.push("provenance must be object if present");
    }
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  },
};

// ============ rp.assembled-context-v2 (B-2.9) ============
//
// V2 output adds split lore sections and per-parser-field user input
// sections. Section keys are loose strings (typed externally); this
// validator only enforces required keys exist as strings.

const assembledContextV2Validator: SchemaValidator = {
  schemaId: "rp.assembled-context-v2",
  validate(data) {
    if (!isObject(data)) return { valid: false, errors: ["must be an object"] };
    const errors: string[] = [];
    if (data.version !== "assembled-context-v2") {
      errors.push('version must be "assembled-context-v2"');
    }
    for (const field of [
      "systemPrompt",
      "mentionsSection",
      "referencesSection",
      "dialoguesSection",
      "actionsSection",
      "intentsSection",
      "historicalReferencesSection",
      "relationshipSignalsSection",
      "unresolvedReferencesSection",
      "rawUserInputSection",
      "loreDirectHitSection",
      "loreDeterministicExpansionSection",
      "loreSemanticExpansionSection",
      "timelineSection",
      "trackerSection",
      "recentMessagesSection",
      "fullContext",
    ]) {
      if (typeof data[field] !== "string") errors.push(`${field} must be string`);
    }
    if (!isObject(data.budgetReport)) errors.push("budgetReport must be object");
    if (!Array.isArray(data.parserFieldsCovered)) {
      errors.push("parserFieldsCovered must be array");
    }
    if (!Array.isArray(data.entryTriggersCovered)) {
      errors.push("entryTriggersCovered must be array");
    }
    if (data.loreEntriesDropped !== undefined && !Array.isArray(data.loreEntriesDropped)) {
      errors.push("loreEntriesDropped must be array if present");
    }
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  },
};

// ============ rp.worldbook-retrieval-result-with-provenance.v1 (B-2.9.1) ============
//
// STRICT variant: provenance is REQUIRED. This is the schema that
// rpSemanticExpanderV1 outputs and that rpContextAssemblerV2 consumes.
// workflow-core's port validator will reject a connection from a node
// that lacks this strict schema (e.g., the basic rpWorldbookRetrieverV1
// which has no output schemaId) at graph-validation time.
const VALID_TRIGGER_FIELDS = new Set([
  "mentions",
  "references",
  "dialogue-target",
  "action-target",
  "action-object",
  "intent-target",
  "historical-reference",
  "relationship-signal",
]);

const worldbookRetrievalResultWithProvenanceValidator: SchemaValidator = {
  schemaId: "rp.worldbook-retrieval-result-with-provenance.v1",
  validate(data) {
    if (!isObject(data)) return { valid: false, errors: ["must be an object"] };
    const errors: string[] = [];
    for (const field of ["directHits", "expandedEntries", "excludedEntries", "activatedKeywords"]) {
      if (!Array.isArray(data[field])) errors.push(`${field} must be array`);
    }
    if (typeof data.totalEntries !== "number") errors.push("totalEntries must be number");
    if (!isObject(data.byVisibility)) errors.push("byVisibility must be object");

    // provenance is REQUIRED in the strict variant. All id arrays are
    // REQUIRED (they may be empty). entryTriggers is OPTIONAL — the
    // semantic expander always populates it, but early B-2.7 era
    // assemblers (e.g., rpSemanticExpanderV1 in tests) may construct
    // retrieval results that lack it. The validator permits absence
    // but validates shape when present.
    if (!isObject(data.provenance)) {
      errors.push("provenance is required (strict schema)");
    } else {
      const prov = data.provenance as Record<string, unknown>;
      for (const field of ["directHitIds", "deterministicExpansionIds", "semanticExpansionIds"]) {
        if (!Array.isArray(prov[field])) {
          errors.push(`provenance.${field} must be array`);
        }
      }
      // entryTriggers is OPTIONAL — validate shape when present
      if (prov.entryTriggers !== undefined) {
        if (!isObject(prov.entryTriggers)) {
          errors.push("provenance.entryTriggers must be object");
        } else {
          for (const [entryId, fields] of Object.entries(prov.entryTriggers)) {
            if (!Array.isArray(fields)) {
              errors.push(`provenance.entryTriggers["${entryId}"] must be array`);
              continue;
            }
            for (const f of fields) {
              if (typeof f !== "string" || !VALID_TRIGGER_FIELDS.has(f)) {
                errors.push(
                  `provenance.entryTriggers["${entryId}"] contains invalid field "${String(f)}"`,
                );
              }
            }
          }
        }
      }
    }
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  },
};

// ============ Registry ============

export const schemaValidators: Record<string, SchemaValidator> = {
  "rp.parsed-input.v1": parsedInputValidator,
  "rp.parsed-rp-input.v1": parsedRpInputValidator,
  "rp.worldbook-retrieval-result.v1": worldbookRetrievalResultValidator,
  "rp.worldbook-retrieval-result-with-provenance.v1":
    worldbookRetrievalResultWithProvenanceValidator,
  "rp.assembled-context-v2": assembledContextV2Validator,
  "rp.timeline-context.v1": timelineContextValidator,
  "rp.lore-context.v1": loreContextValidator,
  "rp.tracker-state.v1": trackerStateValidator,
  "rp.tracker-patch.v1": trackerPatchValidator,
  "rp.memory-event.v1": memoryEventValidator,
  "rp.assembled-context.v1": assembledContextValidator,
  "rp.budget-report.v1": budgetReportValidator,
  "rp.writer-output.v1": writerOutputValidator,
  "rp.commit-result.v1": commitResultValidator,
};

export function validateSchema(schemaId: string, data: unknown): void {
  const validator = schemaValidators[schemaId];
  if (!validator) {
    throw new Error(`Unknown schema: ${schemaId}`);
  }
  const result = validator.validate(data);
  if (!result.valid) {
    throw new Error(`Schema validation failed for ${schemaId}: ${result.errors?.join(", ")}`);
  }
}
