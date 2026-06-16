import { Inspector } from "../features/workbench/components/Inspector";
import { NodeLibrary } from "../features/workbench/components/NodeLibrary";
import { RunDrawer } from "../features/workbench/components/RunDrawer";
import { WorkflowCanvas } from "../features/workbench/components/WorkflowCanvas";
import { useWorkbench } from "../features/workbench/hooks/useWorkbench";

export const WorkbenchPage = () => {
  const workbench = useWorkbench();

  return (
    <main className="workbench-page">
      <header className="workbench-toolbar">
        <div>
          <h1>{workbench.workflow.name}</h1>
          <p>
            {workbench.workflow.nodes.length} nodes · {workbench.workflow.edges.length} edges
          </p>
        </div>
        <div className="toolbar-actions">
          <button type="button" onClick={() => workbench.setLibraryOpen(!workbench.libraryOpen)}>
            Library
          </button>
          <button
            type="button"
            onClick={() => workbench.setInspectorOpen(!workbench.inspectorOpen)}
          >
            Inspector
          </button>
          <button type="button" onClick={workbench.save}>
            Save
          </button>
          <button type="button" onClick={workbench.loadSaved}>
            Load
          </button>
          <button type="button" className="primary" onClick={() => void workbench.run()}>
            Run
          </button>
        </div>
      </header>

      <div
        className={`workbench-grid ${workbench.libraryOpen ? "" : "library-collapsed"} ${workbench.inspectorOpen ? "" : "inspector-collapsed"}`}
      >
        {workbench.libraryOpen ? (
          <NodeLibrary
            nodes={workbench.filteredNodes}
            templates={workbench.templates}
            query={workbench.query}
            onQueryChange={workbench.setQuery}
            onAddNode={workbench.addNode}
            onLoadTemplate={workbench.loadTemplate}
          />
        ) : null}
        <WorkflowCanvas
          model={workbench.model}
          selectedNodeId={workbench.selectedNodeId}
          connectionDraft={workbench.connectionDraft}
          onSelectNode={workbench.setSelectedNodeId}
          onBeginConnection={workbench.beginConnection}
          onCompleteConnection={workbench.completeConnection}
        />
        {workbench.inspectorOpen ? (
          <Inspector
            node={workbench.selectedNode}
            definition={workbench.selectedDefinition}
            onUpdateConfig={workbench.updateNodeConfig}
          />
        ) : null}
      </div>
      <RunDrawer
        open={workbench.runOpen}
        runs={workbench.runs}
        result={workbench.lastRunResult}
        notice={workbench.notice}
        onToggle={() => workbench.setRunOpen(!workbench.runOpen)}
      />
    </main>
  );
};
