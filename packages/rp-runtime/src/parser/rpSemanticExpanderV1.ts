/**
 * RP Semantic Expander V1 - Phase B-2.8
 *
 * Deterministic node that expands worldbook entries based on validated parser output.
 * Does NOT call LLM.
 *
 * Merge invariants:
 * 1. directHits has no duplicates
 * 2. expandedEntries has no duplicates
 * 3. No entry exists in both directHits and expandedEntries
 * 4. directHits priority > expandedEntries priority
 * 5. Semantically recalled entries are removed from excludedEntries
 * 6. totalEntries = directHits.length + expandedEntries.length (unique)
 * 7. byVisibility is recalculated from final merged result
 * 8. Semantic expansion limit applies to final unique semantic entries
 * 9. B-2.7 original order is preserved
 */

import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type {
  WorldbookEntryV1,
  WorldbookRetrievalProvenance,
  WorldbookRetrievalResult,
} from "../worldbook/types.js";
import type { ParsedRpInputV1 } from "./types.js";
import { expandSemantically } from "./semanticExpander.js";

/**
 * Configuration for rpSemanticExpanderV1 executor.
 */
export interface RpSemanticExpanderConfig {
  /** Maximum entries from semantic expansion. Default: 10 */
  maxSemanticEntries?: number;
}

/**
 * NodeDefinition for rpSemanticExpanderV1.
 */
export const rpSemanticExpanderV1Definition: NodeDefinition = {
  type: "rpSemanticExpanderV1",
  label: "RP Semantic Expander",
  category: "roleplay",
  description: "Expands worldbook entries based on validated parser output",
  color: "#9333ea",
  ports: [
    {
      id: "parsedInput",
      label: "Parsed Input",
      dataType: "json",
      direction: "input",
      required: true,
    },
    {
      id: "worldbookEntries",
      label: "Worldbook Entries",
      dataType: "json",
      direction: "input",
      required: true,
    },
    {
      id: "deterministicResult",
      label: "Deterministic Result",
      dataType: "json",
      direction: "input",
      required: true,
    },
    {
      id: "mergedResult",
      label: "Merged Result",
      dataType: "json",
      direction: "output",
      // B-2.9.1: this port emits a STRICT variant of WorldbookRetrievalResult
      // with provenance guaranteed populated. The basic schema
      // `rp.worldbook-retrieval-result.v1` (used by rpWorldbookRetrieverV1
      // for B-2.7 compat) is permissive about provenance being absent;
      // this strict variant requires it. V2's worldbookRetrieval input
      // port requires this strict schema, so the workflow-core validator
      // rejects bad wiring at graph-validation time (not at runtime).
      schemaId: "rp.worldbook-retrieval-result-with-provenance.v1",
    },
  ],
};

/**
 * Deduplicate entries by ID, preserving order.
 */
function deduplicateById(entries: WorldbookEntryV1[]): WorldbookEntryV1[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

/**
 * Factory function that creates the executor for rpSemanticExpanderV1.
 */
export function createRpSemanticExpanderV1Executor(services?: {
  config?: RpSemanticExpanderConfig;
}): NodeExecutor {
  const maxSemanticEntries = services?.config?.maxSemanticEntries ?? 10;

  return async (input: NodeExecutionInput) => {
    const { parsedInput, worldbookEntries, deterministicResult } = input.inputs;

    if (!parsedInput || typeof parsedInput !== "object") {
      throw new Error("rpSemanticExpanderV1: parsedInput is required");
    }

    if (!worldbookEntries || !Array.isArray(worldbookEntries)) {
      throw new Error("rpSemanticExpanderV1: worldbookEntries is required");
    }

    if (!deterministicResult || typeof deterministicResult !== "object") {
      throw new Error("rpSemanticExpanderV1: deterministicResult is required");
    }

    const parsed = parsedInput as ParsedRpInputV1;
    const entries = worldbookEntries as WorldbookEntryV1[];
    const detResult = deterministicResult as WorldbookRetrievalResult;

    // Step 1: Get deterministic entry IDs (for dedup tracking)
    const deterministicEntryIds = new Set([
      ...detResult.directHits.map((e) => e.id),
      ...detResult.expandedEntries.map((e) => e.id),
    ]);

    // Step 2: Semantic expansion
    const expansionResult = expandSemantically(parsed, entries, deterministicEntryIds);

    // Step 3: Limit semantic entries BEFORE dedup (applies to final unique semantic entries)
    const limitedSemanticEntries = expansionResult.expandedEntries.slice(0, maxSemanticEntries);

    // Step 4: Merge directHits (preserve B-2.7 order)
    const mergedDirectHits = deduplicateById([...detResult.directHits]);

    // Step 5: Merge expandedEntries (deterministic + semantic, deduplicated)
    const mergedExpandedEntries = deduplicateById([
      ...detResult.expandedEntries,
      ...limitedSemanticEntries,
    ]);

    // Step 6: Ensure no entry exists in both directHits and expandedEntries
    const directHitIds = new Set(mergedDirectHits.map((e) => e.id));
    const finalExpandedEntries = mergedExpandedEntries.filter((e) => !directHitIds.has(e.id));

    // Step 7: Handle excludedEntries - remove entries that were semantically recalled
    const expandedIds = new Set(finalExpandedEntries.map((e) => e.id));
    const finalExcludedEntries = detResult.excludedEntries.filter(
      (e) => !directHitIds.has(e.id) && !expandedIds.has(e.id),
    );

    // Step 8: Recalculate byVisibility from final merged result
    const allFinalEntries = [...mergedDirectHits, ...finalExpandedEntries];
    const byVisibility: WorldbookRetrievalResult["byVisibility"] = {
      public: allFinalEntries.filter((e) => e.visibility === "public"),
      hidden: allFinalEntries.filter((e) => e.visibility === "hidden"),
      runtime_only: allFinalEntries.filter((e) => e.visibility === "runtime_only"),
    };

    // Step 9: Calculate totalEntries (unique count)
    const totalEntries = mergedDirectHits.length + finalExpandedEntries.length;

    // Step 10 (B-2.9): Compute explicit provenance per entry.
    // Downstream consumers (rpContextAssemblerV2) MUST use this field
    // instead of inferring source from array order. The expandedEntries
    // array is a mix of deterministic and semantic expansion; the only
    // way to know which is which is via this provenance object.
    const finalExpandedIds = new Set(finalExpandedEntries.map((e) => e.id));
    const semanticIdSet = new Set(limitedSemanticEntries.map((e) => e.id));
    const deterministicExpansionIds: string[] = [];
    const semanticExpansionIds: string[] = [];
    for (const id of finalExpandedIds) {
      if (semanticIdSet.has(id)) {
        semanticExpansionIds.push(id);
      } else {
        deterministicExpansionIds.push(id);
      }
    }

    // Step 11 (B-2.9.1): Build entryTriggers map.
    // Source-priority rule (conflict): if an entry is in BOTH directHits
    // and expandedEntries (the merge above already removed it from
    // expandedEntries), it is in `mergedDirectHits`. We must STILL
    // record the parser-field triggers that the semantic expander
    // recorded for it, otherwise the conflict would silently destroy
    // provenance.
    //
    // The `expansionResult.entryTriggers` map already includes the
    // entry's parser-field triggers, even when the entry was already in
    // the deterministic set (see expandSemantically). We just copy it
    // through, keeping only entries that are present in the final
    // retrieved set (directHit + deterministic + semantic).
    const finalRetrievedIds = new Set([
      ...mergedDirectHits.map((e) => e.id),
      ...finalExpandedEntries.map((e) => e.id),
    ]);
    const entryTriggers: Record<string, string[]> = {};
    for (const [entryId, fields] of expansionResult.entryTriggers.entries()) {
      if (finalRetrievedIds.has(entryId)) {
        entryTriggers[entryId] = fields;
      }
    }

    const provenance: WorldbookRetrievalProvenance = {
      directHitIds: mergedDirectHits.map((e) => e.id),
      deterministicExpansionIds,
      semanticExpansionIds,
      entryTriggers,
    };

    // Build merged result
    const mergedResult: WorldbookRetrievalResult = {
      directHits: mergedDirectHits,
      expandedEntries: finalExpandedEntries,
      excludedEntries: finalExcludedEntries,
      activatedKeywords: detResult.activatedKeywords,
      totalEntries,
      byVisibility,
      provenance,
    };

    return { outputs: { mergedResult } };
  };
}
