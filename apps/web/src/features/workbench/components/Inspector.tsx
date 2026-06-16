import type { NodeDefinition, WorkflowNode } from "@awp/workflow-core";

type InspectorProps = {
  node?: WorkflowNode;
  definition?: NodeDefinition;
  onUpdateConfig: (nodeId: string, configText: string) => void;
};

export const Inspector = ({ node, definition, onUpdateConfig }: InspectorProps) => {
  if (!node || !definition) {
    return (
      <aside className="workbench-panel inspector">
        <div className="panel-heading">
          <h2>Inspector</h2>
        </div>
        <p className="muted">
          Select a node to inspect its config, ports, schema, and advanced fields.
        </p>
      </aside>
    );
  }

  return (
    <aside className="workbench-panel inspector">
      <div className="panel-heading">
        <h2>Inspector</h2>
        <span>{definition.category ?? "node"}</span>
      </div>
      <dl className="key-values">
        <div>
          <dt>Display name</dt>
          <dd>{definition.label}</dd>
        </div>
        <div>
          <dt>Node type</dt>
          <dd>{definition.type}</dd>
        </div>
        <div>
          <dt>Description</dt>
          <dd>{definition.description ?? "No description"}</dd>
        </div>
      </dl>
      <label className="field-block">
        <span>Config JSON</span>
        <textarea
          defaultValue={JSON.stringify(node.config, null, 2)}
          onBlur={(event) => onUpdateConfig(node.id, event.target.value)}
        />
      </label>
      <div className="port-table">
        <h3>Ports</h3>
        {definition.ports.map((port) => (
          <div key={`${port.direction}-${port.id}`}>
            <strong>{port.label}</strong>
            <span>{port.direction}</span>
            <code>{"wireType" in port ? port.wireType : port.dataType}</code>
            {port.schemaId ? <small>{port.schemaId}</small> : null}
          </div>
        ))}
      </div>
    </aside>
  );
};
