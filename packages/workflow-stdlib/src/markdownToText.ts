/**
 * Markdown → Text Converter — P-2
 *
 * Deterministically converts Markdown to plain text by stripping formatting.
 * Not an LLM summarizer — just removes Markdown syntax.
 */

/**
 * Convert Markdown to plain Text.
 *
 * Strips:
 * - Headers (# → plain)
 * - Bold/italic markers
 * - Code fences (keeps content)
 * - Link syntax (keeps text)
 * - Image syntax (removed)
 * - Blockquote markers
 * - List markers
 * - Horizontal rules
 *
 * Does NOT:
 * - Summarize
 * - Reformat paragraphs
 * - Call an LLM
 */
export function markdownToText(markdown: string): string {
  if (!markdown) return "";

  let text = markdown;

  // Remove images entirely ![alt](url)
  text = text.replace(/!\[.*?\]\(.*?\)/g, "");

  // Remove links, keep text: [text](url) → text
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Remove code fences (```) but keep the content
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    // Extract content between fences
    const lines = match.split("\n");
    if (lines.length <= 2) return "";
    return lines.slice(1, -1).join("\n");
  });

  // Remove inline code markers
  text = text.replace(/`([^`]+)`/g, "$1");

  // Remove bold/italic markers
  text = text.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  text = text.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
  text = text.replace(/~~([^~]+)~~/g, "$1");

  // Remove headers (# → plain)
  text = text.replace(/^#{1,6}\s+/gm, "");

  // Remove blockquote markers
  text = text.replace(/^>\s?/gm, "");

  // Remove list markers
  text = text.replace(/^[\s]*[-*+]\s+/gm, "");
  text = text.replace(/^[\s]*\d+\.\s+/gm, "");

  // Remove horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");

  // Collapse multiple blank lines
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
