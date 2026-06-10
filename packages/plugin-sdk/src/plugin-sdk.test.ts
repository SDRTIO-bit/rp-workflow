import { describe, expect, it } from "vitest";
import { validateNodePluginManifest } from "./index";

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
