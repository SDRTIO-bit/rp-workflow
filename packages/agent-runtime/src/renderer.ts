/**
 * JSON → Markdown Renderer — P-1
 *
 * Converts structured JSON data into a stable, deterministic Markdown representation
 * suitable for LLM prompt insertion. Used by the agent kernel when jsonRendererEnabled
 * is true for a data:JSON input slot.
 *
 * Properties:
 * - Deterministic: same input always produces same output
 * - Stable ordering: object keys are sorted alphabetically
 * - Safe: handles null, undefined, arrays, nested objects, and primitives
 * - Bounded: strings longer than 2000 chars are truncated with a marker
 * - No external dependencies
 */

const MAX_STRING_LENGTH = 2000;

function indent(level: number): string {
  return "  ".repeat(level);
}

function renderValue(value: unknown, level: number): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      return JSON.stringify(value.slice(0, MAX_STRING_LENGTH) + "... [truncated]");
    }
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return renderArray(value, level);
  }

  if (typeof value === "object") {
    return renderObject(value as Record<string, unknown>, level);
  }

  return String(value);
}

function renderArray(arr: unknown[], level: number): string {
  if (arr.length === 0) {
    return "[]";
  }

  const lines: string[] = [];
  for (const item of arr) {
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      // Nested object: render inline for first level, indented for deeper
      lines.push(`${indent(level)}- ${renderObjectInline(item as Record<string, unknown>)}`);
    } else if (Array.isArray(item)) {
      lines.push(`${indent(level)}- ${renderArray(item, level + 1)}`);
    } else {
      lines.push(`${indent(level)}- ${renderValue(item, level + 1)}`);
    }
  }
  return lines.join("\n");
}

function renderObjectInline(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  if (keys.length === 0) return "{}";
  const parts = keys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${k}: ${renderValuePrimitive(obj[k])}`);
  return `{ ${parts.join(", ")} }`;
}

function renderValuePrimitive(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    if (value.length > 80) return JSON.stringify(value.slice(0, 80) + "...");
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === "object") return `{${Object.keys(value as object).length} keys}`;
  return String(value);
}

function renderObject(obj: Record<string, unknown>, level: number): string {
  const keys = Object.keys(obj).sort();
  if (keys.length === 0) {
    return "{}";
  }

  const lines: string[] = [];
  for (const key of keys) {
    const value = obj[key];
    if (value === undefined) continue;

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      lines.push(`${indent(level)}**${key}**:`);
      lines.push(renderObject(value as Record<string, unknown>, level + 1));
    } else if (Array.isArray(value)) {
      lines.push(`${indent(level)}**${key}**:`);
      if (value.length === 0) {
        lines.push(`${indent(level + 1)}(empty)`);
      } else {
        for (const item of value) {
          if (typeof item === "object" && item !== null && !Array.isArray(item)) {
            lines.push(
              `${indent(level + 1)}- ${renderObjectInline(item as Record<string, unknown>)}`,
            );
          } else {
            lines.push(`${indent(level + 1)}- ${renderValue(item, level + 1)}`);
          }
        }
      }
    } else {
      lines.push(`${indent(level)}**${key}**: ${renderValue(value, level)}`);
    }
  }
  return lines.join("\n");
}

/**
 * Render arbitrary JSON data to a stable Markdown string.
 *
 * @param data - The JSON value to render (object, array, primitive, null)
 * @returns A deterministic Markdown representation
 */
export function renderJsonToMarkdown(data: unknown): string {
  if (data === null || data === undefined) {
    return "(empty)";
  }

  if (typeof data === "string") {
    return data;
  }

  if (typeof data === "number" || typeof data === "boolean") {
    return String(data);
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return "(empty array)";
    return renderArray(data, 0);
  }

  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Object.keys(obj).length === 0) return "(empty object)";
    return renderObject(obj, 0);
  }

  return String(data);
}
