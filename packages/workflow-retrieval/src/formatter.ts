/**
 * Retrieval Result → Markdown Formatter — P-4
 *
 * Converts a RetrievalResultV1 into Agent-readable Markdown.
 * Does NOT call LLM. Deterministic output.
 */
import type { RetrievalResultV1, RetrievalResultMarkdownConfig } from "./types";
import { DEFAULT_MARKDOWN_CONFIG } from "./types";

export function formatRetrievalResult(
  result: RetrievalResultV1,
  config: RetrievalResultMarkdownConfig = {},
): string {
  const cfg: Required<RetrievalResultMarkdownConfig> = {
    ...DEFAULT_MARKDOWN_CONFIG,
    ...config,
  };

  if (result.hits.length === 0) {
    if (cfg.includeEmptyMessage) {
      return cfg.emptyMessage;
    }
    return "";
  }

  const lines: string[] = [];
  if (cfg.heading) lines.push(cfg.heading + "\n");

  const maxEntries = Math.min(cfg.maxEntries, result.hits.length);

  for (let i = 0; i < maxEntries; i++) {
    const hit = result.hits[i]!;
    const entry = hit.entry;
    const title = entry.title || entry.id;

    // Heading with rank
    lines.push(`## ${hit.rank}. ${title}`);

    // Content (with truncation)
    let content = entry.content;
    if (content.length > cfg.maxCharsPerEntry) {
      content = content.slice(0, cfg.maxCharsPerEntry) + "... [truncated]";
    }
    lines.push("");
    lines.push(content);
    lines.push("");

    // Metadata line
    const metaParts: string[] = [];
    metaParts.push(`- ID: ${entry.id}`);
    if (entry.type) metaParts.push(`Type: ${entry.type}`);
    if (entry.tags && entry.tags.length > 0) metaParts.push(`Tags: ${entry.tags.join(", ")}`);
    if (cfg.includeScores) metaParts.push(`Score: ${hit.score.toFixed(3)}`);
    if (cfg.includeMetadata && entry.metadata) {
      metaParts.push(`Metadata: ${JSON.stringify(entry.metadata)}`);
    }
    lines.push(metaParts.join(" | "));
    lines.push("");
  }

  return lines.join("\n").trim();
}
