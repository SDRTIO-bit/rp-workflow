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

// ============ Registry ============

export const schemaValidators: Record<string, SchemaValidator> = {
  "rp.parsed-input.v1": parsedInputValidator,
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
