/**
 * Session Context → Markdown Converter — P-7
 *
 * Converts AgentSessionContextV1 to readable markdown for LLM context injection.
 */
import type { AgentSessionContextV1 } from "./agentSession.js";

export function sessionContextToMarkdown(ctx: AgentSessionContextV1): string {
  if (!ctx.turns || ctx.turns.length === 0) return "(No session history.)";

  const lines: string[] = ["## Session History", ""];

  for (const turn of ctx.turns) {
    const input = typeof turn.input === "string" ? turn.input : JSON.stringify(turn.input);
    const output =
      typeof turn.assistantOutput === "string"
        ? turn.assistantOutput
        : JSON.stringify(turn.assistantOutput);

    if (input) lines.push(`**Player**: ${input}`);
    if (output) lines.push(`**Agent**: ${output}`);
    lines.push("");
  }

  if (ctx.truncated) {
    lines.push("*(Earlier turns truncated due to token limits)*");
    lines.push("");
  }

  return lines.join("\n").trim();
}
