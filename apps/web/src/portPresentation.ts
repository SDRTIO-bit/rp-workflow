import {
  nodeRegistry,
  type DataType,
  type NodeCatalog,
  type PortDefinition,
  type PortDirection,
} from "@awp/workflow-core";

export type DataTypePresentation = {
  labelZh: string;
  labelEn: string;
  color: string;
};

export const dataTypePresentation: Record<DataType, DataTypePresentation> = {
  text: { labelZh: "文本", labelEn: "Text", color: "#2563eb" },
  user_input: { labelZh: "用户输入", labelEn: "User input", color: "#0f766e" },
  context: { labelZh: "上下文", labelEn: "Context", color: "#7c3aed" },
  search_result: { labelZh: "检索结果", labelEn: "Search result", color: "#0891b2" },
  analysis: { labelZh: "分析", labelEn: "Analysis", color: "#4f46e5" },
  draft: { labelZh: "草稿", labelEn: "Draft", color: "#b45309" },
  final_text: { labelZh: "正文", labelEn: "Final text", color: "#dc2626" },
  debug_info: { labelZh: "调试", labelEn: "Debug", color: "#64748b" },
  json: { labelZh: "JSON", labelEn: "JSON", color: "#475569" },
  memory: { labelZh: "记忆", labelEn: "Memory", color: "#0e7490" },
  media_asset: { labelZh: "媒体资产", labelEn: "Media asset", color: "#db2777" },
  video_composition: { labelZh: "视频合成", labelEn: "Video composition", color: "#be185d" },
  ui_spec: { labelZh: "界面规格", labelEn: "UI spec", color: "#16a34a" },
  agent_tool: { labelZh: "Agent 工具", labelEn: "Agent tool", color: "#111827" },
  business_data: { labelZh: "业务数据", labelEn: "Business data", color: "#be123c" },
  character_profile: { labelZh: "角色卡", labelEn: "Character profile", color: "#a21caf" },
  scene_state: { labelZh: "场景状态", labelEn: "Scene state", color: "#7e22ce" },
};

export const getDataTypePresentation = (dataType: DataType) =>
  dataTypePresentation[dataType] ?? {
    labelZh: String(dataType),
    labelEn: String(dataType),
    color: "#64748b",
  };

export const getNodePorts = (
  nodeType: string,
  direction: PortDirection,
  catalog: NodeCatalog = nodeRegistry,
): PortDefinition[] =>
  catalog[nodeType]?.ports.filter((port) => port.direction === direction) ?? [];
