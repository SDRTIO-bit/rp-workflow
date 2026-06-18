// @awp/card-import type definitions — P-15.3A-1
// Data contracts for SillyTavern Chara Card V3 import.

import type { DynamicWorldbookEntryV1 } from "@awp/workflow-worldbook";

// ---------------------------------------------------------------------------
// Activation Policy (correction rule #2)
// ---------------------------------------------------------------------------

export type ActivationPolicy =
  | "always-core"
  | "retrieval"
  | "deferred-variable"
  | "blocked-script"
  | "disabled";

// ---------------------------------------------------------------------------
// Warning codes
// ---------------------------------------------------------------------------

export type CardImportWarningCode =
  | "duplicate-keys"
  | "conflicting-keywords"
  | "conflicting-year-values"
  | "remote-first-mes"
  | "constant-entries-not-auto-injected"
  | "disabled-entries-skipped"
  | "greeting-remote-content-removed"
  | "greeting-status-bar-removed"
  | "greeting-variable-tags-separated"
  | "greeting-initial-patch-not-applied"
  | "entry-variable-condition-unsupported"
  | "large-entry-count"
  | "non-utf8-content-coerced"
  | "entry-chunked"
  | "entry-rejected-too-long";

export interface CardImportWarningV1 {
  code: CardImportWarningCode;
  severity: "info" | "warn" | "error";
  message: string;
  location: string | null;
  count: number | null;
}

// ---------------------------------------------------------------------------
// Blocked feature codes
// ---------------------------------------------------------------------------

export type CardImportBlockedFeatureCode =
  | "javascript"
  | "eval"
  | "function-constructor"
  | "ejs-template"
  | "getvar-executor"
  | "import-url"
  | "script-tag"
  | "html-event-handler"
  | "jquery-load"
  | "remote-fetch"
  | "remote-plugin"
  | "auto-install-command"
  | "remote-status-bar"
  | "remote-opening-page"
  | "regex-script"
  | "helper-script"
  | "tavern-extension-script";

export interface CardImportBlockedFeatureV1 {
  code: CardImportBlockedFeatureCode;
  status: "blocked" | "preserved-not-executed";
  location: string;
  count: number;
  evidence: string | null;
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface CardCapabilitiesV1 {
  variablesDetected: boolean;
  variableSchemaDetected: boolean;
  initialStateDetected: boolean;
  patchProtocolDetected: boolean;
  conditionalEntriesDetected: boolean;
  variableSourceLocations: string[];
  variableSchemaLocation: string | null;
  initialStateLocation: string | null;
  patchProtocolLocation: string | null;
  conditionalEntryIds: string[];
  runtimeStatus: "unsupported-runtime";
}

// ---------------------------------------------------------------------------
// Worldbook entry metadata (whitelisted scalars per correction rule #3)
// ---------------------------------------------------------------------------

export interface ImportedWorldbookEntryMetadata {
  sourceEntryUid: number | string;
  sourceKeys: string[];
  sourceSecondaryKeys: string[];
  sourceConstant: boolean;
  sourceSelective: boolean;
  sourcePosition: string | null;
  sourceDepth: number | null;
  sourceProbability: number | null;
  sourceGroup: string | null;
  sourcePreventRecursion: boolean;
  sourceUseProbability: boolean;
  sourceExtensions: Record<string, unknown> | null;
  sourceEnabled: boolean;

  unsupportedVariableCondition: boolean;
  variableConditionSource: string | null;
  detectedVariableRefs: string[];

  cardId: string;
  importSchemaVersion: 1;
  activationPolicy: ActivationPolicy;

  // Chunking provenance (correction rule #5)
  sourceEntryId: string | null;
  partIndex: number | null;
  partCount: number | null;
}

export type ImportedWorldbookEntryV1 = DynamicWorldbookEntryV1 & {
  metadata: ImportedWorldbookEntryMetadata;
};

// ---------------------------------------------------------------------------
// Deferred worldbook entry (variable-condition, not in active worldbook)
// ---------------------------------------------------------------------------

export interface DeferredWorldbookEntryV1 {
  sourceEntryUid: number | string;
  reason: "deferred-variable" | "blocked-script";
  originalContent: string;
  variableConditionSource: string | null;
  detectedVariableRefs: string[];
  activationPolicy: ActivationPolicy;
}

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------

export interface ImportedGreetingV1 {
  greetingId: string;
  index: number;
  label: string | null;
  content: string;
  contentHash: string;
  isDefault: boolean;
  hadStatusBarPlaceholder: boolean;
  hadVariableUpdateTags: boolean;
  hadRemoteContent: boolean;
  hadUnappliedInitialPatch: boolean;
  removedFragmentSummary: string[];
  separatedVariableTags: string[];
  separatedRemoteRefs: string[];
}

// ---------------------------------------------------------------------------
// Manifest (correction rule #4: no absolute paths)
// ---------------------------------------------------------------------------

export interface CardManifestV1 {
  schemaVersion: 1;
  cardId: string;
  sourceFilename: string;
  sourceSizeBytes: number;
  sourceHash: string;
  importedAt: string;
  spec: string;
  name: string;
  description: string | null;
  tags: string[];
  worldbookEntryCount: number;
  worldbookDeferredCount: number;
  worldbookDisabledCount: number;
  worldbookBlockedCount: number;
  worldbookConstantCount: number;
  alternateGreetingCount: number;
  defaultGreetingId: string | null;
  capabilities: CardCapabilitiesV1;
  warnings: CardImportWarningV1[];
  blockedFeatures: CardImportBlockedFeatureV1[];
  worldbookResourceRef: string;
}

// ---------------------------------------------------------------------------
// Import result
// ---------------------------------------------------------------------------

export interface CardImportResultV1 {
  cardId: string;
  alreadyExisted: boolean;
  manifest: CardManifestV1;
  greetings: ImportedGreetingV1[];
  defaultGreetingId: string | null;
}

// ---------------------------------------------------------------------------
// Parse limits
// ---------------------------------------------------------------------------

export interface CardParseLimits {
  maxBytes: number;
  maxJsonDepth: number;
  maxWorldbookEntries: number;
  maxGreetings: number;
  maxEntryContentChars: number;
  maxSourceFilenameChars: number;
}

export const DEFAULT_CARD_PARSE_LIMITS: CardParseLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxJsonDepth: 64,
  maxWorldbookEntries: 2000,
  maxGreetings: 64,
  maxEntryContentChars: 100_000,
  maxSourceFilenameChars: 255,
};

// ---------------------------------------------------------------------------
// Store types
// ---------------------------------------------------------------------------

export interface CardStoreEntry {
  cardId: string;
  manifest: CardManifestV1;
  greetings: ImportedGreetingV1[];
  worldbook: ImportedWorldbookEntryV1[];
  deferredWorldbook: DeferredWorldbookEntryV1[];
  importReport: ImportReportV1;
}

export interface ImportReportV1 {
  schemaVersion: 1;
  warnings: CardImportWarningV1[];
  blockedFeatures: CardImportBlockedFeatureV1[];
  capabilities: CardCapabilitiesV1;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// SillyTavern V3 raw shape (input)
// ---------------------------------------------------------------------------

export interface SillyTavernCharacterBookEntry {
  uid?: number;
  id?: number;
  comment?: string;
  name?: string;
  content?: string;
  keys?: string;
  secondary_keys?: string;
  constant?: boolean;
  selective?: boolean;
  insertion_order?: number;
  priority?: number;
  position?: string;
  depth?: number;
  probability?: number;
  group?: string;
  prevent_recursion?: boolean;
  use_probability?: boolean;
  extensions?: Record<string, unknown>;
  disable?: boolean;
  enabled?: boolean;
  category?: string;
}

export interface SillyTavernCharacterBook {
  name?: string;
  description?: string;
  entries?: SillyTavernCharacterBookEntry[];
}

export interface SillyTavernAlternateGreeting {
  greeting?: string;
  name?: string;
  label?: string;
}

export interface SillyTavernCardV3 {
  spec: string;
  spec_version: string;
  data: {
    name: string;
    description?: string;
    first_mes?: string;
    alternate_greetings?: SillyTavernAlternateGreeting[];
    character_book?: SillyTavernCharacterBook;
    extensions?: Record<string, unknown>;
    [key: string]: unknown;
  };
}
