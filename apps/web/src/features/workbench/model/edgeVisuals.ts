import { isWirePort, type PortDefinition } from "@awp/workflow-core";

export type EdgeVisualClass =
  | "wire-json"
  | "wire-markdown"
  | "wire-text"
  | "legacy-json"
  | "legacy-debug"
  | "legacy-draft"
  | "legacy-data";

export const getEdgeVisualClass = (port: PortDefinition | undefined): EdgeVisualClass => {
  if (!port) return "legacy-data";
  if (isWirePort(port)) {
    return `wire-${port.wireType}` as EdgeVisualClass;
  }
  if (port.dataType === "json") return "legacy-json";
  if (port.dataType === "debug_info") return "legacy-debug";
  if (port.dataType === "draft" || port.dataType === "final_text") return "legacy-draft";
  return "legacy-data";
};

export const getEdgeVisualLabel = (port: PortDefinition | undefined): string => {
  if (!port) return "Data";
  if (isWirePort(port)) {
    if (port.wireType === "json") return "JSON";
    if (port.wireType === "markdown") return "Markdown";
    return "Text";
  }
  return port.dataType;
};
