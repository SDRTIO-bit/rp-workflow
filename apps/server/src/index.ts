/**
 * Server entry point (P-14).
 *
 * Responsibilities of THIS file:
 *  - Resolve environment configuration.
 *  - Build the Hono app + runtime through the composition root.
 *  - Start the HTTP listener.
 *
 * Everything else lives in `./composition.ts`, which is the testable surface
 * used by the official `/api/rp` two-turn integration test.
 */
import { serve } from "@hono/node-server";
import { resolveEnv } from "./env.js";
import { bootstrap } from "./composition.js";

async function main(): Promise<void> {
  const env = resolveEnv();
  const composition = await bootstrap(env);
  console.log(`LLM Router: rpProvider=${composition.llm.providerId}, rpModel=${composition.llm.model}`);
  console.log(
    `LLM providers: ${composition.llm.registeredProviders.join(" ") || "none"}`,
  );

  serve({ fetch: composition.app.fetch, port: env.port }, (info) => {
    console.log(`@awp/server running at http://${info.address}:${info.port}`);
  });
}

main().catch((err) => {
  console.error("Fatal error during server startup:", err);
  process.exit(1);
});

// Re-export the composition root so tests can import the same building blocks
// the production server uses. This re-export is what the two-turn HTTP test
// relies on.
export { bootstrap } from "./composition.js";
export type { ServerComposition, CompositionAdapters } from "./composition.js";
