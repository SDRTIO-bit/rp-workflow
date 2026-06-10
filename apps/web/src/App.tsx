import type { MemoryEntry } from "@awp/memory-core";
import {
  findPortInCatalog,
  nodeCategories,
  nodeRegistry,
  runWorkflow,
  validateWorkflow,
  type NodeConfigField,
  type NodeCatalog,
  type NodeRunResult,
  type PortDefinition,
  type PortDirection,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from "@awp/workflow-core";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  clampScale,
  screenToWorld,
  zoomViewportAtPoint,
  type Point,
  type Viewport,
} from "./canvasMath";
import { evaluateConnection, type ConnectionCandidate } from "./connectionRules";
import {
  addMemoryViaServer,
  deleteMemoryViaServer,
  loadMemoriesViaServer,
  updateMemoryViaServer,
} from "./memoryClient";
import { edgeDelayMs, motionStyle, nodeDelayMs } from "./motion";
import { dataTypePresentation, getNodePorts } from "./portPresentation";
import {
  disablePluginViaServer,
  enablePluginViaServer,
  loadNodeManifestsViaServer,
  loadPluginsViaServer,
  loadWorkflowTemplatesViaServer,
  runWorkflowStreamViaServer,
  runWorkflowViaServer,
  type PluginSummary,
} from "./runWorkflowClient";
import { createLocalNodeExecutors } from "./runtime/localNodeExecutors";
import {
  emptyWorkflow,
  samplePlugins,
  sampleSkills,
  workflowTemplates,
} from "./state/sampleWorkflows";
import { exportWorkflowToJson, importWorkflowFromJson } from "./workflowFile";
import { isFieldVisible, validateNodeConfigField } from "./nodeConfigValidation";
import { loadWorkflowFromStorage, saveWorkflowToStorage } from "./workflowStorage";
import {
  addWorldbookEntryViaServer,
  deleteWorldbookEntryViaServer,
  loadWorldbookEntriesViaServer,
  updateWorldbookEntryViaServer,
} from "./worldbookClient";

type Language = "zh" | "en";
type Theme = "light" | "dark";
type Draft = { title: string; content: string; tags: string };
type ConnectionDraft = {
  source: string;
  sourcePort: string;
  pointer: Point;
  hoverTarget?: { target: string; targetPort: string };
};
type CanvasMenu =
  | { kind: "node"; x: number; y: number; nodeId: string }
  | { kind: "canvas"; x: number; y: number; point: Point };

const canvasWorld = { width: 2400, height: 1400 };
const nodeWidth = 230;
const nodeBaseHeight = 116;
const portTop = 58;
const portGap = 28;
const portCenterOffset = 8;

const builtinNodeDefinitions = Object.values(nodeRegistry);

const copy = {
  zh: {
    appName: "Agent 工作流平台",
    language: "语言",
    chinese: "中文",
    english: "English",
    darkMode: "黑色护眼",
    lightMode: "浅色模式",
    tripleCheck: "格式化 + 类型检查 + 代码规范",
    run: "流式运行",
    saveWorkflow: "保存 workflow",
    loadWorkflow: "加载 workflow",
    exportWorkflow: "导出 workflow",
    importWorkflow: "导入 workflow",
    workflowTemplates: "工作流模板",
    nodes: "节点库",
    paletteHint:
      "点击创建节点；左键拖动节点；拖动画布背景平移，滚轮缩放；从输出端口按住拖到兼容输入端口完成连线。",
    inspector: "节点配置",
    node: "节点",
    type: "类型",
    model: "模型",
    text: "文本",
    query: "检索词",
    limit: "返回数量",
    systemPrompt: "系统提示词",
    skills: "可见 skill",
    plugins: "可见插件",
    validation: "工作流验证",
    validationOk: "Schema 和图结构验证通过。",
    runLog: "运行记录",
    nodeRunDetails: "节点运行详情",
    runInputs: "输入快照",
    runOutputs: "输出快照",
    runMetadata: "运行元数据",
    streamingOutput: "流式输出",
    emptyLog: "运行工作流后，这里会显示节点执行、缓存 hash 和流式顺序。",
    runtimeServer: "真实 DeepSeek Agent",
    runtimeMock: "本地 mock Agent",
    runtimeIdle: "尚未运行",
    errorTitle: "运行提示",
    memoryLibrary: "长时记忆",
    worldbookLibrary: "世界书",
    loadMemory: "读取",
    saveMemory: "新增",
    updateMemory: "更新",
    deleteMemory: "删除",
    cancelEdit: "取消",
    memoryTitle: "标题",
    memoryContent: "内容",
    memoryTags: "标签，用逗号分隔",
    memoryUnavailable: "本地服务未启动；请使用 npm run serve。",
    noMemories: "还没有内容。",
    noCacheHash: "无缓存 hash",
    savedWorkflow: "workflow 已保存到浏览器本地。",
    loadedWorkflow: "workflow 已从浏览器本地加载。",
    exportedWorkflow: "workflow 已导出为 JSON 文件。",
    importedWorkflow: "workflow 已导入，并已切换到画布。",
    importWorkflowFailed: "workflow 导入失败",
    noStoredWorkflow: "没有找到已保存的 workflow。",
    connecting: "正在连线：拖到兼容输入端口后松开。",
    fitCanvas: "适应画布",
    zoom100: "100%",
    zoomIn: "+",
    zoomOut: "-",
    deleteNode: "删除节点",
    duplicateNode: "复制节点",
    deleteEdge: "删除连线",
    addPreviewNode: "添加预览节点",
    nodePreview: "节点预览",
    externalNodeHint: "按外部扩展节点规范注册：声明端口、默认配置、预览和 mock 输出。",
  },
  en: {
    appName: "Agent Workflow Platform",
    language: "Language",
    chinese: "中文",
    english: "English",
    darkMode: "Dark eye mode",
    lightMode: "Light mode",
    tripleCheck: "formatter + tsc + linter",
    run: "Stream run",
    saveWorkflow: "Save workflow",
    loadWorkflow: "Load workflow",
    exportWorkflow: "Export workflow",
    importWorkflow: "Import workflow",
    workflowTemplates: "Workflow templates",
    nodes: "Nodes",
    paletteHint:
      "Click to create nodes. Drag nodes to move them. Drag the background to pan, wheel to zoom, and drag from output ports into compatible input ports.",
    inspector: "Inspector",
    node: "Node",
    type: "Type",
    model: "Model",
    text: "Text",
    query: "Query",
    limit: "Limit",
    systemPrompt: "System prompt",
    skills: "Skills",
    plugins: "Plugins",
    validation: "Product validation",
    validationOk: "Schema and graph validation clear.",
    runLog: "Run log",
    nodeRunDetails: "Node run details",
    runInputs: "Input snapshot",
    runOutputs: "Output snapshot",
    runMetadata: "Run metadata",
    streamingOutput: "Streaming output",
    emptyLog: "Run the workflow to inspect node execution, cache hashes, and stream order.",
    runtimeServer: "Real DeepSeek Agent",
    runtimeMock: "Local mock Agent",
    runtimeIdle: "Not run yet",
    errorTitle: "Run notice",
    memoryLibrary: "Long-term memory",
    worldbookLibrary: "Worldbook",
    loadMemory: "Load",
    saveMemory: "Add",
    updateMemory: "Update",
    deleteMemory: "Delete",
    cancelEdit: "Cancel",
    memoryTitle: "Title",
    memoryContent: "Content",
    memoryTags: "Tags, comma separated",
    memoryUnavailable: "Local server is not running; use npm run serve.",
    noMemories: "No entries yet.",
    noCacheHash: "no-cache-hash",
    savedWorkflow: "Workflow saved to browser storage.",
    loadedWorkflow: "Workflow loaded from browser storage.",
    exportedWorkflow: "Workflow exported as a JSON file.",
    importedWorkflow: "Workflow imported and loaded onto the canvas.",
    importWorkflowFailed: "Workflow import failed",
    noStoredWorkflow: "No saved workflow found.",
    connecting: "Connecting: release on a compatible input port.",
    fitCanvas: "Fit",
    zoom100: "100%",
    zoomIn: "+",
    zoomOut: "-",
    deleteNode: "Delete node",
    duplicateNode: "Duplicate node",
    deleteEdge: "Delete edge",
    addPreviewNode: "Add preview node",
    nodePreview: "Node preview",
    externalNodeHint:
      "Registered like an external extension: ports, default config, preview, and mock output.",
  },
};

const createDefaultNode = (
  type: string,
  index: number,
  nodeDefinition = nodeRegistry[type],
): WorkflowNode => ({
  id: `${type}_${Date.now()}`,
  type,
  position: { x: 120 + ((index * 130) % 940), y: 110 + ((index * 85) % 520) },
  config: { ...(nodeDefinition?.defaultConfig ?? {}) },
});

const toTags = (tags: string) =>
  tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const toDraft = (entry: MemoryEntry): Draft => ({
  title: entry.title,
  content: entry.content,
  tags: entry.tags.join(", "),
});

const emptyDraft = (): Draft => ({ title: "", content: "", tags: "" });

const getNodeHeight = (nodeType: string, catalog: NodeCatalog = nodeRegistry) => {
  const portCount = Math.max(
    getNodePorts(nodeType, "input", catalog).length,
    getNodePorts(nodeType, "output", catalog).length,
  );
  return Math.max(nodeBaseHeight, portTop + portCount * portGap + 18);
};

const getPortY = (index: number) => portTop + index * portGap + portCenterOffset;

const getPortPosition = (
  node: WorkflowNode,
  portId: string,
  direction: PortDirection,
  catalog: NodeCatalog = nodeRegistry,
): Point | undefined => {
  const ports = getNodePorts(node.type, direction, catalog);
  const portIndex = ports.findIndex((port) => port.id === portId);
  if (portIndex < 0) {
    return undefined;
  }

  return {
    x: node.position.x + (direction === "output" ? nodeWidth : 0),
    y: node.position.y + getPortY(portIndex),
  };
};

const edgePath = (start: Point, end: Point) => {
  const distance = Math.max(80, Math.abs(end.x - start.x) * 0.5);
  return `M ${start.x} ${start.y} C ${start.x + distance} ${start.y}, ${end.x - distance} ${end.y}, ${end.x} ${end.y}`;
};

const getNodeLabel = (nodeType: string, language: Language) => {
  const definition = nodeRegistry[nodeType];
  return definition?.labelI18n?.[language] ?? definition?.label ?? nodeType;
};

const getCategoryLabel = (category: string, language: Language) =>
  nodeCategories[category]?.[language] ?? category;

const stringifySnapshot = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

export function App() {
  const [workflow, setWorkflow] = useState<WorkflowDefinition>(emptyWorkflow);
  const [nodeDefinitions, setNodeDefinitions] = useState(builtinNodeDefinitions);
  const [templateDefinitions, setTemplateDefinitions] = useState(workflowTemplates);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [runs, setRuns] = useState<NodeRunResult[]>([]);
  const [streamText, setStreamText] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [runtimeMode, setRuntimeMode] = useState<"server" | "mock" | "idle">("idle");
  const [language, setLanguage] = useState<Language>("zh");
  const [theme, setTheme] = useState<Theme>("light");
  const [runNotice, setRunNotice] = useState("");
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [worldbookEntries, setWorldbookEntries] = useState<MemoryEntry[]>([]);
  const [memoryDraft, setMemoryDraft] = useState<Draft>(emptyDraft);
  const [worldbookDraft, setWorldbookDraft] = useState<Draft>(emptyDraft);
  const [editingMemoryId, setEditingMemoryId] = useState<string>();
  const [editingWorldbookId, setEditingWorldbookId] = useState<string>();
  const [viewport, setViewport] = useState<Viewport>({ x: 20, y: 55, scale: 0.72 });
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft>();
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenu>();
  const [isPanning, setIsPanning] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [pluginSummaries, setPluginSummaries] = useState<PluginSummary[]>([]);
  const [showPluginPanel, setShowPluginPanel] = useState(false);
  const [pluginPanelError, setPluginPanelError] = useState("");
  const dragRef = useRef<{ id: string; offset: Point } | undefined>(undefined);
  const panRef = useRef<
    | {
        pointerId: number;
        startClient: Point;
        startViewport: Viewport;
      }
    | undefined
  >(undefined);
  const canvasRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const runStatusByNode = useMemo(
    () => new Map(runs.map((run) => [run.nodeId, run.status])),
    [runs],
  );
  const text = copy[language];
  const nodeDefinitionsByType = useMemo(
    () => new Map(nodeDefinitions.map((definition) => [definition.type, definition])),
    [nodeDefinitions],
  );
  const runtimeNodeCatalog = useMemo(
    () => Object.fromEntries(nodeDefinitions.map((definition) => [definition.type, definition])),
    [nodeDefinitions],
  );
  const issues = useMemo(
    () => validateWorkflow(workflow, runtimeNodeCatalog),
    [runtimeNodeCatalog, workflow],
  );

  const selectedNode = workflow.nodes.find((node) => node.id === selectedNodeId);
  const selectedNodeRun = [...runs].reverse().find((run) => run.nodeId === selectedNodeId);
  const quickAddNodes = useMemo(
    () => nodeDefinitions.filter((definition) => definition.quickAdd),
    [nodeDefinitions],
  );
  const paletteByCategory = useMemo(() => {
    const groups = new Map<string, typeof nodeDefinitions>();
    for (const definition of nodeDefinitions) {
      const category = definition.category ?? "core";
      groups.set(category, [...(groups.get(category) ?? []), definition]);
    }
    return Array.from(groups.entries());
  }, [nodeDefinitions]);

  const getRuntimeNodeDefinition = (nodeType: string) =>
    nodeDefinitionsByType.get(nodeType) ?? nodeRegistry[nodeType];

  const getRuntimeNodeLabel = (nodeType: string) => {
    const definition = getRuntimeNodeDefinition(nodeType);
    return (
      definition?.labelI18n?.[language] ?? definition?.label ?? getNodeLabel(nodeType, language)
    );
  };

  const getRuntimeNodeConfigFields = (nodeType: string) =>
    getRuntimeNodeDefinition(nodeType)?.configFields ?? [];

  const loadPlugins = async () => {
    const loaded = await loadPluginsViaServer();
    if (loaded) {
      setPluginSummaries(loaded);
      setPluginPanelError("");
    } else {
      setPluginPanelError("插件服务不可用，当前使用本地内置节点。");
    }
  };

  const handleTogglePlugin = async (plugin: PluginSummary, enable: boolean) => {
    if (!enable) {
      const usedNodeTypes = workflow.nodes
        .map((n) => n.type)
        .filter((t) => plugin.nodeTypes.includes(t));
      if (usedNodeTypes.length > 0) {
        const confirmed = window.confirm(
          language === "zh"
            ? `当前工作流正在使用 ${usedNodeTypes.length} 个该插件节点，禁用后会校验失败。`
            : `The current workflow uses ${usedNodeTypes.length} nodes from this plugin. Disabling will cause validation errors.`,
        );
        if (!confirmed) return;
      }
    }

    const result = enable
      ? await enablePluginViaServer(plugin.id)
      : await disablePluginViaServer(plugin.id);

    if (!result) {
      setRunNotice(
        language === "zh"
          ? `插件 ${enable ? "启用" : "禁用"} 失败`
          : `Plugin ${enable ? "enable" : "disable"} failed`,
      );
      return;
    }

    await loadPlugins();
    const [loadedNodes] = await Promise.all([loadNodeManifestsViaServer()]);
    if (loadedNodes?.length) setNodeDefinitions(loadedNodes);
    setRunNotice(
      language === "zh"
        ? `插件 "${plugin.label}" 已${enable ? "启用" : "禁用"}。`
        : `Plugin "${plugin.label}" ${enable ? "enabled" : "disabled"}.`,
    );
  };

  useEffect(() => {
    const loadRuntimeConfiguration = async () => {
      const [loadedNodes, loadedTemplates] = await Promise.all([
        loadNodeManifestsViaServer(),
        loadWorkflowTemplatesViaServer(),
      ]);

      if (loadedNodes?.length) {
        setNodeDefinitions(loadedNodes);
      }
      if (loadedTemplates?.length) {
        setTemplateDefinitions(loadedTemplates);
      }

      await loadPlugins();
    };

    void loadRuntimeConfiguration();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpacePressed(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpacePressed(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const getScreenPoint = (event: ReactPointerEvent | ReactWheelEvent): Point => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const getWorldPoint = (event: ReactPointerEvent | ReactWheelEvent) =>
    screenToWorld(getScreenPoint(event), viewport);

  const getContextMenuWorldPoint = (event: ReactMouseEvent<HTMLDivElement>): Point => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, viewport);
  };

  const runLocalWorkflow = async () => {
    const result = await runWorkflow(
      workflow,
      createLocalNodeExecutors({ sampleSkills, samplePlugins }),
    );
    setRuns(result.nodeRuns);
    setRuntimeMode("mock");
    setRunNotice(
      language === "zh"
        ? "本地 DeepSeek 服务不可用，已回退到 mock Agent。请使用 npm run serve 运行真实 Agent。"
        : "Local DeepSeek server unavailable. Fell back to mock Agent. Use npm run serve for real agents.",
    );
  };

  const runCurrentWorkflow = async () => {
    setRuns([]);
    setStreamText("");
    setRuntimeMode("idle");
    setRunNotice("");
    setIsRunning(true);

    try {
      const streamed = await runWorkflowStreamViaServer(workflow, (event) => {
        if (event.type === "nodeRun") {
          setRuns((current) => [...current, event.run]);
        }
        if (event.type === "token") {
          setStreamText((current) => `${current}${event.token}`);
        }
      });

      if (streamed) {
        setRuntimeMode("server");
        return;
      }

      const serverResult = await runWorkflowViaServer(workflow);
      if (serverResult) {
        setRuns(serverResult.nodeRuns);
        setRuntimeMode("server");
        return;
      }

      await runLocalWorkflow();
    } finally {
      setIsRunning(false);
    }
  };

  const saveCurrentWorkflow = () => {
    saveWorkflowToStorage(workflow);
    setRunNotice(text.savedWorkflow);
  };

  const loadSavedWorkflow = () => {
    const saved = loadWorkflowFromStorage();
    if (!saved) {
      setRunNotice(text.noStoredWorkflow);
      return;
    }

    setWorkflow(saved);
    setSelectedNodeId(saved.nodes[0]?.id ?? "");
    setRunNotice(text.loadedWorkflow);
  };

  const exportCurrentWorkflow = () => {
    const blob = new Blob([exportWorkflowToJson(workflow)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${workflow.id || "workflow"}.awp.workflow.json`;
    link.click();
    URL.revokeObjectURL(url);
    setRunNotice(text.exportedWorkflow);
  };

  const importWorkflowFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    const result = importWorkflowFromJson(await file.text());
    if (!result.ok) {
      setRunNotice(`${text.importWorkflowFailed}: ${result.error}`);
      return;
    }

    setWorkflow(result.workflow);
    setSelectedNodeId(result.workflow.nodes[0]?.id ?? "");
    setRuns([]);
    setStreamText("");
    setRuntimeMode("idle");
    setRunNotice(text.importedWorkflow);
  };

  const loadWorkflowTemplate = (template: WorkflowDefinition) => {
    const nextWorkflow = structuredClone(template);
    setWorkflow(nextWorkflow);
    setSelectedNodeId(nextWorkflow.nodes[0]?.id ?? "");
    setRuns([]);
    setStreamText("");
    setRuntimeMode("idle");
    setRunNotice(language === "zh" ? "已加载工作流模板。" : "Loaded workflow template.");
  };

  const loadMemories = async () => {
    const loaded = await loadMemoriesViaServer();
    if (!loaded) {
      setRunNotice(text.memoryUnavailable);
      return;
    }
    setMemories(loaded);
    setRunNotice("");
  };

  const saveMemory = async () => {
    if (!memoryDraft.title.trim() || !memoryDraft.content.trim()) {
      return;
    }

    const payload = {
      title: memoryDraft.title.trim(),
      content: memoryDraft.content.trim(),
      tags: toTags(memoryDraft.tags),
    };
    const saved = editingMemoryId
      ? await updateMemoryViaServer(editingMemoryId, payload)
      : await addMemoryViaServer(payload);

    if (!saved) {
      setRunNotice(text.memoryUnavailable);
      return;
    }

    setMemories(saved);
    setMemoryDraft(emptyDraft());
    setEditingMemoryId(undefined);
    setRunNotice("");
  };

  const deleteMemory = async (id: string) => {
    const saved = await deleteMemoryViaServer(id);
    if (!saved) {
      setRunNotice(text.memoryUnavailable);
      return;
    }
    setMemories(saved);
    setMemoryDraft(emptyDraft());
    setEditingMemoryId(undefined);
  };

  const loadWorldbook = async () => {
    const loaded = await loadWorldbookEntriesViaServer();
    if (!loaded) {
      setRunNotice(text.memoryUnavailable);
      return;
    }
    setWorldbookEntries(loaded);
    setRunNotice("");
  };

  const saveWorldbook = async () => {
    if (!worldbookDraft.title.trim() || !worldbookDraft.content.trim()) {
      return;
    }

    const payload = {
      title: worldbookDraft.title.trim(),
      content: worldbookDraft.content.trim(),
      tags: toTags(worldbookDraft.tags),
    };
    const saved = editingWorldbookId
      ? await updateWorldbookEntryViaServer(editingWorldbookId, payload)
      : await addWorldbookEntryViaServer(payload);

    if (!saved) {
      setRunNotice(text.memoryUnavailable);
      return;
    }

    setWorldbookEntries(saved);
    setWorldbookDraft(emptyDraft());
    setEditingWorldbookId(undefined);
    setRunNotice("");
  };

  const deleteWorldbook = async (id: string) => {
    const saved = await deleteWorldbookEntryViaServer(id);
    if (!saved) {
      setRunNotice(text.memoryUnavailable);
      return;
    }
    setWorldbookEntries(saved);
    setWorldbookDraft(emptyDraft());
    setEditingWorldbookId(undefined);
  };

  const updateSelectedConfig = (key: string, value: unknown) => {
    if (!selectedNode) {
      return;
    }

    setWorkflow((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === selectedNode.id ? { ...node, config: { ...node.config, [key]: value } } : node,
      ),
    }));
  };

  const renderConfigField = (field: NodeConfigField, node: WorkflowNode) => {
    const label = field.label[language];
    const value = node.config[field.key];
    const update = (nextValue: unknown) => updateSelectedConfig(field.key, nextValue);
    const issues = validateNodeConfigField(field, value, node.config);
    const help = field.help?.[language];

    const wrapper = (inner: React.ReactNode) => (
      <label key={field.key} className={issues.length > 0 ? "field-error" : ""}>
        <span className="field-label">
          {label}
          {field.required ? <span className="required-mark">*</span> : null}
        </span>
        {help ? <span className="field-help">{help}</span> : null}
        {inner}
        {issues.map((issue, i) => (
          <span key={i} className="field-issue">
            {issue}
          </span>
        ))}
      </label>
    );

    if (field.kind === "boolean") {
      return wrapper(
        <div className="boolean-field">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => update(event.target.checked)}
          />
          <span className="boolean-label">{label}</span>
        </div>,
      );
    }

    if (field.kind === "multiselect") {
      const options: { label: string; value: string }[] = Array.isArray(field.options)
        ? field.options.map((o) =>
            typeof o === "string"
              ? { label: o, value: o }
              : { label: o.label[language], value: o.value },
          )
        : [];
      const selected: string[] = Array.isArray(value) ? value.map(String) : [];

      return wrapper(
        <div className="multiselect-field">
          {options.map((opt) => (
            <label key={opt.value} className="multiselect-option">
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={(e) => {
                  update(
                    e.target.checked
                      ? [...selected, opt.value]
                      : selected.filter((v) => v !== opt.value),
                  );
                }}
              />
              {opt.label}
            </label>
          ))}
        </div>,
      );
    }

    if (field.kind === "json") {
      const textValue = value !== undefined && value !== null ? JSON.stringify(value, null, 2) : "";
      return wrapper(
        <div className="json-field">
          <textarea
            value={textValue}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                update(parsed);
              } catch {
                update(e.target.value);
              }
            }}
          />
          <button
            className="tiny-button"
            type="button"
            onClick={() => {
              try {
                const parsed = JSON.parse(
                  typeof value === "string" ? value : JSON.stringify(value ?? {}),
                );
                update(JSON.stringify(parsed, null, 2));
              } catch {
                // Already invalid, skip format
              }
            }}
          >
            {language === "zh" ? "格式化" : "Format"}
          </button>
        </div>,
      );
    }

    if (field.kind === "secret") {
      return wrapper(
        <input
          type="password"
          autoComplete="off"
          value={String(value ?? "")}
          onChange={(event) => update(event.target.value)}
        />,
      );
    }

    if (field.kind === "model") {
      const options: { label: string; value: string }[] = Array.isArray(field.options)
        ? field.options.map((o) =>
            typeof o === "string"
              ? { label: o, value: o }
              : { label: o.label[language], value: o.value },
          )
        : [
            { label: "DeepSeek V4 Flash", value: "deepseek-v4-flash" },
            { label: "DeepSeek V4 Pro", value: "deepseek-v4-pro" },
            { label: "DeepSeek Reasoner", value: "deepseek-reasoner" },
          ];

      return wrapper(
        <select value={String(value ?? "")} onChange={(event) => update(event.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>,
      );
    }

    if (field.kind === "textarea") {
      return wrapper(
        <textarea value={String(value ?? "")} onChange={(event) => update(event.target.value)} />,
      );
    }

    if (field.kind === "number") {
      return wrapper(
        <input
          type="number"
          min={field.min}
          max={field.max}
          value={String(value ?? "")}
          onChange={(event) => update(Number(event.target.value))}
        />,
      );
    }

    if (field.kind === "select") {
      const options: { label: string; value: string }[] = Array.isArray(field.options)
        ? field.options.map((o) =>
            typeof o === "string"
              ? { label: o, value: o }
              : { label: o.label[language], value: o.value },
          )
        : [];
      return wrapper(
        <select value={String(value ?? "")} onChange={(event) => update(event.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>,
      );
    }

    if (field.kind === "tags") {
      return wrapper(
        <input
          value={Array.isArray(value) ? value.map(String).join(", ") : String(value ?? "")}
          onChange={(event) => update(toTags(event.target.value))}
        />,
      );
    }

    return wrapper(
      <input value={String(value ?? "")} onChange={(event) => update(event.target.value)} />,
    );
  };

  const renderNodeSummary = (node: WorkflowNode) => {
    const summaryFields = getRuntimeNodeConfigFields(node.type)
      .slice(0, 2)
      .map((field) => node.config[field.key])
      .filter((value) => value !== undefined && value !== "" && !Array.isArray(value))
      .map(String);

    return summaryFields.length > 0 ? (
      <span className="node-meta">{summaryFields.join(" / ")}</span>
    ) : null;
  };

  const addNode = (type: string, position?: Point) => {
    setWorkflow((current) => {
      const node = createDefaultNode(type, current.nodes.length, getRuntimeNodeDefinition(type));
      if (position) {
        node.position = {
          x: Math.max(0, Math.min(canvasWorld.width - nodeWidth, position.x)),
          y: Math.max(
            0,
            Math.min(canvasWorld.height - getNodeHeight(type, runtimeNodeCatalog), position.y),
          ),
        };
      }
      setSelectedNodeId(node.id);
      return { ...current, nodes: [...current.nodes, node] };
    });
    setCanvasMenu(undefined);
  };

  const deleteNode = (nodeId: string) => {
    setWorkflow((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
    }));
    setSelectedNodeId((current) => (current === nodeId ? "" : current));
    setCanvasMenu(undefined);
  };

  const duplicateNode = (nodeId: string) => {
    setWorkflow((current) => {
      const source = current.nodes.find((node) => node.id === nodeId);
      if (!source) {
        return current;
      }

      const node: WorkflowNode = {
        ...source,
        id: `${source.type}_${Date.now()}`,
        position: {
          x: Math.min(canvasWorld.width - nodeWidth, source.position.x + 42),
          y: Math.min(
            canvasWorld.height - getNodeHeight(source.type, runtimeNodeCatalog),
            source.position.y + 42,
          ),
        },
        config: { ...source.config },
      };
      setSelectedNodeId(node.id);
      return { ...current, nodes: [...current.nodes, node] };
    });
    setCanvasMenu(undefined);
  };

  const deleteEdge = (edgeId: string) => {
    setWorkflow((current) => ({
      ...current,
      edges: current.edges.filter((edge) => edge.id !== edgeId),
    }));
  };

  const startNodeDrag = (event: ReactPointerEvent<HTMLElement>, node: WorkflowNode) => {
    const target = event.target as HTMLElement;
    if (target.closest(".port-button")) {
      return;
    }
    setCanvasMenu(undefined);

    const worldPoint = getWorldPoint(event);
    dragRef.current = {
      id: node.id,
      offset: { x: worldPoint.x - node.position.x, y: worldPoint.y - node.position.y },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveNodeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) {
      return;
    }

    const worldPoint = getWorldPoint(event);
    const nextX = Math.max(
      0,
      Math.min(canvasWorld.width - nodeWidth, worldPoint.x - dragRef.current.offset.x),
    );
    const nextY = Math.max(
      0,
      Math.min(canvasWorld.height - 120, worldPoint.y - dragRef.current.offset.y),
    );

    setWorkflow((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === dragRef.current?.id ? { ...node, position: { x: nextX, y: nextY } } : node,
      ),
    }));
  };

  const finishNodeDrag = () => {
    dragRef.current = undefined;
  };

  const startCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const backgroundTarget =
      target === event.currentTarget || target.classList.contains("canvas-world");
    const shouldPan = event.button === 1 || spacePressed || backgroundTarget;

    if (!shouldPan || target.closest(".canvas-node, .port-button, .canvas-control")) {
      return;
    }
    setCanvasMenu(undefined);

    panRef.current = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startViewport: viewport,
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panRef.current) {
      return;
    }

    const dx = event.clientX - panRef.current.startClient.x;
    const dy = event.clientY - panRef.current.startClient.y;
    setViewport({
      ...panRef.current.startViewport,
      x: panRef.current.startViewport.x + dx,
      y: panRef.current.startViewport.y + dy,
    });
  };

  const finishCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = undefined;
      setIsPanning(false);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    moveCanvasPan(event);
    moveNodeDrag(event);

    if (connectionDraft) {
      const pointer = getWorldPoint(event);
      setConnectionDraft((current) => (current ? { ...current, pointer } : current));
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    finishCanvasPan(event);
    finishNodeDrag();
    if (connectionDraft) {
      setConnectionDraft(undefined);
      setRunNotice("");
    }
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setCanvasMenu(undefined);
    const direction = event.deltaY > 0 ? -1 : 1;
    const nextScale = viewport.scale * (direction > 0 ? 1.12 : 0.88);
    setViewport(zoomViewportAtPoint(viewport, getScreenPoint(event), nextScale));
  };

  const zoomBy = (ratio: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const anchor = rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 };
    setViewport((current) => zoomViewportAtPoint(current, anchor, current.scale * ratio));
  };

  const resetZoom = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const center = rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 };
    setViewport((current) => zoomViewportAtPoint(current, center, 1));
  };

  const fitCanvas = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || workflow.nodes.length === 0) {
      setViewport({ x: 36, y: 28, scale: 1 });
      return;
    }

    const bounds = workflow.nodes.reduce(
      (current, node) => ({
        minX: Math.min(current.minX, node.position.x),
        minY: Math.min(current.minY, node.position.y),
        maxX: Math.max(current.maxX, node.position.x + nodeWidth),
        maxY: Math.max(
          current.maxY,
          node.position.y + getNodeHeight(node.type, runtimeNodeCatalog),
        ),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const padding = 90;
    const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
    const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
    const scale = clampScale(
      Math.min((rect.width - padding) / boundsWidth, (rect.height - padding) / boundsHeight),
    );

    setViewport({
      x: (rect.width - boundsWidth * scale) / 2 - bounds.minX * scale,
      y: (rect.height - boundsHeight * scale) / 2 - bounds.minY * scale,
      scale,
    });
  };

  const startConnection = (
    event: ReactPointerEvent<HTMLButtonElement>,
    node: WorkflowNode,
    port: PortDefinition,
  ) => {
    event.stopPropagation();
    setConnectionDraft({
      source: node.id,
      sourcePort: port.id,
      pointer: getWorldPoint(event),
    });
    setRunNotice(text.connecting);
  };

  const finishConnection = (
    event: ReactPointerEvent<HTMLButtonElement>,
    node: WorkflowNode,
    port: PortDefinition,
  ) => {
    event.stopPropagation();
    if (!connectionDraft) {
      return;
    }

    const candidate: ConnectionCandidate = {
      source: connectionDraft.source,
      sourcePort: connectionDraft.sourcePort,
      target: node.id,
      targetPort: port.id,
    };
    const evaluation = evaluateConnection(workflow, candidate, runtimeNodeCatalog);
    if (!evaluation.ok) {
      setRunNotice(evaluation.reason);
      setConnectionDraft(undefined);
      return;
    }

    const edge: WorkflowEdge = {
      id: `edge_${Date.now()}`,
      ...candidate,
    };

    setWorkflow((current) => ({ ...current, edges: [...current.edges, edge] }));
    setConnectionDraft(undefined);
    setRunNotice("");
  };

  const setHoverTarget = (node: WorkflowNode, port: PortDefinition, enabled: boolean) => {
    if (!connectionDraft) {
      return;
    }

    setConnectionDraft((current) =>
      current
        ? {
            ...current,
            hoverTarget: enabled ? { target: node.id, targetPort: port.id } : undefined,
          }
        : current,
    );
  };

  const renderEdges = () =>
    workflow.edges.map((edge, edgeIndex) => {
      const source = workflow.nodes.find((node) => node.id === edge.source);
      const target = workflow.nodes.find((node) => node.id === edge.target);
      if (!source || !target) {
        return null;
      }

      const start = getPortPosition(source, edge.sourcePort, "output", runtimeNodeCatalog);
      const end = getPortPosition(target, edge.targetPort, "input", runtimeNodeCatalog);
      const sourcePort = findPortInCatalog(
        runtimeNodeCatalog,
        source.type,
        edge.sourcePort,
        "output",
      );
      if (!start || !end || !sourcePort) {
        return null;
      }

      const middleX = (start.x + end.x) / 2;
      const middleY = (start.y + end.y) / 2;

      return (
        <g key={edge.id}>
          <path
            className="edge-path"
            d={edgePath(start, end)}
            fill="none"
            stroke={dataTypePresentation[sourcePort.dataType].color}
            strokeWidth="2.5"
            pathLength={1}
            style={motionStyle("--edge-delay", edgeDelayMs(edgeIndex))}
          />
          <text x={middleX - 34} y={middleY - 6} className="edge-label">
            {edge.sourcePort} → {edge.targetPort}
          </text>
          <g className="edge-action" transform={`translate(${middleX + 22} ${middleY - 18})`}>
            <rect width="22" height="18" rx="5" />
            <text x="11" y="13" textAnchor="middle" onClick={() => deleteEdge(edge.id)}>
              ×
            </text>
          </g>
        </g>
      );
    });

  const renderConnectionPreview = () => {
    if (!connectionDraft) {
      return null;
    }

    const source = workflow.nodes.find((node) => node.id === connectionDraft.source);
    if (!source) {
      return null;
    }

    const start = getPortPosition(source, connectionDraft.sourcePort, "output", runtimeNodeCatalog);
    const sourcePort = findPortInCatalog(
      runtimeNodeCatalog,
      source.type,
      connectionDraft.sourcePort,
      "output",
    );
    if (!start || !sourcePort) {
      return null;
    }

    return (
      <path
        className="connection-preview"
        d={edgePath(start, connectionDraft.pointer)}
        fill="none"
        stroke={dataTypePresentation[sourcePort.dataType].color}
        strokeWidth="3"
      />
    );
  };

  const portCompatibilityClass = (node: WorkflowNode, port: PortDefinition) => {
    if (!connectionDraft || port.direction !== "input") {
      return "";
    }

    const evaluation = evaluateConnection(
      workflow,
      {
        source: connectionDraft.source,
        sourcePort: connectionDraft.sourcePort,
        target: node.id,
        targetPort: port.id,
      },
      runtimeNodeCatalog,
    );

    return evaluation.ok ? "port-compatible" : "port-incompatible";
  };

  return (
    <main
      className={`app-shell theme-${theme} ${isRunning ? "app-running" : ""}`}
      lang={language === "zh" ? "zh-CN" : "en"}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">AWP</span>
          <span>{text.appName}</span>
        </div>

        <label className="toolbar-select">
          <span>{text.language}</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value as Language)}
          >
            <option value="zh">{text.chinese}</option>
            <option value="en">{text.english}</option>
          </select>
        </label>

        <button
          className="secondary-button"
          type="button"
          onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        >
          <span>{theme === "dark" ? "L" : "D"}</span>
          {theme === "dark" ? text.lightMode : text.darkMode}
        </button>

        <button className="secondary-button" type="button" onClick={saveCurrentWorkflow}>
          {text.saveWorkflow}
        </button>

        <button className="secondary-button" type="button" onClick={loadSavedWorkflow}>
          {text.loadWorkflow}
        </button>

        <button className="secondary-button" type="button" onClick={exportCurrentWorkflow}>
          {text.exportWorkflow}
        </button>

        <button
          className="secondary-button"
          type="button"
          onClick={() => importInputRef.current?.click()}
        >
          {text.importWorkflow}
        </button>

        <input
          ref={importInputRef}
          className="visually-hidden-file"
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            void importWorkflowFile(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />

        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            void loadPlugins();
            setShowPluginPanel(true);
          }}
        >
          {language === "zh" ? "插件" : "Plugins"}
        </button>

        <button className="secondary-button" type="button">
          {text.tripleCheck}
        </button>

        <button className="primary-button" type="button" onClick={runCurrentWorkflow}>
          <span>▶</span>
          {text.run}
        </button>
      </header>

      <section className="workspace">
        <aside className="palette panel">
          <details className="template-drawer">
            <summary>{text.workflowTemplates}</summary>
            <div className="template-list">
              {templateDefinitions.map((template) => (
                <button
                  key={template.id}
                  className="template-button"
                  type="button"
                  onClick={() => loadWorkflowTemplate(template.workflow)}
                >
                  <strong>{template.label[language]}</strong>
                  <span>{template.description[language]}</span>
                </button>
              ))}
            </div>
          </details>

          <h2>{text.nodes}</h2>
          {paletteByCategory.map(([category, definitions]) => (
            <section key={category} className="palette-group">
              <h3>{getCategoryLabel(category, language)}</h3>
              {definitions.map((definition) => (
                <button
                  key={definition.type}
                  className="node-pill"
                  type="button"
                  onClick={() => addNode(definition.type)}
                  title={definition.description}
                >
                  <span
                    className="node-pill-dot"
                    style={{ "--node-color": definition.color ?? "#64748b" } as CSSProperties}
                  />
                  <span>{getRuntimeNodeLabel(definition.type)}</span>
                </button>
              ))}
            </section>
          ))}
          <div className="hint">{text.paletteHint}</div>
        </aside>

        <section className={`canvas-wrap ${isPanning ? "canvas-pan-active" : ""}`}>
          <div className="canvas-controls">
            <button className="canvas-control" type="button" onClick={fitCanvas}>
              {text.fitCanvas}
            </button>
            <button className="canvas-control" type="button" onClick={resetZoom}>
              {text.zoom100}
            </button>
            <button
              className="canvas-control icon-control"
              type="button"
              onClick={() => zoomBy(1.15)}
            >
              {text.zoomIn}
            </button>
            <button
              className="canvas-control icon-control"
              type="button"
              onClick={() => zoomBy(0.85)}
            >
              {text.zoomOut}
            </button>
            <span className="zoom-readout">{Math.round(viewport.scale * 100)}%</span>
          </div>
          <div
            ref={canvasRef}
            className={`workflow-canvas ${spacePressed ? "canvas-space-pan" : ""}`}
            onWheel={handleWheel}
            onPointerDown={startCanvasPan}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={finishNodeDrag}
            onContextMenu={(event) => {
              event.preventDefault();
              const target = event.target as HTMLElement;
              const nodeElement = target.closest<HTMLElement>(".canvas-node");
              const nodeId = nodeElement?.dataset.nodeId;
              setCanvasMenu(
                nodeId
                  ? { kind: "node", x: event.clientX, y: event.clientY, nodeId }
                  : {
                      kind: "canvas",
                      x: event.clientX,
                      y: event.clientY,
                      point: getContextMenuWorldPoint(event),
                    },
              );
            }}
            tabIndex={0}
          >
            <div
              className="canvas-world"
              style={
                {
                  width: canvasWorld.width,
                  height: canvasWorld.height,
                  transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
                } as CSSProperties
              }
            >
              <svg
                className="edge-layer"
                viewBox={`0 0 ${canvasWorld.width} ${canvasWorld.height}`}
                aria-hidden="true"
              >
                {renderEdges()}
                {renderConnectionPreview()}
              </svg>

              {workflow.nodes.map((node, nodeIndex) => {
                const inputPorts = getNodePorts(node.type, "input", runtimeNodeCatalog);
                const outputPorts = getNodePorts(node.type, "output", runtimeNodeCatalog);

                return (
                  <article
                    key={node.id}
                    className={`canvas-node ${selectedNodeId === node.id ? "selected" : ""} ${
                      runStatusByNode.has(node.id) ? `run-${runStatusByNode.get(node.id)}` : ""
                    }`}
                    style={
                      {
                        "--node-color": getRuntimeNodeDefinition(node.type)?.color ?? "#64748b",
                        ...motionStyle("--node-delay", nodeDelayMs(nodeIndex)),
                        left: node.position.x,
                        top: node.position.y,
                        minHeight: getNodeHeight(node.type, runtimeNodeCatalog),
                      } as CSSProperties
                    }
                    onClick={() => setSelectedNodeId(node.id)}
                    onPointerDown={(event) => startNodeDrag(event, node)}
                    data-node-id={node.id}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="node-type">{getRuntimeNodeLabel(node.type)}</span>
                    <strong>{node.id}</strong>
                    {renderNodeSummary(node)}
                    {getRuntimeNodeDefinition(node.type)?.preview ? (
                      <span className="node-meta">
                        {getRuntimeNodeDefinition(node.type)?.preview}
                      </span>
                    ) : null}
                    <PortList
                      direction="input"
                      ports={inputPorts}
                      language={language}
                      node={node}
                      connectionDraft={connectionDraft}
                      compatibilityClass={portCompatibilityClass}
                      onFinishConnection={finishConnection}
                      onHover={setHoverTarget}
                    />
                    <PortList
                      direction="output"
                      ports={outputPorts}
                      language={language}
                      node={node}
                      connectionDraft={connectionDraft}
                      compatibilityClass={portCompatibilityClass}
                      onStartConnection={startConnection}
                      onHover={setHoverTarget}
                    />
                  </article>
                );
              })}
              {canvasMenu ? (
                <div
                  className="context-menu"
                  style={{ left: canvasMenu.x, top: canvasMenu.y } as CSSProperties}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {canvasMenu.kind === "node" ? (
                    <>
                      <button type="button" onClick={() => duplicateNode(canvasMenu.nodeId)}>
                        {text.duplicateNode}
                      </button>
                      <button type="button" onClick={() => deleteNode(canvasMenu.nodeId)}>
                        {text.deleteNode}
                      </button>
                    </>
                  ) : (
                    <>
                      {quickAddNodes.map((definition) => (
                        <button
                          key={definition.type}
                          type="button"
                          onClick={() => addNode(definition.type, canvasMenu.point)}
                        >
                          {getRuntimeNodeLabel(definition.type)}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="inspector panel">
          <h2>{text.inspector}</h2>
          {selectedNode ? (
            <div className="field-stack">
              <label>
                {text.node}
                <input value={selectedNode.id} readOnly />
              </label>
              <label>
                {text.type}
                <input value={getRuntimeNodeLabel(selectedNode.type)} readOnly />
              </label>
              <section className="node-preview-panel">
                <strong>{text.nodePreview}</strong>
                <p>
                  {getRuntimeNodeDefinition(selectedNode.type)?.description ??
                    text.externalNodeHint}
                </p>
                <span>
                  {getRuntimeNodeDefinition(selectedNode.type)?.preview ?? text.externalNodeHint}
                </span>
              </section>
              {(() => {
                const definition = getRuntimeNodeDefinition(selectedNode.type);
                const presets = definition?.presets;
                const allFields = getRuntimeNodeConfigFields(selectedNode.type);
                const visibleFields = allFields.filter((f) =>
                  isFieldVisible(f, selectedNode.config),
                );
                const basicFields = visibleFields.filter((f) => !f.advanced);
                const advancedFields = visibleFields.filter((f) => f.advanced);

                // Group advanced fields by group
                const advancedGroups = new Map<string, NodeConfigField[]>();
                for (const f of advancedFields) {
                  const g = f.group ?? "";
                  advancedGroups.set(g, [...(advancedGroups.get(g) ?? []), f]);
                }

                return (
                  <>
                    {presets?.length ? (
                      <div className="preset-bar">
                        {presets.map((preset) => (
                          <button
                            key={preset.id}
                            className="preset-button"
                            type="button"
                            title={preset.description?.[language]}
                            onClick={() => {
                              for (const [k, v] of Object.entries(preset.config)) {
                                updateSelectedConfig(k, v);
                              }
                            }}
                          >
                            {preset.label[language]}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {basicFields.map((field) => renderConfigField(field, selectedNode))}
                    {advancedFields.length > 0 ? (
                      <details className="advanced-params">
                        <summary>
                          {language === "zh" ? "高级参数" : "Advanced"} ({advancedFields.length})
                        </summary>
                        {Array.from(advancedGroups.entries()).map(([group, fields]) => (
                          <div key={group} className="advanced-group">
                            {group ? (
                              <h4 className="advanced-group-title">
                                {fields[0]?.groupLabel?.[language] ?? group}
                              </h4>
                            ) : null}
                            {fields.map((field) => renderConfigField(field, selectedNode))}
                          </div>
                        ))}
                      </details>
                    ) : null}
                  </>
                );
              })()}
              {selectedNodeRun ? (
                <section className="node-run-details">
                  <strong>{text.nodeRunDetails}</strong>
                  <div className="run-timing">
                    <span className={`run-status-badge run-${selectedNodeRun.status}`}>
                      {selectedNodeRun.status === "success"
                        ? "✓"
                        : selectedNodeRun.status === "error"
                          ? "✕"
                          : "⊘"}
                    </span>
                    <span>
                      {language === "zh" ? "耗时 " : "Duration "}
                      {Math.max(0, selectedNodeRun.endedAt - selectedNodeRun.startedAt) < 1000
                        ? `${Math.max(0, selectedNodeRun.endedAt - selectedNodeRun.startedAt)}ms`
                        : `${((selectedNodeRun.endedAt - selectedNodeRun.startedAt) / 1000).toFixed(1)}s`}
                    </span>
                  </div>
                  <SnapshotBlock title={text.runInputs} value={selectedNodeRun.inputs} />
                  <SnapshotBlock title={text.runOutputs} value={selectedNodeRun.outputs} />
                  <SnapshotBlock title={text.runMetadata} value={selectedNodeRun.metadata ?? {}} />
                </section>
              ) : null}
            </div>
          ) : null}

          <EntryPanel
            title={text.memoryLibrary}
            entries={memories}
            draft={memoryDraft}
            editingId={editingMemoryId}
            text={text}
            onDraftChange={setMemoryDraft}
            onLoad={loadMemories}
            onSave={saveMemory}
            onCancel={() => {
              setMemoryDraft(emptyDraft());
              setEditingMemoryId(undefined);
            }}
            onSelect={(entry) => {
              setEditingMemoryId(entry.id);
              setMemoryDraft(toDraft(entry));
            }}
            onDelete={deleteMemory}
          />

          <EntryPanel
            title={text.worldbookLibrary}
            entries={worldbookEntries}
            draft={worldbookDraft}
            editingId={editingWorldbookId}
            text={text}
            onDraftChange={setWorldbookDraft}
            onLoad={loadWorldbook}
            onSave={saveWorldbook}
            onCancel={() => {
              setWorldbookDraft(emptyDraft());
              setEditingWorldbookId(undefined);
            }}
            onSelect={(entry) => {
              setEditingWorldbookId(entry.id);
              setWorldbookDraft(toDraft(entry));
            }}
            onDelete={deleteWorldbook}
          />
        </aside>
      </section>

      <section className="bottom-dock">
        <div className="panel validation">
          <h2>{text.validation}</h2>
          {issues.length === 0 ? (
            <p className="ok">{text.validationOk}</p>
          ) : (
            issues.map((issue) => <p key={issue.message}>{issue.message}</p>)
          )}
          {runNotice ? (
            <p className="notice">
              <strong>{text.errorTitle}: </strong>
              {runNotice}
            </p>
          ) : null}
        </div>
        <div className="panel run-log">
          <div className="panel-heading">
            <h2>{text.runLog}</h2>
            <span className={`runtime-badge runtime-${runtimeMode}`}>
              {runtimeMode === "server"
                ? text.runtimeServer
                : runtimeMode === "mock"
                  ? text.runtimeMock
                  : text.runtimeIdle}
            </span>
          </div>
          {runs.length === 0 ? (
            <p className="muted">{text.emptyLog}</p>
          ) : (
            runs.map((run, index) => (
              <button
                key={`${run.nodeId}-${index}`}
                className={`run-row ${selectedNodeId === run.nodeId ? "selected-run-row" : ""}`}
                type="button"
                onClick={() => setSelectedNodeId(run.nodeId)}
              >
                <strong>{run.nodeId}</strong>
                <span>{run.status}</span>
                <span className="run-duration">
                  {Math.max(0, run.endedAt - run.startedAt) < 1000
                    ? `${Math.max(0, run.endedAt - run.startedAt)}ms`
                    : `${((run.endedAt - run.startedAt) / 1000).toFixed(1)}s`}
                </span>
                <code>{String(run.metadata?.cacheablePrefixHash ?? text.noCacheHash)}</code>
              </button>
            ))
          )}
          {streamText ? (
            <div className="stream-output">
              <strong>{text.streamingOutput}</strong>
              <p>{streamText}</p>
            </div>
          ) : null}
        </div>
      </section>

      {showPluginPanel ? (
        <div className="modal-overlay" onClick={() => setShowPluginPanel(false)}>
          <div className="modal-content plugin-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{language === "zh" ? "插件管理" : "Plugin Management"}</h2>
              <button
                className="modal-close"
                type="button"
                onClick={() => setShowPluginPanel(false)}
              >
                ×
              </button>
            </div>
            {pluginPanelError ? (
              <p className="notice">{pluginPanelError}</p>
            ) : pluginSummaries.length === 0 ? (
              <p className="muted">
                {language === "zh" ? "没有已安装的插件。" : "No plugins installed."}
              </p>
            ) : (
              <div className="plugin-card-list">
                {pluginSummaries.map((plugin) => (
                  <div
                    key={plugin.id}
                    className={`plugin-card ${plugin.enabled ? "" : "plugin-disabled"}`}
                  >
                    <div className="plugin-card-header">
                      <strong>{plugin.label}</strong>
                      <span className="plugin-version">v{plugin.version}</span>
                      <span
                        className={`plugin-status ${plugin.enabled ? "status-on" : "status-off"}`}
                      >
                        {plugin.enabled
                          ? language === "zh"
                            ? "✓ 启用"
                            : "✓ On"
                          : language === "zh"
                            ? "✕ 禁用"
                            : "✕ Off"}
                      </span>
                    </div>
                    <p className="plugin-state-source">
                      {plugin.enabled && plugin.stateSource === "manifest" && "默认启用"}
                      {!plugin.enabled && plugin.stateSource === "manifest" && "默认禁用"}
                      {plugin.enabled && plugin.stateSource === "user" && "用户手动启用"}
                      {!plugin.enabled && plugin.stateSource === "user" && "用户手动禁用"}
                    </p>
                    {plugin.description ? (
                      <p className="plugin-desc">{plugin.description}</p>
                    ) : null}
                    <div className="plugin-perms">
                      {plugin.permissions.map((perm) => (
                        <code key={perm} className="perm-tag">
                          {perm}
                        </code>
                      ))}
                    </div>
                    <p className="plugin-node-types">
                      {language === "zh" ? "节点: " : "Nodes: "}
                      {plugin.nodeTypes.slice(0, 3).join(", ")}
                      {plugin.nodeTypes.length > 3 ? ` +${plugin.nodeTypes.length - 3}` : ""}
                    </p>
                    <div className="plugin-card-actions">
                      {plugin.enabled ? (
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => handleTogglePlugin(plugin, false)}
                        >
                          {language === "zh" ? "禁用" : "Disable"}
                        </button>
                      ) : (
                        <button
                          className="primary-button"
                          type="button"
                          onClick={() => handleTogglePlugin(plugin, true)}
                        >
                          {language === "zh" ? "启用" : "Enable"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function SnapshotBlock({ title, value }: { title: string; value: unknown }) {
  const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
  const views =
    isObject && "views" in value && Array.isArray((value as Record<string, unknown>).views)
      ? (
          value as {
            views: Array<{ id: string; kind: string; title: string; [key: string]: unknown }>;
          }
        ).views
      : undefined;

  return (
    <details className="snapshot-block">
      <summary>{title}</summary>
      {views ? <MetadataViews views={views} /> : <pre>{stringifySnapshot(value)}</pre>}
    </details>
  );
}

function MetadataViews({
  views,
}: {
  views: Array<{ id: string; kind: string; title: string; [key: string]: unknown }>;
}) {
  const [copiedId, setCopiedId] = useState<string>();

  const copyViewContent = async (view: {
    id: string;
    kind: string;
    title: string;
    [key: string]: unknown;
  }) => {
    let text: string;
    switch (view.kind) {
      case "entry-list":
        text = (view.items as Array<{ title: string; summary?: string }>)
          .map((item) => `${item.title}${item.summary ? `: ${item.summary}` : ""}`)
          .join("\n");
        break;
      case "code":
      case "text":
        text = String(view.content ?? "");
        break;
      case "stats":
        text = (view.pairs as Array<{ label: string; value: unknown }>)
          .map((pair) => `${pair.label}: ${String(pair.value)}`)
          .join("\n");
        break;
      case "object":
        text = JSON.stringify(view.value, null, 2);
        break;
      case "trace":
        text = (view.steps as Array<{ label: string; status?: string; detail?: string }>)
          .map(
            (step) =>
              `[${step.status ?? "-"}] ${step.label}${step.detail ? ` — ${step.detail}` : ""}`,
          )
          .join("\n");
        break;
      default:
        text = JSON.stringify(view, null, 2);
    }

    await navigator.clipboard.writeText(text);
    setCopiedId(view.id);
    setTimeout(() => setCopiedId(undefined), 1500);
  };

  return (
    <>
      {views.map((view) => (
        <details key={view.id} className="metadata-view" open>
          <summary className="metadata-view-header">
            <span>{view.title}</span>
            <button
              className="copy-button"
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void copyViewContent(view);
              }}
            >
              {copiedId === view.id ? "✓" : "📋"}
            </button>
          </summary>
          <div className="metadata-view-body">
            {view.kind === "entry-list" && (
              <ul className="entry-list">
                {(
                  view.items as Array<{
                    id: string;
                    title: string;
                    summary?: string;
                    tags?: string[];
                  }>
                ).map((item) => (
                  <li key={item.id}>
                    <strong>{item.title}</strong>
                    {item.summary ? <span className="entry-summary">{item.summary}</span> : null}
                    {item.tags?.length ? (
                      <span className="entry-tags">{item.tags.join(", ")}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {view.kind === "code" && (
              <pre className="code-block">
                <code>{String(view.content)}</code>
              </pre>
            )}
            {view.kind === "stats" && (
              <table className="stats-table">
                <tbody>
                  {(view.pairs as Array<{ label: string; value: unknown; tone?: string }>).map(
                    (pair, i) => (
                      <tr key={i} className={pair.tone ? `tone-${pair.tone}` : ""}>
                        <td>{pair.label}</td>
                        <td>{String(pair.value)}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            )}
            {view.kind === "text" && <p className="text-block">{String(view.content)}</p>}
            {view.kind === "object" && (
              <pre className="code-block">
                <code>{JSON.stringify(view.value, null, 2)}</code>
              </pre>
            )}
            {view.kind === "trace" && (
              <ol className="trace-list">
                {(
                  view.steps as Array<{
                    label: string;
                    status?: string;
                    detail?: string;
                    durationMs?: number;
                  }>
                ).map((step, i) => (
                  <li key={i} className={`trace-step trace-${step.status ?? "default"}`}>
                    <span>{step.label}</span>
                    {step.detail ? <span className="trace-detail">{step.detail}</span> : null}
                    {step.durationMs !== undefined ? (
                      <span className="trace-duration">{step.durationMs}ms</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </details>
      ))}
    </>
  );
}

function PortList({
  direction,
  ports,
  language,
  node,
  connectionDraft,
  compatibilityClass,
  onStartConnection,
  onFinishConnection,
  onHover,
}: {
  direction: PortDirection;
  ports: PortDefinition[];
  language: Language;
  node: WorkflowNode;
  connectionDraft?: ConnectionDraft;
  compatibilityClass: (node: WorkflowNode, port: PortDefinition) => string;
  onStartConnection?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    node: WorkflowNode,
    port: PortDefinition,
  ) => void;
  onFinishConnection?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    node: WorkflowNode,
    port: PortDefinition,
  ) => void;
  onHover: (node: WorkflowNode, port: PortDefinition, enabled: boolean) => void;
}) {
  return ports.map((port, index) => {
    const presentation = dataTypePresentation[port.dataType];
    const label = language === "zh" ? presentation.labelZh : presentation.labelEn;
    const isInput = direction === "input";
    const isHovered =
      connectionDraft?.hoverTarget?.target === node.id &&
      connectionDraft.hoverTarget.targetPort === port.id;

    return (
      <span
        key={`${direction}-${port.id}`}
        className={`port-entry port-entry-${direction} ${isHovered ? "port-hovered" : ""}`}
        style={{ top: portTop + index * portGap } as CSSProperties}
      >
        <button
          className={`port-button ${direction}-port ${compatibilityClass(node, port)}`}
          style={{ "--port-color": presentation.color } as CSSProperties}
          type="button"
          title={`${port.label} / ${label}`}
          aria-label={`${node.id}.${port.id} ${label}`}
          onPointerDown={(event) => {
            if (!isInput) {
              onStartConnection?.(event, node, port);
            }
          }}
          onPointerUp={(event) => {
            if (isInput) {
              onFinishConnection?.(event, node, port);
            }
          }}
          onPointerEnter={() => {
            if (isInput) {
              onHover(node, port, true);
            }
          }}
          onPointerLeave={() => {
            if (isInput) {
              onHover(node, port, false);
            }
          }}
        />
        <span className="port-label">
          {port.id}
          <small>{label}</small>
        </span>
      </span>
    );
  });
}

function EntryPanel({
  title,
  entries,
  draft,
  editingId,
  text,
  onDraftChange,
  onLoad,
  onSave,
  onCancel,
  onSelect,
  onDelete,
}: {
  title: string;
  entries: MemoryEntry[];
  draft: Draft;
  editingId?: string;
  text: (typeof copy)[Language];
  onDraftChange: (draft: Draft) => void;
  onLoad: () => void;
  onSave: () => void;
  onCancel: () => void;
  onSelect: (entry: MemoryEntry) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="memory-library">
      <div className="panel-heading">
        <h2>{title}</h2>
        <button className="tiny-button" type="button" onClick={onLoad}>
          {text.loadMemory}
        </button>
      </div>
      <label>
        {text.memoryTitle}
        <input
          value={draft.title}
          onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
        />
      </label>
      <label>
        {text.memoryContent}
        <textarea
          value={draft.content}
          onChange={(event) => onDraftChange({ ...draft, content: event.target.value })}
        />
      </label>
      <label>
        {text.memoryTags}
        <input
          value={draft.tags}
          onChange={(event) => onDraftChange({ ...draft, tags: event.target.value })}
        />
      </label>
      <div className="entry-actions">
        <button className="secondary-button memory-save" type="button" onClick={onSave}>
          {editingId ? text.updateMemory : text.saveMemory}
        </button>
        {editingId ? (
          <button className="tiny-button" type="button" onClick={onCancel}>
            {text.cancelEdit}
          </button>
        ) : null}
      </div>
      <div className="memory-list">
        {entries.length === 0 ? (
          <p className="muted">{text.noMemories}</p>
        ) : (
          entries.slice(0, 6).map((entry) => (
            <article key={entry.id} className="memory-item">
              <button className="memory-pick" type="button" onClick={() => onSelect(entry)}>
                <strong>{entry.title}</strong>
                <span>{entry.content}</span>
              </button>
              <button className="memory-delete" type="button" onClick={() => onDelete(entry.id)}>
                {text.deleteMemory}
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
