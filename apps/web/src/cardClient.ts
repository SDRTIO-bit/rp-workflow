type Fetcher = typeof fetch;

// === Public API Types (sanitized DTOs matching server contract) ===

export type PublicManifestV1 = {
  cardId: string;
  sourceFilename: string;
  sourceSizeBytes: number;
  sourceHash: string;
  importedAt: string;
  spec: string;
  name: string;
  description: string | null;
  tags: string[];
  worldbookEntryCount: number;
  worldbookDeferredCount: number;
  worldbookDisabledCount: number;
  worldbookBlockedCount: number;
  worldbookConstantCount: number;
  alternateGreetingCount: number;
  defaultGreetingId: string | null;
  capabilities: {
    variablesDetected: boolean;
    variableSchemaDetected: boolean;
    initialStateDetected: boolean;
    patchProtocolDetected: boolean;
    conditionalEntriesDetected: boolean;
    runtimeStatus: string;
    conditionalEntryCount: number;
  };
  warnings: Array<{
    code: string;
    severity: "info" | "warn" | "error";
    message: string;
    location: string | null;
    count: number | null;
  }>;
  blockedFeatureSummary: Array<{
    code: string;
    status: "blocked" | "preserved-not-executed";
    count: number;
  }>;
  worldbookResourceRef: string;
};

export type CardSummaryV1 = {
  cardId: string;
  name: string;
  description: string | null;
  tags: string[];
  worldbookEntryCount: number;
  alternateGreetingCount: number;
  defaultGreetingId: string | null;
  importedAt: string;
};

export type CardGreetingViewV1 = {
  greetingId: string;
  index: number;
  label: string | null;
  content: string;
  isDefault: boolean;
};

export type CardImportResult = {
  cardId: string;
  alreadyExisted: boolean;
  manifest: PublicManifestV1;
  defaultGreetingId: string | null;
  greetingCount: number;
};

export type CardDetailResponse = {
  cardId: string;
  manifest: PublicManifestV1;
  defaultGreetingId: string | null;
  greetingCount: number;
};

export type GreetingListResponse = {
  cardId: string;
  greetings: CardGreetingViewV1[];
};

export type CardSessionInitRequest = {
  cardId: string;
  greetingId: string;
  sessionId: string;
  memoryNamespace?: string;
};

export type CardSessionInitResult = {
  sessionId: string;
  cardId: string;
  greetingId: string;
  memoryNamespace: string;
  worldbookResourceRef: string;
  greetingTurnIndex: number;
  greetingTurnId: string;
  committed: boolean;
  deduplicated: boolean;
};

// === Error Types ===

export type CardWebError = {
  kind:
    | "validation"
    | "not-found"
    | "conflict"
    | "file-too-large"
    | "unsupported-type"
    | "invalid-card"
    | "network"
    | "aborted"
    | "unknown";
  message: string;
  retryable: boolean;
};

const safeErrorMessages: Record<number, string> = {
  400: "The request is invalid. Please check the file and try again.",
  404: "The requested card or greeting was not found.",
  409: "This session has already started with a different greeting.",
  413: "The file is too large. Please use a smaller card file.",
  415: "Unsupported file type. Please upload a JSON card file.",
  422: "The card file is invalid or corrupted.",
};

const getSafeMessage = (status: number): string =>
  safeErrorMessages[status] ?? "An unexpected error occurred.";

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException ? error.name === "AbortError" : false;

const mapCardError = async (response: Response): Promise<CardWebError> => {
  const status = response.status;

  if (status === 400) {
    return { kind: "validation", message: getSafeMessage(400), retryable: false };
  }
  if (status === 404) {
    return { kind: "not-found", message: getSafeMessage(404), retryable: false };
  }
  if (status === 409) {
    return { kind: "conflict", message: getSafeMessage(409), retryable: false };
  }
  if (status === 413) {
    return { kind: "file-too-large", message: getSafeMessage(413), retryable: false };
  }
  if (status === 415) {
    return { kind: "unsupported-type", message: getSafeMessage(415), retryable: false };
  }
  if (status === 422) {
    return { kind: "invalid-card", message: getSafeMessage(422), retryable: false };
  }
  if (status >= 500) {
    return {
      kind: "unknown",
      message: "A server error occurred. Please try again later.",
      retryable: true,
    };
  }

  return { kind: "unknown", message: "Card request failed.", retryable: true };
};

const handleCardFetchError = (error: unknown): CardWebError => {
  if (isCardWebError(error)) return error;
  if (isAbortError(error)) {
    return { kind: "aborted", message: "Request was canceled.", retryable: true };
  }
  if (error instanceof TypeError) {
    return {
      kind: "network",
      message: "Unable to connect to the server.",
      retryable: true,
    };
  }
  return { kind: "unknown", message: "Card request failed.", retryable: true };
};

const isCardWebError = (error: unknown): error is CardWebError =>
  Boolean(
    error &&
    typeof error === "object" &&
    "kind" in error &&
    "message" in error &&
    "retryable" in error,
  );

// === API Functions ===

export const importCard = async (
  file: File,
  options: { signal?: AbortSignal; fetcher?: Fetcher } = {},
): Promise<CardImportResult> => {
  const fetcher = options.fetcher ?? fetch;
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetcher("/api/cards/import", {
      method: "POST",
      body: formData,
      signal: options.signal,
    });

    if (!response.ok) {
      throw await mapCardError(response);
    }

    return (await response.json()) as CardImportResult;
  } catch (error) {
    throw handleCardFetchError(error);
  }
};

export const listCards = async (
  options: { signal?: AbortSignal; fetcher?: Fetcher } = {},
): Promise<{ cards: CardSummaryV1[] }> => {
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher("/api/cards", {
      method: "GET",
      signal: options.signal,
    });

    if (!response.ok) {
      throw await mapCardError(response);
    }

    return (await response.json()) as { cards: CardSummaryV1[] };
  } catch (error) {
    throw handleCardFetchError(error);
  }
};

export const getCard = async (
  cardId: string,
  options: { signal?: AbortSignal; fetcher?: Fetcher } = {},
): Promise<CardDetailResponse> => {
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher(`/api/cards/${encodeURIComponent(cardId)}`, {
      method: "GET",
      signal: options.signal,
    });

    if (!response.ok) {
      throw await mapCardError(response);
    }

    return (await response.json()) as CardDetailResponse;
  } catch (error) {
    throw handleCardFetchError(error);
  }
};

export const getCardGreetings = async (
  cardId: string,
  options: { signal?: AbortSignal; fetcher?: Fetcher } = {},
): Promise<GreetingListResponse> => {
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher(`/api/cards/${encodeURIComponent(cardId)}/greetings`, {
      method: "GET",
      signal: options.signal,
    });

    if (!response.ok) {
      throw await mapCardError(response);
    }

    return (await response.json()) as GreetingListResponse;
  } catch (error) {
    throw handleCardFetchError(error);
  }
};

export const initializeCardSession = async (
  request: CardSessionInitRequest,
  options: { signal?: AbortSignal; fetcher?: Fetcher } = {},
): Promise<CardSessionInitResult> => {
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher("/api/cards/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: options.signal,
    });

    if (!response.ok) {
      throw await mapCardError(response);
    }

    return (await response.json()) as CardSessionInitResult;
  } catch (error) {
    throw handleCardFetchError(error);
  }
};
