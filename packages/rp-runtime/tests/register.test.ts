import { describe, expect, it } from "vitest";
import { registerRpRuntime } from "../src/register.js";
import type { RpRuntimeServices } from "../src/stores/types.js";
import {
  InMemoryTimelineStore,
  InMemoryChapterStore,
  InMemoryLoreStore,
  InMemoryTrackerStore,
} from "../src/stores/memory.js";

const createMockServices = (): RpRuntimeServices => ({
  stores: {
    timeline: new InMemoryTimelineStore(),
    chapter: new InMemoryChapterStore(),
    lore: new InMemoryLoreStore(),
    tracker: new InMemoryTrackerStore(),
  },
});

describe("registerRpRuntime", () => {
  it("returns catalog, executors, and schemas", () => {
    const services = createMockServices();
    const registration = registerRpRuntime(services);

    expect(registration.catalog).toBeDefined();
    expect(typeof registration.catalog).toBe("object");
    expect(registration.executors).toBeDefined();
    expect(typeof registration.executors).toBe("object");
    expect(registration.schemas).toBeDefined();
    expect(typeof registration.schemas).toBe("object");
  });

  it("returns Phase B-3 nodes in catalog and executors", () => {
    const services = createMockServices();
    const registration = registerRpRuntime(services);

    const catalogKeys = Object.keys(registration.catalog);
    expect(catalogKeys).toContain("rpInputParserV1");
    expect(catalogKeys).toContain("rpTimelineQueryV1");
    expect(catalogKeys).toContain("rpLoreRetrieverV1");
    expect(catalogKeys).toContain("rpContextAssemblerV1");
    expect(catalogKeys).toContain("rpWriterV1");
    expect(catalogKeys).toContain("rpChapterSummaryV1");
    expect(catalogKeys).toContain("rpTrackerUpdateV1");
    expect(catalogKeys).toContain("rpMemoryCommitV1");
    expect(catalogKeys).toHaveLength(8);

    const executorKeys = Object.keys(registration.executors);
    expect(executorKeys).toContain("rpInputParserV1");
    expect(executorKeys).toContain("rpTimelineQueryV1");
    expect(executorKeys).toContain("rpLoreRetrieverV1");
    expect(executorKeys).toContain("rpContextAssemblerV1");
    expect(executorKeys).toContain("rpWriterV1");
    expect(executorKeys).toContain("rpChapterSummaryV1");
    expect(executorKeys).toContain("rpTrackerUpdateV1");
    expect(executorKeys).toContain("rpMemoryCommitV1");
    expect(executorKeys).toHaveLength(8);
  });

  it("returns all schema validators", () => {
    const services = createMockServices();
    const registration = registerRpRuntime(services);

    expect(registration.schemas["rp.parsed-input.v1"]).toBeDefined();
    expect(registration.schemas["rp.timeline-context.v1"]).toBeDefined();
    expect(registration.schemas["rp.lore-context.v1"]).toBeDefined();
    expect(registration.schemas["rp.tracker-state.v1"]).toBeDefined();
    expect(registration.schemas["rp.tracker-patch.v1"]).toBeDefined();
    expect(registration.schemas["rp.memory-event.v1"]).toBeDefined();
    expect(registration.schemas["rp.assembled-context.v1"]).toBeDefined();
    expect(registration.schemas["rp.budget-report.v1"]).toBeDefined();
    expect(registration.schemas["rp.writer-output.v1"]).toBeDefined();
  });

  it("does not bind sessionId to registration (services only)", () => {
    const services = createMockServices();
    const registration = registerRpRuntime(services);

    // Verify registration is a plain object, not a closure over session state
    expect(registration.catalog).not.toHaveProperty("sessionId");
    expect(registration.executors).not.toHaveProperty("sessionId");
  });

  it("returns independent schema copies per registration", () => {
    const services = createMockServices();
    const reg1 = registerRpRuntime(services);
    const reg2 = registerRpRuntime(services);

    expect(reg1.schemas).not.toBe(reg2.schemas);
  });
});
