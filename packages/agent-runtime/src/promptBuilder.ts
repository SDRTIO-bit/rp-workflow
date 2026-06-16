import type { PluginDefinition } from "@awp/plugin-sdk";
import type { AgentExecutionInput, PromptAssembly, SkillDefinition } from "./types.js";

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

export const hashText = (text: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
};

const renderSkills = (skills: SkillDefinition[]): string =>
  skills.map((skill) => `Skill ${skill.id} (${skill.label})\n${skill.content}`).join("\n\n");

const renderPlugins = (plugins: PluginDefinition[]): string =>
  plugins
    .map(
      (plugin) =>
        `Plugin ${plugin.id} (${plugin.label})\n${plugin.description}\nTools: ${plugin.tools
          .map((tool) => `${tool.id}: ${tool.description}`)
          .join("; ")}`,
    )
    .join("\n\n");

export const buildPromptAssembly = (input: AgentExecutionInput): PromptAssembly => {
  const visibleSkills = input.availableSkills.filter((skill) =>
    input.config.skills.includes(skill.id),
  );
  const visiblePlugins = input.availablePlugins.filter((plugin) =>
    input.config.plugins.includes(plugin.id),
  );

  const cacheablePrefix = [
    "Agent Workflow Platform execution protocol: follow node configuration, use only visible capabilities, and return the requested output type.",
    `Node: ${input.nodeId}`,
    `Model: ${input.config.model}`,
    `Output type: ${input.config.outputType}`,
    `System prompt:\n${input.config.systemPrompt}`,
    `Visible skills:\n${renderSkills(visibleSkills) || "none"}`,
    `Visible plugins:\n${renderPlugins(visiblePlugins) || "none"}`,
  ].join("\n\n---\n\n");

  const dynamicSuffix = [
    "Current node inputs:",
    stableStringify(input.inputs),
    "Generate the node output now.",
  ].join("\n");

  return {
    cacheablePrefix,
    dynamicSuffix,
    fullPrompt: `${cacheablePrefix}\n\n=== Dynamic Run Context ===\n\n${dynamicSuffix}`,
    cacheablePrefixHash: hashText(cacheablePrefix),
    dynamicInputHash: hashText(dynamicSuffix),
    visibleSkillIds: visibleSkills.map((skill) => skill.id),
    visiblePluginIds: visiblePlugins.map((plugin) => plugin.id),
  };
};
