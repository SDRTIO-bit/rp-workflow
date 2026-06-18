import type {
  CardCapabilitiesV1,
  CardImportBlockedFeatureV1,
  CardImportWarningV1,
  CardManifestV1,
  DeferredWorldbookEntryV1,
  ImportedGreetingV1,
  ImportedWorldbookEntryV1,
  SillyTavernCardV3,
} from "./types.js";

export interface BuildManifestArgs {
  card: SillyTavernCardV3;
  cardId: string;
  sourceFilename: string;
  sourceSizeBytes: number;
  greetings: ImportedGreetingV1[];
  defaultGreetingId: string | null;
  entries: ImportedWorldbookEntryV1[];
  deferred: DeferredWorldbookEntryV1[];
  blockedFeatures: CardImportBlockedFeatureV1[];
  capabilities: CardCapabilitiesV1;
  warnings: CardImportWarningV1[];
  counts: { disabled: number; blocked: number; constant: number };
}

/**
 * Build a CardManifestV1 from parsed card data.
 * No absolute paths — paths are derived at runtime from cardsDir + cardId.
 */
export function buildManifest(args: BuildManifestArgs): CardManifestV1 {
  const {
    card,
    cardId,
    sourceFilename,
    sourceSizeBytes,
    greetings,
    defaultGreetingId,
    entries,
    deferred,
    blockedFeatures,
    capabilities,
    warnings,
    counts,
  } = args;

  // Extract tags from card data
  const tags: string[] = [];
  const data = card.data;
  if (data.tags && Array.isArray(data.tags)) {
    for (const t of data.tags) {
      if (typeof t === "string" && t.length > 0) tags.push(t);
    }
  }
  // Also check extensions for tags
  if (data.extensions) {
    const extTags = data.extensions.tags;
    if (Array.isArray(extTags)) {
      for (const t of extTags) {
        if (typeof t === "string" && t.length > 0 && !tags.includes(t)) {
          tags.push(t);
        }
      }
    }
  }

  return {
    schemaVersion: 1,
    cardId,
    sourceFilename,
    sourceSizeBytes,
    sourceHash: cardId,
    importedAt: new Date().toISOString(),
    spec: card.spec,
    name: data.name,
    description: typeof data.description === "string" ? data.description : null,
    tags: tags.sort(),
    worldbookEntryCount: entries.length,
    worldbookDeferredCount: deferred.length,
    worldbookDisabledCount: counts.disabled,
    worldbookBlockedCount: counts.blocked,
    worldbookConstantCount: counts.constant,
    alternateGreetingCount: greetings.length,
    defaultGreetingId,
    capabilities,
    warnings,
    blockedFeatures,
    worldbookResourceRef: `card:${cardId}`,
  };
}
