// @awp/card-import — barrel exports

// Types
export type {
  ActivationPolicy,
  CardCapabilitiesV1,
  CardImportBlockedFeatureCode,
  CardImportBlockedFeatureV1,
  CardImportWarningCode,
  CardImportWarningV1,
  CardImportResultV1,
  CardManifestV1,
  CardParseLimits,
  CardStoreEntry,
  DeferredWorldbookEntryV1,
  ImportReportV1,
  ImportedGreetingV1,
  ImportedWorldbookEntryMetadata,
  ImportedWorldbookEntryV1,
  SillyTavernAlternateGreeting,
  SillyTavernCardV3,
  SillyTavernCharacterBook,
  SillyTavernCharacterBookEntry,
} from "./types.js";

export { DEFAULT_CARD_PARSE_LIMITS } from "./types.js";

// Hash
export { computeCardId, sha256String } from "./hash.js";

// Detect
export {
  detectBlockedFeatures,
  detectCapabilities,
  hasBlockedScript,
  hasVariableCondition,
  extractVariableRefsPublic,
} from "./detect.js";

// Parse
export {
  parseSillyTavernCard,
  measureJsonDepth,
  wasNonUtf8Coerced,
  stripInternalFlags,
  CardImportError,
} from "./parse.js";
export type { CardImportErrorCode } from "./parse.js";

// Greetings
export { extractGreetings, cleanGreeting } from "./greetings.js";
export type { CleanedGreeting, ExtractedGreetings } from "./greetings.js";

// Worldbook mapper
export { mapWorldbookEntries } from "./worldbookMapper.js";
export type { WorldbookMappingResult } from "./worldbookMapper.js";

// Manifest
export { buildManifest } from "./manifest.js";
export type { BuildManifestArgs } from "./manifest.js";

// Card store
export { FileCardStore, safeFilename } from "./cardStore.js";
