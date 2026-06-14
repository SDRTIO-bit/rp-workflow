/**
 * Resource Resolver — binds resourceRef strings to actual data.
 *
 * Used by resourceSource nodes in workflow execution.
 * The resolver is injected at runtime (test fixtures, server stores, etc.)
 * and is NOT part of workflow-core.
 */

export type ResourceBinding = {
  resourceRef: string;
  data: unknown;
};

export type ResourceResolver = (resourceRef: string) => unknown | Promise<unknown>;

/**
 * Creates a resource resolver from a static map.
 * Useful for tests and fixtures.
 */
export function createStaticResourceResolver(bindings: Record<string, unknown>): ResourceResolver {
  return (resourceRef: string) => {
    const data = bindings[resourceRef];
    if (data === undefined) {
      throw new Error(
        `Resource not found: "${resourceRef}". Available: ${Object.keys(bindings).join(", ") || "(none)"}`,
      );
    }
    return data;
  };
}

/**
 * Creates a resourceSource executor that resolves resourceRef via a resolver.
 */
export function createResourceSourceExecutor(
  resolver: ResourceResolver,
): (input: {
  node: { config: Record<string, unknown> };
}) => Promise<{ outputs: Record<string, unknown> }> {
  return async ({ node }) => {
    const resourceRef = String(node.config.resourceRef ?? "");
    if (!resourceRef) {
      throw new Error("resourceSource: resourceRef is required");
    }
    const data = await resolver(resourceRef);
    return { outputs: { entries: data } };
  };
}
