/**
 * P-12: Official RP Route
 *
 * POST /api/rp — Run an official RP turn.
 * Supports both unified-v1 (default) and legacy workflows.
 */
import { Hono } from "hono";
import type { OfficialRpRequestV1, OfficialRpServiceContext } from "../rp/officialRpTypes.js";
import { OfficialRpService, CardWorldbookError } from "../rp/officialRpService.js";

export const createRpRoutes = (getContext: () => OfficialRpServiceContext) => {
  const app = new Hono();
  let serviceCache: OfficialRpService | undefined;

  const getService = (): OfficialRpService => {
    if (!serviceCache) {
      serviceCache = new OfficialRpService(getContext());
    }
    return serviceCache;
  };

  app.post("/api/rp", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const request = body as OfficialRpRequestV1;

    // Basic presence checks before service validation
    if (!request || typeof request !== "object") {
      return c.json({ error: "Request body must be a JSON object" }, 400);
    }

    try {
      const service = getService();
      const response = await service.runTurn(request);
      return c.json(response, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // P-15.3A-2.1: Card-aware worldbook errors carry explicit status codes.
      // Checked before string-matching so the explicit code wins.
      if (error instanceof CardWorldbookError) {
        return c.json({ error: message }, error.status);
      }

      // Map error types to HTTP status codes
      if (error instanceof Error && error.name === "ValidationError") {
        return c.json({ error: message }, 400);
      }
      if (message.includes("not found") || message.includes("unknown workflow")) {
        return c.json({ error: message }, 404);
      }
      if (message.includes("conflict") || message.includes("already committed")) {
        return c.json({ error: message }, 409);
      }
      if (message.includes("validation failed") || message.includes("Invalid")) {
        return c.json({ error: message }, 422);
      }

      return c.json({ error: message }, 500);
    }
  });

  // Health check for RP service
  app.get("/api/rp/status", (c) => {
    const service = getService();
    const registry = service.getRegistry();
    return c.json({
      workflows: registry.list().map((e) => ({
        id: e.id,
        category: e.category,
        status: e.status,
        version: e.version,
      })),
    });
  });

  return app;
};
