import { describeRpQuality, formatRpUsage } from "../rpDisplayHelpers";
import { DisclosurePanel } from "../shared/ui/DisclosurePanel";
import { RpComposer } from "../features/rp/components/RpComposer";
import { useOfficialRpSession } from "../features/rp/hooks/useOfficialRpSession";

export const RpPage = () => {
  const rp = useOfficialRpSession();
  const { session } = rp;

  return (
    <main className="rp-page">
      <section className="rp-sidebar">
        <div className="section-heading">
          <h2>Session</h2>
          <button type="button" onClick={rp.newSession}>
            New
          </button>
        </div>
        <dl className="key-values">
          <div>
            <dt>Session ID</dt>
            <dd>{session.sessionId}</dd>
          </div>
          <div>
            <dt>Next turn</dt>
            <dd>{session.nextTurnNumber}</dd>
          </div>
          <div>
            <dt>Worldbook</dt>
            <dd>{session.worldbookResourceRef}</dd>
          </div>
          <div>
            <dt>Memory</dt>
            <dd>{session.memoryNamespace}</dd>
          </div>
        </dl>
      </section>

      <section className="rp-main" aria-label="RP conversation">
        <div className="page-title-row">
          <div>
            <h1>Official RP</h1>
            <p>Player-facing roleplay surface backed by the real `/api/rp` contract.</p>
          </div>
          <span className={`status-chip ${session.status}`}>{session.status}</span>
        </div>

        <div className="message-list">
          {session.messages.length === 0 ? (
            <div className="empty-state">
              <h2>Start a scene</h2>
              <p>Debug details stay folded away. The conversation remains the primary surface.</p>
            </div>
          ) : (
            session.messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <div className="message-meta">
                  <strong>{message.role === "user" ? "Player" : "Narrator"}</strong>
                  <span>{message.turnId}</span>
                </div>
                <p>{message.text}</p>
              </article>
            ))
          )}
        </div>

        {session.lastError ? <p className="inline-error">{session.lastError.message}</p> : null}
        <RpComposer
          value={rp.draft}
          disabled={rp.isSending}
          canRetry={Boolean(session.pendingTurn)}
          onChange={rp.setDraft}
          onSubmit={(value) => void rp.submit(value)}
          onContinue={rp.continueTurn}
          onRetry={rp.retry}
          onCancel={rp.cancel}
        />
      </section>

      <aside className="diagnostics-rail">
        <DisclosurePanel title="Quality" meta={session.lastQuality ? "ready" : "none"}>
          <p>{describeRpQuality(session.lastQuality)}</p>
        </DisclosurePanel>
        <DisclosurePanel title="Usage" meta={session.lastObservability ? "ready" : "none"}>
          <p>{formatRpUsage(session.lastObservability)}</p>
        </DisclosurePanel>
        <DisclosurePanel title="Observability">
          <pre>{JSON.stringify(session.lastObservability ?? {}, null, 2)}</pre>
        </DisclosurePanel>
      </aside>
    </main>
  );
};
