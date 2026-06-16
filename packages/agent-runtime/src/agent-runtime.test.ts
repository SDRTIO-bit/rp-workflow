import { describe, expect, it } from "vitest";
import { buildPromptAssembly, executeAgentNode } from "./index.js";

const baseInput = {
  nodeId: "agent_a",
  config: {
    model: "mock-pro",
    systemPrompt: "Write with restraint.",
    skills: ["prose"],
    plugins: ["search"],
    outputType: "draft",
  },
  inputs: { text: "A quiet scene." },
  availableSkills: [
    { id: "prose", label: "Prose", content: "Use concrete sensory detail." },
    { id: "memory", label: "Memory", content: "Write long-term memory." },
  ],
  availablePlugins: [
    { id: "search", label: "Search", description: "Search context.", tools: [] },
    { id: "db_admin", label: "DB Admin", description: "Change schema.", tools: [] },
  ],
};

describe("agent runtime", () => {
  it("places stable capability context before dynamic inputs", () => {
    const assembly = buildPromptAssembly(baseInput);

    expect(assembly.fullPrompt.indexOf("System prompt")).toBeLessThan(
      assembly.fullPrompt.indexOf("Current node inputs"),
    );
    expect(assembly.visibleSkillIds).toEqual(["prose"]);
    expect(assembly.visiblePluginIds).toEqual(["search"]);
    expect(assembly.cacheablePrefix).not.toContain("db_admin");
  });

  it("keeps cache prefix stable when only dynamic inputs change", () => {
    const first = buildPromptAssembly(baseInput);
    const second = buildPromptAssembly({ ...baseInput, inputs: { text: "A louder scene." } });

    expect(first.cacheablePrefixHash).toBe(second.cacheablePrefixHash);
    expect(first.dynamicInputHash).not.toBe(second.dynamicInputHash);
  });

  it("returns deterministic mock output with metadata", async () => {
    const result = await executeAgentNode(baseInput);

    expect(result.text).toContain("[mock:mock-pro:");
    expect(result.metadata.visibleSkillIds).toEqual(["prose"]);
    expect(result.metadata.tokenUsage.availability).toBe("available");
    if (result.metadata.tokenUsage.availability !== "available") {
      throw new Error("expected available token usage");
    }
    expect(result.metadata.tokenUsage.cachedInput).toBeGreaterThan(0);
  });

  it("uses adapter streaming when a token callback is provided", async () => {
    const tokens: string[] = [];
    const result = await executeAgentNode(
      baseInput,
      {
        provider: "stream-test",
        complete: async () => {
          throw new Error("complete should not be called");
        },
        stream: async ({ onToken }) => {
          onToken?.("你");
          onToken?.("好");
          return { text: "你好", tokenUsage: { input: 2, output: 2 } };
        },
      },
      { onToken: (token) => tokens.push(token) },
    );

    expect(tokens).toEqual(["你", "好"]);
    expect(result.text).toBe("你好");
    expect(result.metadata.provider).toBe("stream-test");
  });
});
