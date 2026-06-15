/**
 * Merge Functions — P-2 Composable Context
 *
 * Deterministic, pure merge functions for JSON, Markdown, and Text.
 * No LLM calls. No implicit conversions. No guesswork.
 */

// ============ JSON Merge ============

export type JsonMergeMode = "array-concat" | "object-shallow" | "object-deep";

export interface JsonMergeError extends Error {
  nodeId?: string;
  mode: JsonMergeMode;
  leftType: string;
  rightType: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Merge two JSON values deterministically.
 *
 * @param nodeId - For error messages
 * @param left - Left input
 * @param right - Right input
 * @param mode - Merge strategy
 * @returns Merged value
 * @throws JsonMergeError on shape mismatch
 */
export function jsonMerge(
  nodeId: string,
  left: unknown,
  right: unknown,
  mode: JsonMergeMode,
): unknown {
  switch (mode) {
    case "array-concat":
      return jsonMergeArrayConcat(nodeId, left, right);
    case "object-shallow":
      return jsonMergeObjectShallow(nodeId, left, right);
    case "object-deep":
      return jsonMergeObjectDeep(nodeId, left, right);
    default: {
      const err = new Error(`Unknown jsonMerge mode: ${mode}`) as JsonMergeError;
      err.nodeId = nodeId;
      err.mode = mode as JsonMergeMode;
      err.leftType = typeof left;
      err.rightType = typeof right;
      throw err;
    }
  }
}

function jsonMergeArrayConcat(nodeId: string, left: unknown, right: unknown): unknown[] {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    const err = new Error(
      `jsonMerge(array-concat) at "${nodeId}": both inputs must be arrays. ` +
        `Got left=${Array.isArray(left) ? "array" : typeof left}, right=${Array.isArray(right) ? "array" : typeof right}`,
    ) as JsonMergeError;
    err.nodeId = nodeId;
    err.mode = "array-concat";
    err.leftType = Array.isArray(left) ? "array" : typeof left;
    err.rightType = Array.isArray(right) ? "array" : typeof right;
    throw err;
  }
  return [...(left as unknown[]), ...(right as unknown[])];
}

function jsonMergeObjectShallow(
  nodeId: string,
  left: unknown,
  right: unknown,
): Record<string, unknown> {
  if (!isPlainObject(left) || !isPlainObject(right)) {
    const err = new Error(
      `jsonMerge(object-shallow) at "${nodeId}": both inputs must be plain objects (non-null, non-array). ` +
        `Got left=${isPlainObject(left) ? "object" : left === null ? "null" : Array.isArray(left) ? "array" : typeof left}, ` +
        `right=${isPlainObject(right) ? "object" : right === null ? "null" : Array.isArray(right) ? "array" : typeof right}`,
    ) as JsonMergeError;
    err.nodeId = nodeId;
    err.mode = "object-shallow";
    err.leftType = isPlainObject(left)
      ? "object"
      : left === null
        ? "null"
        : Array.isArray(left)
          ? "array"
          : typeof left;
    err.rightType = isPlainObject(right)
      ? "object"
      : right === null
        ? "null"
        : Array.isArray(right)
          ? "array"
          : typeof right;
    throw err;
  }
  return { ...left, ...right };
}

function jsonMergeObjectDeep(
  nodeId: string,
  left: unknown,
  right: unknown,
): Record<string, unknown> {
  if (!isPlainObject(left) || !isPlainObject(right)) {
    const err = new Error(
      `jsonMerge(object-deep) at "${nodeId}": both inputs must be plain objects (non-null, non-array). ` +
        `Got left=${isPlainObject(left) ? "object" : left === null ? "null" : Array.isArray(left) ? "array" : typeof left}, ` +
        `right=${isPlainObject(right) ? "object" : right === null ? "null" : Array.isArray(right) ? "array" : typeof right}`,
    ) as JsonMergeError;
    err.nodeId = nodeId;
    err.mode = "object-deep";
    err.leftType = isPlainObject(left)
      ? "object"
      : left === null
        ? "null"
        : Array.isArray(left)
          ? "array"
          : typeof left;
    err.rightType = isPlainObject(right)
      ? "object"
      : right === null
        ? "null"
        : Array.isArray(right)
          ? "array"
          : typeof right;
    throw err;
  }

  const result: Record<string, unknown> = { ...left };
  for (const key of Object.keys(right)) {
    const leftVal = left[key];
    const rightVal = right[key];

    if (isPlainObject(leftVal) && isPlainObject(rightVal)) {
      result[key] = jsonMergeObjectDeep(nodeId, leftVal, rightVal);
    } else {
      result[key] = rightVal;
    }
  }
  return result;
}

// ============ Markdown Merge ============

export interface MarkdownMergeOptions {
  /** Separator between blocks. Default: "\n\n". */
  separator?: string;
  /** Optional title prepended before left content. */
  leftTitle?: string;
  /** Optional title prepended before right content. */
  rightTitle?: string;
  /** If true, empty/whitespace-only blocks are skipped. Default: true. */
  skipEmpty?: boolean;
}

/**
 * Merge two Markdown strings deterministically.
 * left appears first, right appears second.
 */
export function markdownMerge(
  left: string,
  right: string,
  opts: MarkdownMergeOptions = {},
): string {
  const separator = opts.separator ?? "\n\n";
  const skipEmpty = opts.skipEmpty ?? true;

  const parts: string[] = [];

  if (left.trim().length > 0 || !skipEmpty) {
    if (opts.leftTitle) parts.push(`## ${opts.leftTitle}`);
    parts.push(left);
  }

  if (right.trim().length > 0 || !skipEmpty) {
    if (opts.rightTitle) parts.push(`## ${opts.rightTitle}`);
    parts.push(right);
  }

  return parts.join(separator);
}

// ============ Text Merge ============

export interface TextMergeOptions {
  separator?: string;
  skipEmpty?: boolean;
}

/**
 * Merge two Text strings deterministically.
 */
export function textMerge(left: string, right: string, opts: TextMergeOptions = {}): string {
  const separator = opts.separator ?? "\n";
  const skipEmpty = opts.skipEmpty ?? true;

  const parts: string[] = [];
  if (left.trim().length > 0 || !skipEmpty) parts.push(left);
  if (right.trim().length > 0 || !skipEmpty) parts.push(right);

  return parts.join(separator);
}
