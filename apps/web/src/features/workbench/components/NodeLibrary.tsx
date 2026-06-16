import type { NodeDefinition } from "@awp/workflow-core";
import type { WorkflowTemplate } from "../../../state/sampleWorkflows";

type NodeLibraryProps = {
  nodes: NodeDefinition[];
  templates: WorkflowTemplate[];
  query: string;
  onQueryChange: (value: string) => void;
  onAddNode: (definition: NodeDefinition) => void;
  onLoadTemplate: (template: WorkflowTemplate) => void;
};

export const NodeLibrary = ({
  nodes,
  templates,
  query,
  onQueryChange,
  onAddNode,
  onLoadTemplate,
}: NodeLibraryProps) => (
  <aside className="workbench-panel node-library">
    <div className="panel-heading">
      <h2>Node Library</h2>
      <span>{nodes.length}</span>
    </div>
    <input
      className="search-input"
      value={query}
      onChange={(event) => onQueryChange(event.target.value)}
      placeholder="Search nodes"
    />
    <div className="template-strip">
      {templates.slice(0, 4).map((template) => (
        <button key={template.id} type="button" onClick={() => onLoadTemplate(template)}>
          {template.label.en}
        </button>
      ))}
    </div>
    <div className="node-list">
      {nodes.map((node) => (
        <button
          key={node.type}
          type="button"
          className="node-list-item"
          onClick={() => onAddNode(node)}
        >
          <strong>{node.label}</strong>
          <span>
            {node.category ?? "uncategorized"} · {node.type}
          </span>
        </button>
      ))}
    </div>
  </aside>
);
