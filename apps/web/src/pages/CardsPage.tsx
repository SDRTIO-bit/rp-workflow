import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCard,
  getCardGreetings,
  importCard,
  initializeCardSession,
  listCards,
  type CardGreetingViewV1,
  type CardImportResult,
  type CardSummaryV1,
  type CardWebError,
  type PublicManifestV1,
} from "../cardClient";
import { setPendingCardSession } from "../rpSessionState";
import { DisclosurePanel } from "../shared/ui/DisclosurePanel";

type UploadStatus = "idle" | "uploading" | "success" | "error";

type CardsPageProps = {
  navigate: (route: string) => void;
};

const shortCardId = (cardId: string): string => cardId.slice(0, 8);

const createSessionId = (): string => {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `rp-web-${uuid}`;
};

const navigateTo = (route: string) => {
  window.history.pushState(null, "", route);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

export const CardsPage = ({ navigate: _navigate }: CardsPageProps) => {
  const [cards, setCards] = useState<CardSummaryV1[]>([]);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [importResult, setImportResult] = useState<CardImportResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [manifest, setManifest] = useState<PublicManifestV1 | null>(null);
  const [greetings, setGreetings] = useState<CardGreetingViewV1[]>([]);
  const [selectedGreetingId, setSelectedGreetingId] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load card list on mount
  useEffect(() => {
    const controller = new AbortController();
    listCards({ signal: controller.signal })
      .then((result) => setCards(result.cards))
      .catch(() => {
        /* silent: list failure is non-critical */
      });
    return () => controller.abort();
  }, []);

  // Load card detail when selection changes
  useEffect(() => {
    if (!selectedCardId) {
      setManifest(null);
      setGreetings([]);
      setSelectedGreetingId(null);
      return;
    }

    const controller = new AbortController();
    setIsLoadingDetail(true);
    setInitError(null);

    Promise.all([
      getCard(selectedCardId, { signal: controller.signal }),
      getCardGreetings(selectedCardId, { signal: controller.signal }),
    ])
      .then(([cardDetail, greetingList]) => {
        setManifest(cardDetail.manifest);
        setGreetings(greetingList.greetings);
        // Auto-select default greeting
        const defaultGreeting = greetingList.greetings.find((g) => g.isDefault);
        setSelectedGreetingId(
          defaultGreeting?.greetingId ?? greetingList.greetings[0]?.greetingId ?? null,
        );
      })
      .catch(() => {
        setManifest(null);
        setGreetings([]);
      })
      .finally(() => setIsLoadingDetail(false));

    return () => controller.abort();
  }, [selectedCardId]);

  const handleUpload = useCallback(async (file: File) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setUploadStatus("uploading");
    setUploadError(null);
    setImportResult(null);

    try {
      const result = await importCard(file, { signal: controller.signal });
      setImportResult(result);
      setUploadStatus("success");
      // Refresh card list
      const list = await listCards({ signal: controller.signal });
      setCards(list.cards);
    } catch (error) {
      const cardError = error as CardWebError;
      setUploadError(cardError.message ?? "Upload failed.");
      setUploadStatus("error");
    } finally {
      abortRef.current = null;
    }
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleUpload(file);
      // Reset input so the same file can be re-uploaded
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleUpload],
  );

  const handleInitSession = useCallback(async () => {
    if (!selectedCardId || !selectedGreetingId) return;
    const greeting = greetings.find((g) => g.greetingId === selectedGreetingId);
    if (!greeting) return;

    setIsInitializing(true);
    setInitError(null);

    const sessionId = createSessionId();
    const memoryNamespace = `rp-session:${sessionId}`;

    try {
      await initializeCardSession({
        cardId: selectedCardId,
        greetingId: selectedGreetingId,
        sessionId,
      });

      // Store pending session for RP page to consume
      setPendingCardSession({
        sessionId,
        cardId: selectedCardId,
        greetingId: selectedGreetingId,
        greetingContent: greeting.content,
        worldbookResourceRef: `card:${selectedCardId}`,
        memoryNamespace,
      });

      // Navigate to RP page
      navigateTo("/rp");
    } catch (error) {
      const cardError = error as CardWebError;
      if (cardError.kind === "conflict") {
        setInitError("This session has already started with a different greeting.");
      } else {
        setInitError(cardError.message ?? "Failed to initialize session.");
      }
    } finally {
      setIsInitializing(false);
    }
  }, [selectedCardId, selectedGreetingId, greetings]);

  const selectedGreeting = greetings.find((g) => g.greetingId === selectedGreetingId);

  return (
    <main className="cards-page">
      <section className="cards-upload-section">
        <div className="page-title-row">
          <div>
            <h1>Character Cards</h1>
            <p>Import SillyTavern V3 JSON cards and start RP sessions.</p>
          </div>
        </div>

        <div className="cards-upload-area">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            disabled={uploadStatus === "uploading"}
            className="cards-file-input"
            data-testid="card-file-input"
          />
          {uploadStatus === "uploading" && (
            <p className="cards-status uploading" data-testid="upload-status">
              Uploading...
            </p>
          )}
          {uploadStatus === "error" && uploadError && (
            <p className="cards-status error" data-testid="upload-error">
              {uploadError}
            </p>
          )}
          {uploadStatus === "success" && importResult && (
            <div className="cards-import-result" data-testid="import-result">
              <strong>{importResult.manifest.name}</strong>
              <span className="cards-meta">
                [{shortCardId(importResult.cardId)}]{" \u00b7 "}
                {importResult.greetingCount} greeting{importResult.greetingCount !== 1 ? "s" : ""}
                {importResult.manifest.warnings.length > 0 &&
                  ` \u00b7 ${importResult.manifest.warnings.length} warning${importResult.manifest.warnings.length !== 1 ? "s" : ""}`}
                {importResult.manifest.blockedFeatureSummary.length > 0 &&
                  ` \u00b7 ${importResult.manifest.blockedFeatureSummary.length} blocked feature${importResult.manifest.blockedFeatureSummary.length !== 1 ? "s" : ""}`}
                {importResult.alreadyExisted && " \u00b7 already imported"}
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="cards-list-section">
        <h2>Imported Cards</h2>
        {cards.length === 0 ? (
          <p className="empty-state">No cards imported yet.</p>
        ) : (
          <div className="cards-grid">
            {cards.map((card) => (
              <button
                key={card.cardId}
                type="button"
                className={`card-item${selectedCardId === card.cardId ? " selected" : ""}`}
                onClick={() => setSelectedCardId(card.cardId)}
                data-testid="card-list-item"
              >
                <strong>{card.name}</strong>
                <span className="cards-meta">
                  [{shortCardId(card.cardId)}]{" \u00b7 "}
                  {card.alternateGreetingCount} greeting
                  {card.alternateGreetingCount !== 1 ? "s" : ""}
                  {" \u00b7 "}
                  {card.worldbookEntryCount} worldbook entr
                  {card.worldbookEntryCount !== 1 ? "ies" : "y"}
                </span>
                {card.description && <span className="card-description">{card.description}</span>}
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedCardId && (
        <section className="cards-detail-section" data-testid="card-detail">
          {isLoadingDetail ? (
            <p>Loading card details...</p>
          ) : manifest ? (
            <>
              <div className="card-detail-header">
                <h2>{manifest.name}</h2>
                <span className="cards-meta">[{shortCardId(manifest.cardId)}]</span>
              </div>

              {manifest.description && (
                <p className="card-detail-description">{manifest.description}</p>
              )}

              <dl className="key-values">
                <div>
                  <dt>Spec</dt>
                  <dd>{manifest.spec}</dd>
                </div>
                <div>
                  <dt>Worldbook Entries</dt>
                  <dd>{manifest.worldbookEntryCount}</dd>
                </div>
                <div>
                  <dt>Alternate Greetings</dt>
                  <dd>{manifest.alternateGreetingCount}</dd>
                </div>
                <div>
                  <dt>Tags</dt>
                  <dd>{manifest.tags.length > 0 ? manifest.tags.join(", ") : "none"}</dd>
                </div>
              </dl>

              {manifest.capabilities.runtimeStatus === "unsupported-runtime" && (
                <div className="cards-notice" data-testid="unsupported-runtime-notice">
                  <strong>Unsupported Runtime</strong>
                  <p>
                    Variables, MVU scripts, and extension scripts are preserved but will not
                    execute. The card&apos;s core narrative content is fully available.
                  </p>
                </div>
              )}

              {manifest.warnings.length > 0 && (
                <div data-testid="warnings-panel">
                  <DisclosurePanel title="Warnings" meta={`${manifest.warnings.length}`}>
                    <ul className="cards-warning-list">
                      {manifest.warnings.map((w, i) => (
                        <li key={`${w.code}-${i}`} className={`cards-warning-${w.severity}`}>
                          <strong>{w.code}</strong>
                          <span>{w.message}</span>
                          {w.count !== null && <span className="cards-meta"> ({w.count})</span>}
                        </li>
                      ))}
                    </ul>
                  </DisclosurePanel>
                </div>
              )}

              {manifest.blockedFeatureSummary.length > 0 && (
                <div data-testid="blocked-features-panel">
                  <DisclosurePanel
                    title="Blocked Features"
                    meta={`${manifest.blockedFeatureSummary.length}`}
                  >
                    <ul className="cards-warning-list">
                      {manifest.blockedFeatureSummary.map((b) => (
                        <li key={b.code}>
                          <strong>{b.code}</strong>
                          <span>
                            {" "}
                            &mdash; {b.status} ({b.count})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </DisclosurePanel>
                </div>
              )}

              <div className="cards-greetings-section">
                <h3>Greetings</h3>
                {greetings.length === 0 ? (
                  <p className="empty-state">No greetings available.</p>
                ) : (
                  <div className="cards-greeting-list">
                    {greetings.map((greeting) => (
                      <button
                        key={greeting.greetingId}
                        type="button"
                        className={`card-greeting-item${selectedGreetingId === greeting.greetingId ? " selected" : ""}`}
                        onClick={() => setSelectedGreetingId(greeting.greetingId)}
                        data-testid="greeting-item"
                      >
                        <div className="greeting-header">
                          <strong>{greeting.label ?? greeting.greetingId}</strong>
                          {greeting.isDefault && <span className="greeting-default">default</span>}
                        </div>
                        <p className="greeting-preview">{greeting.content}</p>
                      </button>
                    ))}
                  </div>
                )}

                {selectedGreeting && (
                  <div className="cards-init-section">
                    <DisclosurePanel title="Selected Greeting Preview" defaultOpen>
                      <p className="greeting-full-preview">{selectedGreeting.content}</p>
                    </DisclosurePanel>
                    {initError && (
                      <p className="inline-error" data-testid="init-error">
                        {initError}
                      </p>
                    )}
                    <button
                      type="button"
                      className="primary"
                      disabled={isInitializing}
                      onClick={() => void handleInitSession()}
                      data-testid="init-session-button"
                    >
                      {isInitializing ? "Initializing..." : "Start RP Session"}
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <p>Failed to load card details.</p>
          )}
        </section>
      )}
    </main>
  );
};
