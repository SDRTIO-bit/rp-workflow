import { useEffect, useMemo, useState } from "react";
import {
  nodeRegistry,
  type NodeCatalog,
  type NodeDefinition,
  type NodeRunResult,
  type WorkflowRunResult,
  type WorkflowDefinition,
  type WorkflowEdge,
} from "@awp/workflow-core";
import { evaluateConnection } from "../../../connectionRules";
import {
  loadNodeManifestsViaServer,
  loadWorkflowTemplatesViaServer,
  runWorkflowViaServer,
} from "../../../runWorkflowClient";
import {
  emptyWorkflow,
  workflowTemplates,
  type WorkflowTemplate,
} from "../../../state/sampleWorkflows";
import { loadWorkflowFromStorage, saveWorkflowToStorage } from "../../../workflowStorage";
import { createWorkflowViewModel } from "../model/workflowViewModel";

type ConnectionDraft = {
  nodeId: string;
  portId: string;
};

export const useWorkbench = () => {
  const [workflow, setWorkflow] = useState<WorkflowDefinition>(emptyWorkflow);
  const [catalog, setCatalog] = useState<NodeCatalog>(nodeRegistry);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>(workflowTemplates);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [runs, setRuns] = useState<NodeRunResult[]>([]);
  const [lastRunResult, setLastRunResult] = useState<WorkflowRunResult | undefined>();
  const [notice, setNotice] = useState("Ready");
  const [query, setQuery] = useState("");
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft | undefined>();
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [runOpen, setRunOpen] = useState(false);

  useEffect(() => {
    const loadRuntime = async () => {
      const [nodes, loadedTemplates] = await Promise.all([
        loadNodeManifestsViaServer(),
        loadWorkflowTemplatesViaServer(),
      ]);
      if (nodes?.length) setCatalog(Object.fromEntries(nodes.map((node) => [node.type, node])));
      if (loadedTemplates?.length) setTemplates(loadedTemplates);
    };
    void loadRuntime();
  }, []);

  const model = useMemo(
    () => createWorkflowViewModel(workflow, catalog, runs),
    [workflow, catalog, runs],
  );
  const selectedNode = workflow.nodes.find((node) => node.id === selectedNodeId);
  const selectedDefinition = selectedNode ? catalog[selectedNode.type] : undefined;

  const filteredNodes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return Object.values(catalog)
      .filter(
        (node) =>
          !normalized ||
          `${node.label} ${node.type} ${node.category ?? ""}`.toLowerCase().includes(normalized),
      )
      .sort(
        (a, b) =>
          (a.category ?? "").localeCompare(b.category ?? "") || a.label.localeCompare(b.label),
      );
  }, [catalog, query]);

  const addNode = (definition: NodeDefinition) => {
    const index = workflow.nodes.length + 1;
    const id = `${definition.type}_${index}`;
    setWorkflow((current) => ({
      ...current,
      nodes: [
        ...current.nodes,
        {
          id,
          type: definition.type,
          position: { x: 80 + (index % 4) * 280, y: 80 + Math.floor(index / 4) * 180 },
          config: { ...(definition.defaultConfig ?? {}) },
        },
      ],
    }));
    setSelectedNodeId(id);
    setNotice(`Added ${definition.label}`);
  };

  const updateNodeConfig = (nodeId: string, configText: string) => {
    try {
      const config = JSON.parse(configText) as Record<string, unknown>;
      setWorkflow((current) => ({
        ...current,
        nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, config } : node)),
      }));
      setNotice("Node config updated");
    } catch {
      setNotice("Config must be valid JSON");
    }
  };

  const beginConnection = (nodeId: string, portId: string) => {
    setConnectionDraft({ nodeId, portId });
    setNotice("Select a compatible input port");
  };

  const completeConnection = (targetNodeId: string, targetPortId: string) => {
    if (!connectionDraft) return;
    const candidate = {
      source: connectionDraft.nodeId,
      sourcePort: connectionDraft.portId,
      target: targetNodeId,
      targetPort: targetPortId,
    };
    const evaluation = evaluateConnection(workflow, candidate, catalog);
    if (!evaluation.ok) {
      setNotice(evaluation.reason);
      setConnectionDraft(undefined);
      return;
    }
    const edge: WorkflowEdge = {
      id: `edge_${Date.now().toString(36)}`,
      ...candidate,
    };
    setWorkflow((current) => ({ ...current, edges: [...current.edges, edge] }));
    setConnectionDraft(undefined);
    setNotice("Connection added");
  };

  const loadTemplate = (template: WorkflowTemplate) => {
    setWorkflow(template.workflow);
    setSelectedNodeId("");
    setRuns([]);
    setLastRunResult(undefined);
    setNotice(`Loaded ${template.label.en}`);
  };

  const save = () => {
    saveWorkflowToStorage(workflow);
    setNotice("Workflow saved locally");
  };

  const loadSaved = () => {
    const saved = loadWorkflowFromStorage();
    if (!saved) {
      setNotice("No saved workflow");
      return;
    }
    setWorkflow(saved);
    setNotice("Saved workflow loaded");
  };

  const run = async () => {
    setRunOpen(true);
    setNotice("Running workflow");
    const result = await runWorkflowViaServer(workflow);
    if (!result) {
      setNotice("Workflow run failed before a result was returned");
      return;
    }
    setLastRunResult(result);
    setRuns(result.nodeRuns);
    setNotice(`Run ${result.status}`);
  };

  return {
    workflow,
    catalog,
    templates,
    model,
    selectedNode,
    selectedDefinition,
    filteredNodes,
    query,
    setQuery,
    selectedNodeId,
    setSelectedNodeId,
    runs,
    lastRunResult,
    notice,
    connectionDraft,
    libraryOpen,
    setLibraryOpen,
    inspectorOpen,
    setInspectorOpen,
    runOpen,
    setRunOpen,
    addNode,
    updateNodeConfig,
    beginConnection,
    completeConnection,
    loadTemplate,
    save,
    loadSaved,
    run,
  };
};
