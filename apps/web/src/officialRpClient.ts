type Fetcher = typeof fetch;

export type OfficialRpRequestV1 = {
  sessionId: string;
  turnId: string;
  userInput: string;
  worldbook: {
    resourceRef: string;
  };
  memory: {
    namespace: string;
  };
  preset?: {
    text?: string;
  };
  model?: {
    providerId?: string;
    model?: string;
    temperature?: number;
  };
  behavior?: {
    onExhausted?: "return-latest" | "fail";
  };
  workflowVersion?: "unified-v1" | "legacy";
};

export type OfficialRpResponseV1 = {
  narrative: string;
  sessionId: string;
  turnId: string;
  workflow: {
    id: string;
    version: number;
    mode: "unified-v1" | "legacy";
  };
  quality?: {
    accepted: boolean;
    exhausted: boolean;
    writerAttempts: number;
    criticAttempts: number;
    revisionApplied: boolean;
  };
  observability?: {
    llmCalls: number;
    totalLatencyMs: number;
    usage: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      unavailableInvocationCount: number;
    };
    roles: {
      writer: number;
      critic: number;
      memoryCurator: number;
    };
    budget: {
      exceeded: boolean;
      reasons: string[];
    };
    modelUsage: Array<{
      providerId?: string;
      model: string;
      calls: number;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    }>;
  };
  traceId: string;
};

export type RpWebErrorV1 = {
  kind:
    | "validation"
    | "not-found"
    | "conflict"
    | "budget"
    | "provider"
    | "network"
    | "aborted"
    | "unknown";
  message: string;
  retryable: boolean;
  traceId?: string;
};

export const runOfficialRpTurn = async (
  request: OfficialRpRequestV1,
  options: {
    signal?: AbortSignal;
    fetcher?: Fetcher;
  } = {},
): Promise<OfficialRpResponseV1> => {
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher("/api/rp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: options.signal,
    });

    if (!response.ok) {
      throw await mapErrorResponse(response);
    }

    return (await response.json()) as OfficialRpResponseV1;
  } catch (error) {
    if (isRpWebError(error)) {
      throw error;
    }
    if (isAbortError(error) || options.signal?.aborted) {
      throw makeRpError("aborted", "Request was canceled.", true);
    }
    if (error instanceof TypeError) {
      throw makeRpError("network", "Unable to connect to the server.", true);
    }
    throw makeRpError("unknown", "Official RP request failed.", true);
  }
};

const mapErrorResponse = async (response: Response): Promise<RpWebErrorV1> => {
  const body = await readErrorBody(response);
  const serverMessage = body.error.toLowerCase();
  const traceId = body.traceId;

  if (serverMessage.includes("usage budget") || serverMessage.includes("budget exceeded")) {
    return makeRpError(
      "budget",
      "This turn reached the model call or token budget.",
      false,
      traceId,
    );
  }

  if (response.status === 400) {
    return makeRpError("validation", "Request parameters are invalid.", false, traceId);
  }
  if (response.status === 404) {
    return makeRpError(
      "not-found",
      "Worldbook or official workflow was not found.",
      false,
      traceId,
    );
  }
  if (response.status === 409) {
    return makeRpError(
      "conflict",
      "Current turn was already submitted with different content. Start a new turn.",
      false,
      traceId,
    );
  }
  if (response.status === 422) {
    return makeRpError("validation", "Workflow input or structure is invalid.", false, traceId);
  }
  if (response.status >= 500) {
    return makeRpError("provider", "Model service temporarily failed.", true, traceId);
  }

  return makeRpError("unknown", "Official RP request failed.", true, traceId);
};

const readErrorBody = async (response: Response): Promise<{ error: string; traceId?: string }> => {
  try {
    const value = (await response.json()) as { error?: unknown; traceId?: unknown };
    return {
      error: typeof value.error === "string" ? value.error : "",
      traceId: typeof value.traceId === "string" ? value.traceId : undefined,
    };
  } catch {
    return { error: "" };
  }
};

const makeRpError = (
  kind: RpWebErrorV1["kind"],
  message: string,
  retryable: boolean,
  traceId?: string,
): RpWebErrorV1 => ({
  kind,
  message,
  retryable,
  ...(traceId ? { traceId } : {}),
});

const isRpWebError = (error: unknown): error is RpWebErrorV1 =>
  Boolean(
    error &&
    typeof error === "object" &&
    "kind" in error &&
    "message" in error &&
    "retryable" in error,
  );

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException ? error.name === "AbortError" : false;
