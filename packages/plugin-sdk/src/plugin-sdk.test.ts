import { describe, expect, it } from "vitest";
import { validateNodePluginManifest, validateSkillPluginManifest } from "./index";

describe("plugin sdk", () => {
  it("accepts a minimal node plugin manifest", () => {
    expect(
      validateNodePluginManifest({
        schemaVersion: 1,
        id: "awp.test",
        label: "Test Nodes",
        version: "0.1.0",
        permissions: ["memory:read"],
        dependencies: [{ id: "awp.base", optional: true }],
        executor: {
          adapter: "local-module",
          entry: "./executor.mjs",
        },
        nodes: [
          {
            type: "testNode",
            label: "Test Node",
            ports: [{ id: "text", label: "Text", direction: "output", dataType: "text" }],
          },
        ],
      }),
    ).toEqual([]);
  });

  it("validates a valid skill plugin manifest", () => {
    const manifest = {
      schemaVersion: 1,
      id: "awp.rp-skills",
      label: "RP Skills",
      version: "0.1.0",
      skills: [
        {
          id: "rp_persona",
          label: { zh: "角色扮演", en: "RP Persona" },
          content: { zh: "保持人设", en: "Stay in character" },
        },
      ],
    };
    expect(validateSkillPluginManifest(manifest)).toEqual([]);
  });

  it("rejects skill manifest with missing skills array", () => {
    const issues = validateSkillPluginManifest({
      schemaVersion: 1,
      id: "awp.test",
      label: "Test",
      version: "0.1.0",
    });
    expect(issues).toContain("skills must be an array");
  });

  it("rejects skill with missing label zh", () => {
    const issues = validateSkillPluginManifest({
      schemaVersion: 1,
      id: "awp.test",
      label: "Test",
      version: "0.1.0",
      skills: [
        {
          id: "bad_skill",
          label: { en: "Only English" },
          content: { zh: "内容", en: "Content" },
        },
      ],
    });
    expect(issues.length).toBeGreaterThan(0);
  });

  it("reports invalid node plugin manifests", () => {
    expect(
      validateNodePluginManifest({
        schemaVersion: 2,
        id: "",
        nodes: [{ label: "Missing Type" }],
        executor: {
          adapter: "inline",
          entry: "",
        },
      }),
    ).toEqual([
      "schemaVersion must be 1",
      "id must be a non-empty string",
      "label must be a non-empty string",
      "version must be a non-empty string",
      "nodes[0].type must be a non-empty string",
      "nodes[0].ports must be an array",
      "executor.adapter must be local-module or remote-http",
      "executor.entry must be a non-empty string",
    ]);
  });
});
