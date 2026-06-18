import type {
  CardImportBlockedFeatureCode,
  CardImportBlockedFeatureV1,
  CardCapabilitiesV1,
  SillyTavernCardV3,
  SillyTavernCharacterBookEntry,
} from "./types.js";

// ---------------------------------------------------------------------------
// Detection patterns — pure regex, no execution
// ---------------------------------------------------------------------------

const PATTERNS: Record<CardImportBlockedFeatureCode, RegExp[]> = {
  javascript: [/\bnew\s+Function\s*\(/, /\bFunction\s*\(/],
  eval: [/\beval\s*\(/],
  "function-constructor": [/\bnew\s+Function\s*\(/, /\bFunction\s*\(/],
  "ejs-template": [/<%[\s\S]*?%>/],
  "getvar-executor": [
    /\{\{\s*getvar\s*:/,
    /\{\{\s*setvar\s*:/,
    /\{\{\s*addvar\s*:/,
    /\{\{\s*incvar\s*:/,
    /\{\{\s*decvar\s*:/,
  ],
  "import-url": [
    /\bimport\s*\(/,
    /\bimport\s+['"]https?:/,
    /\bimport\s+\w[\w$]*\s+from\s+['"]https?:/,
  ],
  "script-tag": [/<script[\s>]/i],
  "html-event-handler": [/\bon\w+\s*=/i],
  "jquery-load": [/\$\s*\(\s*['"]https?:/, /\.load\s*\(\s*['"]https?:/],
  "remote-fetch": [/\bfetch\s*\(\s*['"]https?:/],
  "remote-plugin": [/\bloadPlugin\s*\(/, /\/plugin\/[^"'\s]*\.js/],
  "auto-install-command": [/\bnpm\s+install\b/, /\bpip\s+install\b/],
  "remote-status-bar": [/\{\{[^}]*status[^}]*\}\}.*https?:/],
  "remote-opening-page": [/<iframe[\s>]/i],
  "regex-script": [],
  "helper-script": [],
  "tavern-extension-script": [],
};

// Variable detection patterns (subset of blocked features)
const VARIABLE_PATTERNS = [
  /\{\{\s*getvar\s*:/,
  /\{\{\s*setvar\s*:/,
  /\{\{\s*addvar\s*:/,
  /\{\{\s*incvar\s*:/,
  /\{\{\s*decvar\s*:/,
  /\{\{var::/,
  /<%[\s\S]*?%>/,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectStrings(obj: unknown, out: string[]): void {
  if (typeof obj === "string") {
    out.push(obj);
    return;
  }
  if (obj == null || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) collectStrings(item, out);
    return;
  }
  for (const value of Object.values(obj as Record<string, unknown>)) {
    collectStrings(value, out);
  }
}

function truncateEvidence(text: string, maxLen = 120): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

function extractVariableRefs(text: string): string[] {
  const refs = new Set<string>();
  const patterns = [
    /\{\{\s*getvar\s*:\s*([^}|]+)/g,
    /\{\{\s*setvar\s*:\s*([^}|]+)/g,
    /\{\{var::(?:get|set)\s*:\s*([^}|]+)/g,
  ];
  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(text)) !== null) {
      const ref = m[1];
      if (ref) refs.add(ref.trim());
    }
  }
  return [...refs];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect blocked features in a parsed card. Pure pattern matching, no execution.
 */
export function detectBlockedFeatures(card: SillyTavernCardV3): CardImportBlockedFeatureV1[] {
  const strings: string[] = [];
  collectStrings(card, strings);
  const allText = strings.join("\n");

  const results: CardImportBlockedFeatureV1[] = [];

  for (const [code, patterns] of Object.entries(PATTERNS) as [
    CardImportBlockedFeatureCode,
    RegExp[],
  ][]) {
    if (patterns.length === 0) continue;
    let count = 0;
    let evidence: string | null = null;
    for (const pat of patterns) {
      const matches = allText.match(pat);
      if (matches) {
        count += matches.length;
        if (!evidence) evidence = truncateEvidence(matches[0]);
      }
    }
    if (count > 0) {
      const status: "blocked" | "preserved-not-executed" =
        code === "regex-script" || code === "helper-script" || code === "tavern-extension-script"
          ? "preserved-not-executed"
          : "blocked";
      results.push({
        code,
        status,
        location: "card.data",
        count,
        evidence,
      });
    }
  }

  // Extension-specific detection
  const ext = card.data.extensions;
  if (ext && typeof ext === "object") {
    for (const [key, value] of Object.entries(ext)) {
      if (typeof value === "string") {
        if (/regex/i.test(key) && value.length > 10) {
          results.push({
            code: "regex-script",
            status: "preserved-not-executed",
            location: `extensions.${key}`,
            count: 1,
            evidence: truncateEvidence(value),
          });
        }
        if (/helper|script/i.test(key) && value.length > 10) {
          results.push({
            code: "helper-script",
            status: "preserved-not-executed",
            location: `extensions.${key}`,
            count: 1,
            evidence: truncateEvidence(value),
          });
        }
      }
    }
  }

  return results;
}

/**
 * Detect variable/MVU capabilities in a parsed card. Metadata only, no execution.
 */
export function detectCapabilities(
  card: SillyTavernCardV3,
  entries: SillyTavernCharacterBookEntry[],
): CardCapabilitiesV1 {
  const strings: string[] = [];
  collectStrings(card.data, strings);
  const allText = strings.join("\n");

  let variablesDetected = false;
  const variableSourceLocations: string[] = [];
  const conditionalEntryIds: string[] = [];

  // Check for variable patterns in card data
  for (const pat of VARIABLE_PATTERNS) {
    if (pat.test(allText)) {
      variablesDetected = true;
      break;
    }
  }

  // Check entries for variable conditions
  for (const entry of entries) {
    const content = entry.content || "";
    const hasCondition = VARIABLE_PATTERNS.some((pat) => pat.test(content));
    if (hasCondition) {
      variablesDetected = true;
      const uid = entry.uid ?? entry.id ?? 0;
      conditionalEntryIds.push(String(uid));
      variableSourceLocations.push(`entry:${uid}`);
    }
  }

  // Check extensions for variable schema / initial state / patch protocol
  const ext = card.data.extensions;
  let variableSchemaDetected = false;
  let variableSchemaLocation: string | null = null;
  let initialStateDetected = false;
  let initialStateLocation: string | null = null;
  let patchProtocolDetected = false;
  let patchProtocolLocation: string | null = null;

  if (ext) {
    for (const [key, value] of Object.entries(ext)) {
      if (/variable.*schema|schema.*variable/i.test(key) && value != null) {
        variableSchemaDetected = true;
        variableSchemaLocation = `extensions.${key}`;
      }
      if (
        /^(state|initial_state|variables)$/i.test(key) &&
        typeof value === "object" &&
        value != null
      ) {
        initialStateDetected = true;
        initialStateLocation = `extensions.${key}`;
      }
      if (/patch|json.?patch/i.test(key)) {
        patchProtocolDetected = true;
        patchProtocolLocation = `extensions.${key}`;
      }
    }
    // Also check for JSON Patch patterns in extension values
    const extStr = JSON.stringify(ext);
    if (/"op"\s*:\s*"(replace|add|remove|move|copy|test)"/.test(extStr)) {
      patchProtocolDetected = true;
      if (!patchProtocolLocation) patchProtocolLocation = "extensions";
    }
  }

  return {
    variablesDetected,
    variableSchemaDetected,
    initialStateDetected,
    patchProtocolDetected,
    conditionalEntriesDetected: conditionalEntryIds.length > 0,
    variableSourceLocations,
    variableSchemaLocation,
    initialStateLocation,
    patchProtocolLocation,
    conditionalEntryIds,
    runtimeStatus: "unsupported-runtime",
  };
}

/**
 * Check if a single string contains variable condition patterns.
 */
export function hasVariableCondition(text: string): boolean {
  return VARIABLE_PATTERNS.some((pat) => pat.test(text));
}

/**
 * Check if a single string contains blocked script patterns.
 * Excludes variable patterns (getvar/setvar/MVU) — those are handled by hasVariableCondition.
 */
export function hasBlockedScript(text: string): boolean {
  // Only check actual script execution patterns, not variable patterns
  const scriptPatterns: RegExp[] = [
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /\bFunction\s*\(/,
    /<script[\s>]/i,
    /\bimport\s*\(/,
    /\bimport\s+['"]https?:/,
    /\bimport\s+\w[\w$]*\s+from\s+['"]https?:/,
    /\$\s*\(\s*['"]https?:/,
    /\.load\s*\(\s*['"]https?:/,
    /\bfetch\s*\(\s*['"]https?:/,
    /\bloadPlugin\s*\(/,
    /\bnpm\s+install\b/,
    /\bpip\s+install\b/,
    /<iframe[\s>]/i,
  ];
  for (const pat of scriptPatterns) {
    if (pat.test(text)) return true;
  }
  return false;
}

/**
 * Extract variable references from text.
 */
export function extractVariableRefsPublic(text: string): string[] {
  return extractVariableRefs(text);
}
