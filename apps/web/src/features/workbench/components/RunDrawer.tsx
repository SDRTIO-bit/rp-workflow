import type { NodeRunResult, WorkflowRunResult } from "@awp/workflow-core";

type RunDrawerProps = {
  open: boolean;
  runs: NodeRunResult[];
  result?: WorkflowRunResult;
  notice: string;
  onToggle: () => void;
};

export const RunDrawer = ({ open, runs, result, notice, onToggle }: RunDrawerProps) => (
  <section className={`run-drawer ${open ? "open" : ""}`}>
    <button type="button" className="drawer-tab" onClick={onToggle}>
      Run Drawer · {notice}
    </button>
    {open ? (
      <div className="run-list">
        {result ? (
          <article className={`run-row ${result.status}`}>
            <strong>Workflow</strong>
            <span>{result.status}</span>
            <small>{result.batches.length} batches</small>
            {result.validationIssues.length ? (
              <details open>
                <summary>Validation issues</summary>
                <pre>{JSON.stringify(result.validationIssues, null, 2)}</pre>
              </details>
            ) : null}
          </article>
        ) : null}
        {runs.length === 0 ? (
          <p className="muted">Node run results will appear here after execution.</p>
        ) : null}
        {runs.map((run) => (
          <article key={run.nodeId} className={`run-row ${run.status}`}>
            <strong>{run.nodeId}</strong>
            <span>{run.status}</span>
            <small>{Math.max(0, run.endedAt - run.startedAt)}ms</small>
            {run.error ? <p>{run.error}</p> : null}
            <details>
              <summary>Outputs</summary>
              <pre>{JSON.stringify(run.outputs, null, 2)}</pre>
            </details>
          </article>
        ))}
      </div>
    ) : null}
  </section>
);
