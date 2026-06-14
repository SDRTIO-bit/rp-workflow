/**
 * RP Context Assembler V2 - Section Builders - Phase B-2.9
 *
 * Pure functions that turn ParsedRpInputV1 + WorldbookRetrievalResult into
 * rendered Markdown sections (text) and PromptSectionV1[] (typed).
 *
 * NO I/O, NO state. Same input -> same output, deterministic.
 *
 * Each builder returns:
 *   { text: string;    // rendered Markdown body
 *     fields: string[] // parserFields / retrievalSource markers
 *   }
 *
 * If the source has no data, the builder returns `{ text: "", fields: [] }`
 * so the assembler can skip empty sections.
 */

import type { ParsedRpInputV1 } from "../parser/types.js";
import type { WorldbookEntryV1, WorldbookRetrievalResult } from "../worldbook/types.js";
import type { PromptSectionSource, PromptSectionV1 } from "../prompt/types.js";
import type { RecentMessage, TimelineContext, TrackerState } from "../types.js";

export interface SectionBuildResult {
  text: string;
  /** Which ParsedRpInputV1 fields contributed (deduped, stable order). */
  parserFields: string[];
  /** Which retrieval source this section was built from (only set for lore). */
  retrievalSource?: "directHit" | "deterministicExpansion" | "semanticExpansion";
}

// =====================================================================
// 1) Raw user input
// =====================================================================

export function buildRawUserInputSection(parsed: ParsedRpInputV1): SectionBuildResult {
  const text = parsed.rawText ?? "";
  if (!text) return { text: "", parserFields: [] };
  return {
    text: `[Raw User Input]\n${text}`,
    parserFields: ["rawText"],
  };
}

// =====================================================================
// 2) Mentions
// =====================================================================

export function buildMentionsSection(parsed: ParsedRpInputV1): SectionBuildResult {
  if (parsed.mentions.length === 0) return { text: "", parserFields: [] };
  const lines: string[] = ["[Mentions]"];
  for (const m of parsed.mentions) {
    const parts = [`- "${m.text}"`];
    if (m.entityId) parts.push(`entityId=${m.entityId}`);
    if (m.entryId) parts.push(`entryId=${m.entryId}`);
    if (m.category) parts.push(`category=${m.category}`);
    parts.push(`confidence=${m.confidence.toFixed(2)}`);
    parts.push(`evidence=${m.evidence}`);
    lines.push(parts.join(" "));
  }
  return { text: lines.join("\n"), parserFields: ["mentions"] };
}

// =====================================================================
// 3) Resolved references
// =====================================================================

export function buildReferencesSection(parsed: ParsedRpInputV1): SectionBuildResult {
  if (parsed.references.length === 0) return { text: "", parserFields: [] };
  const lines: string[] = ["[Resolved References]"];
  for (const r of parsed.references) {
    const parts = [`- "${r.text}"`];
    if (r.resolvedEntityId) parts.push(`resolvedEntityId=${r.resolvedEntityId}`);
    parts.push(`source=${r.resolutionSource}`);
    parts.push(`confidence=${r.confidence.toFixed(2)}`);
    lines.push(parts.join(" "));
  }
  return { text: lines.join("\n"), parserFields: ["references"] };
}

// =====================================================================
// 4) Dialogues
// =====================================================================

export function buildDialoguesSection(parsed: ParsedRpInputV1): SectionBuildResult {
  if (parsed.dialogues.length === 0) return { text: "", parserFields: [] };
  const lines: string[] = ["[Dialogues]"];
  for (const d of parsed.dialogues) {
    const parts = [`- ${d.speakerEntityId}`];
    if (d.targetEntityIds.length > 0) parts.push(`-> [${d.targetEntityIds.join(", ")}]`);
    parts.push(`: "${d.text}"`);
    if (d.toneHints.length > 0) parts.push(`(tone: ${d.toneHints.join(", ")})`);
    lines.push(parts.join(" "));
  }
  return { text: lines.join("\n"), parserFields: ["dialogues"] };
}

// =====================================================================
// 5) Actions
// =====================================================================

export function buildActionsSection(parsed: ParsedRpInputV1): SectionBuildResult {
  if (parsed.actions.length === 0) return { text: "", parserFields: [] };
  const lines: string[] = ["[Actions]"];
  for (const a of parsed.actions) {
    const parts = [`- ${a.actorEntityId} ${a.action}`];
    if (a.targetEntityIds.length > 0) parts.push(`-> targets=[${a.targetEntityIds.join(", ")}]`);
    if (a.objectEntityIds.length > 0) parts.push(`objects=[${a.objectEntityIds.join(", ")}]`);
    if (a.locationEntityIds.length > 0) parts.push(`locations=[${a.locationEntityIds.join(", ")}]`);
    if (a.purpose) parts.push(`purpose=${a.purpose}`);
    lines.push(parts.join(" "));
  }
  return { text: lines.join("\n"), parserFields: ["actions"] };
}

// =====================================================================
// 6) Intents
// =====================================================================

export function buildIntentsSection(parsed: ParsedRpInputV1): SectionBuildResult {
  if (parsed.intents.length === 0) return { text: "", parserFields: [] };
  const lines: string[] = ["[Intents]"];
  for (const i of parsed.intents) {
    const parts = [`- ${i.type}`];
    if (i.targetEntityIds.length > 0) parts.push(`targets=[${i.targetEntityIds.join(", ")}]`);
    lines.push(parts.join(" "));
  }
  return { text: lines.join("\n"), parserFields: ["intents"] };
}

// =====================================================================
// 7) Historical references
// =====================================================================

export function buildHistoricalReferencesSection(parsed: ParsedRpInputV1): SectionBuildResult {
  if (parsed.historicalReferences.length === 0) return { text: "", parserFields: [] };
  const lines: string[] = ["[Historical References]"];
  for (const h of parsed.historicalReferences) {
    const parts = [`- "${h.text}"`];
    if (h.entryId) parts.push(`entryId=${h.entryId}`);
    parts.push(`confidence=${h.confidence.toFixed(2)}`);
    lines.push(parts.join(" "));
  }
  return { text: lines.join("\n"), parserFields: ["historicalReferences"] };
}

// =====================================================================
// 8) Relationship signals
// =====================================================================

export function buildRelationshipSignalsSection(parsed: ParsedRpInputV1): SectionBuildResult {
  if (parsed.relationshipSignals.length === 0) return { text: "", parserFields: [] };
  const lines: string[] = ["[Relationship Signals]"];
  for (const r of parsed.relationshipSignals) {
    const parts = [`- ${r.subjectEntityId} --[${r.type}]--> ${r.objectEntityId ?? "?"}`];
    parts.push(`evidence=${r.evidence}`);
    lines.push(parts.join(" "));
  }
  return { text: lines.join("\n"), parserFields: ["relationshipSignals"] };
}

// =====================================================================
// 9) Unresolved references
// =====================================================================

export function buildUnresolvedReferencesSection(parsed: ParsedRpInputV1): SectionBuildResult {
  if (parsed.unresolvedReferences.length === 0) return { text: "", parserFields: [] };
  const lines: string[] = ["[Unresolved References]"];
  for (const u of parsed.unresolvedReferences) {
    lines.push(`- "${u.text}" (reason: ${u.reason})`);
  }
  return { text: lines.join("\n"), parserFields: ["unresolvedReferences"] };
}

// =====================================================================
// 10) Worldbook sections by retrieval source
// =====================================================================
//
// IMPORTANT: provenance is REQUIRED here. The assembler NEVER infers
// source from array order. If provenance is missing, the assembler
// throws. (Empty provenance arrays are valid; what is not valid is
// the absence of the provenance object entirely, because then we
// cannot guarantee deterministic vs semantic split.)
//
// Filtering rule: an entry goes into the section if and only if its
// id is in the corresponding provenance id list. The
// byVisibility.runtime_only entries are NEVER rendered to the prompt.

function renderLoreEntries(
  entries: WorldbookEntryV1[],
  sectionTitle: string,
  softBudgetChars: number,
): { text: string; entryIds: string[]; droppedEntryIds: string[] } {
  // Filter out runtime-only entries (they never enter the prompt)
  // then sort by entry.priority DESC (highest first), with id tiebreaker
  // for stable ordering. Sorting by priority means budget pressure
  // drops the LOWEST priority entries first, keeping the most important
  // lore visible.
  const visible = entries
    .filter((e) => e.visibility !== "runtime_only")
    .slice()
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.id.localeCompare(b.id);
    });

  if (visible.length === 0) {
    return { text: "", entryIds: [], droppedEntryIds: [] };
  }

  // Entry-level trim: include entries in priority order until we exceed
  // the section's soft char budget. Dropped entries (lowest priority)
  // are returned separately for diagnostics.
  const included: WorldbookEntryV1[] = [];
  const droppedEntryIds: string[] = [];
  let acc = `[${sectionTitle}]\n`.length;
  for (const e of visible) {
    const entryText = `- ${e.title} (id=${e.id}, category=${e.category}, priority=${e.priority})\n  ${e.content}\n`;
    if (acc + entryText.length > softBudgetChars && included.length > 0) {
      // budget would be exceeded AND we already have at least one entry;
      // keep the highest-priority entries, drop the rest
      droppedEntryIds.push(e.id);
      continue;
    }
    included.push(e);
    acc += entryText.length;
  }

  const lines: string[] = [`[${sectionTitle}]`];
  for (const e of included) {
    lines.push(`- ${e.title} (id=${e.id}, category=${e.category}, priority=${e.priority})`);
    lines.push(`  ${e.content}`);
  }
  return {
    text: lines.join("\n"),
    entryIds: included.map((e) => e.id),
    droppedEntryIds,
  };
}

export function buildLoreDirectHitSection(
  retrieval: WorldbookRetrievalResult,
  softBudgetChars: number,
): SectionBuildResult & { entryIds: string[]; droppedEntryIds: string[] } {
  if (!retrieval.provenance) {
    throw new Error(
      "rpContextAssemblerV2: worldbookRetrieval is missing provenance. " +
        "Upstream (rpSemanticExpanderV1 or equivalent) must populate it.",
    );
  }
  const idSet = new Set(retrieval.provenance.directHitIds);
  const entries = retrieval.directHits.filter((e) => idSet.has(e.id));
  const { text, entryIds, droppedEntryIds } = renderLoreEntries(
    entries,
    "Lore (Direct Hit)",
    softBudgetChars,
  );
  return {
    text,
    parserFields: [],
    retrievalSource: "directHit",
    entryIds,
    droppedEntryIds,
  };
}

export function buildLoreDeterministicExpansionSection(
  retrieval: WorldbookRetrievalResult,
  softBudgetChars: number,
): SectionBuildResult & { entryIds: string[]; droppedEntryIds: string[] } {
  if (!retrieval.provenance) {
    throw new Error(
      "rpContextAssemblerV2: worldbookRetrieval is missing provenance. " +
        "Upstream must populate it.",
    );
  }
  const idSet = new Set(retrieval.provenance.deterministicExpansionIds);
  const entries = retrieval.expandedEntries.filter((e) => idSet.has(e.id));
  const { text, entryIds, droppedEntryIds } = renderLoreEntries(
    entries,
    "Lore (Deterministic Expansion)",
    softBudgetChars,
  );
  return {
    text,
    parserFields: [],
    retrievalSource: "deterministicExpansion",
    entryIds,
    droppedEntryIds,
  };
}

export function buildLoreSemanticExpansionSection(
  retrieval: WorldbookRetrievalResult,
  softBudgetChars: number,
): SectionBuildResult & { entryIds: string[]; droppedEntryIds: string[] } {
  if (!retrieval.provenance) {
    throw new Error(
      "rpContextAssemblerV2: worldbookRetrieval is missing provenance. " +
        "Upstream must populate it.",
    );
  }
  const idSet = new Set(retrieval.provenance.semanticExpansionIds);
  const entries = retrieval.expandedEntries.filter((e) => idSet.has(e.id));
  const { text, entryIds, droppedEntryIds } = renderLoreEntries(
    entries,
    "Lore (Semantic Expansion)",
    softBudgetChars,
  );
  return {
    text,
    parserFields: [],
    retrievalSource: "semanticExpansion",
    entryIds,
    droppedEntryIds,
  };
}

// =====================================================================
// 11) System prompt (matches V1's writer-facing instruction)
// =====================================================================

export function buildSystemPromptV2(): string {
  return "You are a creative writing assistant for interactive roleplay. Continue the story naturally, maintaining character consistency and world coherence. Honor the parsed player mentions, references, dialogues, actions, intents, historical references and relationship signals shown below. Do not invent entities outside the provided worldbook and parsed input.";
}

// =====================================================================
// 11) Non-Parser context sections (B-2.9.1 parity with V1)
// =====================================================================

export function buildTimelineSection(timeline: TimelineContext | undefined): SectionBuildResult {
  if (!timeline || timeline.chapters.length === 0) {
    return { text: "", parserFields: [] };
  }
  const lines: string[] = ["[Story Timeline]"];
  for (const ch of timeline.chapters) {
    lines.push(`Chapter ${ch.chapterId} (relevance=${ch.relevanceScore}):`);
    lines.push(`  ${ch.summary}`);
  }
  for (const ev of timeline.relevantEvents) {
    lines.push(
      `- Event ${ev.eventId} (score=${ev.score}, matchedBy=[${ev.matchedBy.join(",")}]): ${ev.summary}`,
    );
  }
  return { text: lines.join("\n"), parserFields: [] };
}

export function buildTrackerSection(tracker: TrackerState | undefined): SectionBuildResult {
  if (!tracker) {
    return { text: "", parserFields: [] };
  }
  const lines: string[] = ["[Current State]"];
  if (tracker.characters.length > 0) {
    lines.push("Characters:");
    for (const c of tracker.characters) {
      const status = c.status ? ` (${c.status})` : "";
      lines.push(`  - ${c.name}${status}`);
    }
  }
  if (tracker.locations.length > 0) {
    lines.push("Locations:");
    for (const l of tracker.locations) {
      lines.push(`  - ${l.name}`);
    }
  }
  if (tracker.items.length > 0) {
    lines.push("Items:");
    for (const it of tracker.items) {
      lines.push(`  - ${it.name}`);
    }
  }
  if (tracker.timeState && Object.keys(tracker.timeState).length > 0) {
    const ts = tracker.timeState;
    const parts: string[] = [];
    if (ts.currentTime) parts.push(`time=${ts.currentTime}`);
    if (ts.day !== undefined) parts.push(`day=${ts.day}`);
    if (ts.season) parts.push(`season=${ts.season}`);
    if (parts.length > 0) lines.push(`Time: ${parts.join(", ")}`);
  }
  return { text: lines.join("\n"), parserFields: [] };
}

export function buildRecentMessagesSection(
  messages: RecentMessage[] | undefined,
  maxMessages = 6,
): SectionBuildResult {
  if (!messages || messages.length === 0) {
    return { text: "", parserFields: [] };
  }
  const sorted = [...messages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const recent = sorted.slice(-maxMessages);
  const lines: string[] = ["[Recent Messages]"];
  for (const m of recent) {
    const role = m.role === "user" ? "User" : "Assistant";
    lines.push(`${role} (${m.turnId}): "${m.text}"`);
  }
  return { text: lines.join("\n"), parserFields: [] };
}

// =====================================================================
// 12) Build the full PromptDocument
// =====================================================================

export interface V2SectionDescriptor {
  key: string;
  title: string;
  source: PromptSectionSource;
  build: (
    parsed: ParsedRpInputV1,
    retrieval: WorldbookRetrievalResult | undefined,
    softBudgetChars?: number,
  ) => SectionBuildResult & { entryIds?: string[] };
  /** Priority for budget enforcement (higher = kept first). */
  priority: number;
  /** Required input: which port must be present for this section to be added. */
  requires: "parsedRpInput" | "worldbookRetrieval" | "both" | "none";
}

export const V2_SECTION_REGISTRY: readonly V2SectionDescriptor[] = [
  {
    key: "rawUserInputSection",
    title: "User Input (raw)",
    source: "user_input",
    build: (p) => ({ ...buildRawUserInputSection(p) }),
    priority: 99,
    requires: "parsedRpInput",
  },
  {
    key: "mentionsSection",
    title: "Parsed Mentions",
    source: "user_input",
    build: (p) => ({ ...buildMentionsSection(p) }),
    priority: 90,
    requires: "parsedRpInput",
  },
  {
    key: "referencesSection",
    title: "Parsed Resolved References",
    source: "user_input",
    build: (p) => ({ ...buildReferencesSection(p) }),
    priority: 88,
    requires: "parsedRpInput",
  },
  {
    key: "dialoguesSection",
    title: "Parsed Dialogues",
    source: "user_input",
    build: (p) => ({ ...buildDialoguesSection(p) }),
    priority: 92,
    requires: "parsedRpInput",
  },
  {
    key: "actionsSection",
    title: "Parsed Actions",
    source: "user_input",
    build: (p) => ({ ...buildActionsSection(p) }),
    priority: 92,
    requires: "parsedRpInput",
  },
  {
    key: "intentsSection",
    title: "Parsed Intents",
    source: "user_input",
    build: (p) => ({ ...buildIntentsSection(p) }),
    priority: 86,
    requires: "parsedRpInput",
  },
  {
    key: "historicalReferencesSection",
    title: "Parsed Historical References",
    source: "user_input",
    build: (p) => ({ ...buildHistoricalReferencesSection(p) }),
    priority: 80,
    requires: "parsedRpInput",
  },
  {
    key: "relationshipSignalsSection",
    title: "Parsed Relationship Signals",
    source: "user_input",
    build: (p) => ({ ...buildRelationshipSignalsSection(p) }),
    priority: 80,
    requires: "parsedRpInput",
  },
  {
    key: "unresolvedReferencesSection",
    title: "Parsed Unresolved References",
    source: "user_input",
    build: (p) => ({ ...buildUnresolvedReferencesSection(p) }),
    priority: 70,
    requires: "parsedRpInput",
  },
  {
    key: "loreDirectHitSection",
    title: "Lore (Direct Hit)",
    source: "worldbook",
    build: (_p, r, sb) => buildLoreDirectHitSection(r!, sb ?? 0),
    priority: 65,
    requires: "worldbookRetrieval",
  },
  {
    key: "loreDeterministicExpansionSection",
    title: "Lore (Deterministic Expansion)",
    source: "worldbook",
    build: (_p, r, sb) => buildLoreDeterministicExpansionSection(r!, sb ?? 0),
    priority: 60,
    requires: "worldbookRetrieval",
  },
  {
    key: "loreSemanticExpansionSection",
    title: "Lore (Semantic Expansion)",
    source: "worldbook",
    build: (_p, r, sb) => buildLoreSemanticExpansionSection(r!, sb ?? 0),
    priority: 40,
    requires: "worldbookRetrieval",
  },
] as const;

/**
 * Build all V2 sections (in stable order). Returns the text per key and the
 * parserFields / retrievalSource / entryIds metadata for each section.
 * softBudgetChars controls per-lore-section entry-level trimming.
 */
export function buildAllV2Sections(
  parsed: ParsedRpInputV1 | undefined,
  retrieval: WorldbookRetrievalResult | undefined,
  softBudgetChars?: { directHit: number; deterministic: number; semantic: number },
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const desc of V2_SECTION_REGISTRY) {
    if (desc.requires === "parsedRpInput" && !parsed) continue;
    if (desc.requires === "worldbookRetrieval" && !retrieval) continue;
    if (desc.requires === "both" && (!parsed || !retrieval)) continue;
    let result: SectionBuildResult & { entryIds?: string[] };
    if (desc.key.startsWith("lore") && softBudgetChars) {
      // Entry-level trim: pass per-section char budget
      const budgetKey =
        desc.key === "loreDirectHitSection"
          ? "directHit"
          : desc.key === "loreDeterministicExpansionSection"
            ? "deterministic"
            : "semantic";
      const sb = softBudgetChars[budgetKey];
      result = desc.build(parsed!, retrieval, sb);
    } else {
      result = desc.build(parsed!, retrieval, 0);
    }
    out[desc.key] = result.text;
  }
  return out;
}

/**
 * Build the V2 PromptDocument (typed sections) with provenance stamped.
 * Drops sections with empty text. Each section's provenance records the
 * parserFields and (for lore) the retrievalSource + entryIds.
 */
export function buildV2PromptDocument(
  parsed: ParsedRpInputV1 | undefined,
  retrieval: WorldbookRetrievalResult | undefined,
): {
  sections: PromptSectionV1[];
  metadata: Map<string, { parserFields: string[]; retrievalSource?: string; entryIds?: string[] }>;
} {
  const sections: PromptSectionV1[] = [];
  const metadata = new Map<
    string,
    { parserFields: string[]; retrievalSource?: string; entryIds?: string[] }
  >();
  for (const desc of V2_SECTION_REGISTRY) {
    if (desc.requires === "parsedRpInput" && !parsed) continue;
    if (desc.requires === "worldbookRetrieval" && !retrieval) continue;
    if (desc.requires === "both" && (!parsed || !retrieval)) continue;
    const result = desc.build(parsed!, retrieval);
    if (!result.text) continue;
    const prov: PromptSectionV1["provenance"] = {};
    if (result.parserFields.length > 0) prov.parserFields = result.parserFields;
    if (result.retrievalSource) prov.retrievalSource = result.retrievalSource;
    if ("entryIds" in result && result.entryIds && result.entryIds.length > 0) {
      prov.entryIds = result.entryIds;
    }
    sections.push({
      id: desc.key,
      title: desc.title,
      source: desc.source,
      content: result.text,
      priority: desc.priority,
      visibility: "model_visible",
      trust: result.retrievalSource ? "world_data" : "user_content",
      ...(Object.keys(prov).length > 0 ? { provenance: prov } : {}),
    });
    metadata.set(desc.key, {
      parserFields: result.parserFields,
      retrievalSource: result.retrievalSource,
      entryIds: "entryIds" in result ? result.entryIds : undefined,
    });
  }
  return { sections, metadata };
}

/**
 * Compute the list of parserFields that had non-empty data, in stable order.
 * Used to populate `parserFieldsCovered` on AssembledContextV2.
 */
export function collectParserFieldsCovered(parsed: ParsedRpInputV1 | undefined): string[] {
  if (!parsed) return [];
  const out: string[] = [];
  if (parsed.rawText) out.push("rawText");
  if (parsed.mentions.length > 0) out.push("mentions");
  if (parsed.references.length > 0) out.push("references");
  if (parsed.dialogues.length > 0) out.push("dialogues");
  if (parsed.actions.length > 0) out.push("actions");
  if (parsed.intents.length > 0) out.push("intents");
  if (parsed.historicalReferences.length > 0) out.push("historicalReferences");
  if (parsed.relationshipSignals.length > 0) out.push("relationshipSignals");
  if (parsed.unresolvedReferences.length > 0) out.push("unresolvedReferences");
  return out;
}

export const V2_SECTION_PRIORITY: Record<string, number> = (() => {
  const out: Record<string, number> = {
    // systemPrompt is implicit (priority 100 in budget enforcement)
    rawUserInputSection: 99,
    mentionsSection: 90,
    referencesSection: 88,
    dialoguesSection: 92,
    actionsSection: 92,
    intentsSection: 86,
    historicalReferencesSection: 80,
    relationshipSignalsSection: 80,
    // Core character facts from runtime state (high)
    trackerSection: 73,
    // Lore by retrieval source (worldbook direct hits > deterministic > semantic)
    loreDirectHitSection: 65,
    loreDeterministicExpansionSection: 55,
    // Timeline: supplementary story context
    timelineSection: 45,
    // Semantic expansion: lowest-priority lore
    loreSemanticExpansionSection: 35,
    // Recent messages: conversational continuity
    recentMessagesSection: 30,
    // Unresolved references: low-priority diagnostics
    unresolvedReferencesSection: 20,
  };
  return out;
})();
