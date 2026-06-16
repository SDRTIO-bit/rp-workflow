import type { WorkflowViewModel } from "../model/workflowViewModel";

type WorkflowCanvasProps = {
  model: WorkflowViewModel;
  selectedNodeId: string;
  connectionDraft?: { nodeId: string; portId: string };
  onSelectNode: (nodeId: string) => void;
  onBeginConnection: (nodeId: string, portId: string) => void;
  onCompleteConnection: (nodeId: string, portId: string) => void;
};

const nodeWidth = 260;
const nodeHeight = 150;

export const WorkflowCanvas = ({
  model,
  selectedNodeId,
  connectionDraft,
  onSelectNode,
  onBeginConnection,
  onCompleteConnection,
}: WorkflowCanvasProps) => (
  <section className="workflow-canvas" aria-label="Workflow canvas">
    <svg className="edge-layer" width="2200" height="1400" aria-hidden="true">
      {model.edges.map((edge) => {
        const source = model.nodes.find((node) => node.id === edge.source);
        const target = model.nodes.find((node) => node.id === edge.target);
        if (!source || !target) return null;
        const sx = source.position.x + nodeWidth;
        const sy = source.position.y + nodeHeight / 2;
        const tx = target.position.x;
        const ty = target.position.y + nodeHeight / 2;
        const mid = sx + Math.max(64, (tx - sx) / 2);
        return (
          <g key={edge.id} className={`edge-path ${edge.visualClass}`}>
            <path d={`M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${ty}, ${tx} ${ty}`} />
            <text x={(sx + tx) / 2} y={(sy + ty) / 2 - 8}>
              {edge.label}
            </text>
          </g>
        );
      })}
    </svg>
    {model.nodes.length === 0 ? (
      <div className="canvas-empty">
        <h2>Empty workflow</h2>
        <p>Add nodes from the library or load an existing template.</p>
      </div>
    ) : null}
    {model.nodes.map((node) => (
      <article
        key={node.id}
        className={`workflow-node ${selectedNodeId === node.id ? "selected" : ""} ${node.runStatus ?? ""}`}
        style={{ transform: `translate(${node.position.x}px, ${node.position.y}px)` }}
        onClick={() => onSelectNode(node.id)}
      >
        <header>
          <span className="node-glyph">{node.category.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong title={node.title}>{node.title}</strong>
            <small>{node.type}</small>
          </div>
          {node.runStatus ? <em>{node.runStatus}</em> : null}
        </header>
        <div className="node-summary">
          {node.summary.length ? (
            node.summary.map((line) => <span key={line}>{line}</span>)
          ) : (
            <span>Default config</span>
          )}
        </div>
        <div className="ports-grid">
          <div>
            {node.inputs.map((port) => (
              <button
                key={port.id}
                type="button"
                className="port-row input"
                title={`${port.label} · ${port.typeLabel}${port.schemaId ? ` · ${port.schemaId}` : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCompleteConnection(node.id, port.id);
                }}
              >
                <span className="handle" />
                <span>{port.label}</span>
                {port.required ? <b>req</b> : null}
              </button>
            ))}
          </div>
          <div>
            {node.outputs.map((port) => (
              <button
                key={port.id}
                type="button"
                className={`port-row output ${connectionDraft?.nodeId === node.id && connectionDraft.portId === port.id ? "active" : ""}`}
                title={`${port.label} · ${port.typeLabel}${port.schemaId ? ` · ${port.schemaId}` : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onBeginConnection(node.id, port.id);
                }}
              >
                <span>{port.label}</span>
                <span className="handle" />
              </button>
            ))}
          </div>
        </div>
      </article>
    ))}
  </section>
);
