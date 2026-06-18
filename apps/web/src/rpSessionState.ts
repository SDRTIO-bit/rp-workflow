import type { OfficialRpRequestV1, OfficialRpResponseV1, RpWebErrorV1 } from "./officialRpClient";

export type RpChatMessageV1 = {
  id: string;
  role: "user" | "assistant";
  text: string;
  turnId: string;
  createdAt: string;
  source?: "greeting";
};

export type RpChatSessionV1 = {
  sessionId: string;
  nextTurnNumber: number;
  messages: RpChatMessageV1[];
  worldbookResourceRef: string;
  memoryNamespace: string;
  status: "idle" | "sending" | "error";
  pendingTurn?: {
    turnId: string;
    turnNumber: number;
    userInput: string;
  };
  lastQuality?: OfficialRpResponseV1["quality"];
  lastObservability?: OfficialRpResponseV1["observability"];
  lastError?: RpWebErrorV1;
};

type Clock = () => string;

export const createInitialRpSession = (
  options: {
    sessionId?: string;
    worldbookResourceRef?: string;
    now?: Clock;
  } = {},
): RpChatSessionV1 => {
  const sessionId = options.sessionId ?? createSessionId();
  return {
    sessionId,
    nextTurnNumber: 1,
    messages: [],
    worldbookResourceRef: options.worldbookResourceRef ?? "worldbook-default",
    memoryNamespace: `rp-session:${sessionId}`,
    status: "idle",
  };
};

export const resetRpSession = (
  session: RpChatSessionV1,
  options: { sessionId?: string } = {},
): RpChatSessionV1 =>
  createInitialRpSession({
    sessionId: options.sessionId,
    worldbookResourceRef: session.worldbookResourceRef,
  });

export const prepareRpTurn = (
  session: RpChatSessionV1,
  userInput: string,
  options: { now?: Clock } = {},
): RpChatSessionV1 => {
  const normalizedInput = userInput.trim();
  if (!normalizedInput) {
    return session;
  }

  const pendingTurn = session.pendingTurn;
  const retryingSameInput = pendingTurn && pendingTurn.userInput === normalizedInput;
  const turnNumber = retryingSameInput
    ? pendingTurn.turnNumber
    : pendingTurn
      ? pendingTurn.turnNumber + 1
      : session.nextTurnNumber;
  const turnId = retryingSameInput ? pendingTurn.turnId : formatTurnId(turnNumber);
  const messageId = `user-${turnId}`;
  const existingUserMessage = session.messages.find(
    (message) => message.role === "user" && message.turnId === turnId,
  );
  const messages = existingUserMessage
    ? session.messages
    : [
        ...session.messages.filter((message) => message.turnId !== pendingTurn?.turnId),
        {
          id: messageId,
          role: "user" as const,
          text: normalizedInput,
          turnId,
          createdAt: now(options.now),
        },
      ];

  return {
    ...session,
    messages,
    status: "sending",
    pendingTurn: {
      turnId,
      turnNumber,
      userInput: normalizedInput,
    },
    lastError: undefined,
  };
};

export const markRpTurnFailed = (
  session: RpChatSessionV1,
  error: RpWebErrorV1,
): RpChatSessionV1 => ({
  ...session,
  status: "error",
  lastError: error,
});

export const markRpTurnCanceled = (session: RpChatSessionV1): RpChatSessionV1 =>
  markRpTurnFailed(session, {
    kind: "aborted",
    message: "Request was canceled.",
    retryable: true,
  });

export const markRpTurnSucceeded = (
  session: RpChatSessionV1,
  response: Pick<OfficialRpResponseV1, "narrative" | "quality" | "observability">,
  options: { now?: Clock } = {},
): RpChatSessionV1 => {
  const pendingTurn = session.pendingTurn;
  if (!pendingTurn) {
    return {
      ...session,
      status: "idle",
      lastQuality: response.quality,
      lastObservability: response.observability,
      lastError: undefined,
    };
  }

  return {
    ...session,
    nextTurnNumber: pendingTurn.turnNumber + 1,
    messages: [
      ...session.messages,
      {
        id: `assistant-${pendingTurn.turnId}`,
        role: "assistant",
        text: response.narrative,
        turnId: pendingTurn.turnId,
        createdAt: now(options.now),
      },
    ],
    status: "idle",
    pendingTurn: undefined,
    lastQuality: response.quality,
    lastObservability: response.observability,
    lastError: undefined,
  };
};

export const buildOfficialRpRequest = (session: RpChatSessionV1): OfficialRpRequestV1 => {
  if (!session.pendingTurn) {
    throw new Error("Cannot build an RP request without a pending turn.");
  }
  return {
    sessionId: session.sessionId,
    turnId: session.pendingTurn.turnId,
    userInput: session.pendingTurn.userInput,
    worldbook: {
      resourceRef: session.worldbookResourceRef,
    },
    memory: {
      namespace: session.memoryNamespace,
    },
  };
};

export const serializeRpSession = (
  session: RpChatSessionV1,
): Pick<
  RpChatSessionV1,
  "sessionId" | "nextTurnNumber" | "messages" | "worldbookResourceRef" | "memoryNamespace"
> => ({
  sessionId: session.sessionId,
  nextTurnNumber: session.nextTurnNumber,
  messages: session.messages,
  worldbookResourceRef: session.worldbookResourceRef,
  memoryNamespace: session.memoryNamespace,
});

export const restoreRpSession = (
  value: unknown,
  fallback: RpChatSessionV1 = createInitialRpSession(),
): RpChatSessionV1 => {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const candidate = value as Partial<RpChatSessionV1>;
  if (
    typeof candidate.sessionId !== "string" ||
    typeof candidate.nextTurnNumber !== "number" ||
    !Array.isArray(candidate.messages) ||
    typeof candidate.worldbookResourceRef !== "string" ||
    typeof candidate.memoryNamespace !== "string"
  ) {
    return fallback;
  }
  return {
    sessionId: candidate.sessionId,
    nextTurnNumber: candidate.nextTurnNumber,
    messages: candidate.messages.filter(isRpChatMessage),
    worldbookResourceRef: candidate.worldbookResourceRef,
    memoryNamespace: candidate.memoryNamespace,
    status: "idle",
  };
};

// === Card Session Bridge ===

export type PendingCardSessionV1 = {
  sessionId: string;
  cardId: string;
  greetingId: string;
  greetingContent: string;
  worldbookResourceRef: string;
  memoryNamespace: string;
};

const pendingCardSessionKey = "awp:pending-card-session:v1";

type MinimalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const getSessionStorage = (): MinimalStorage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export const setPendingCardSession = (
  session: PendingCardSessionV1,
  storage: MinimalStorage = getSessionStorage()!,
): void => {
  storage.setItem(pendingCardSessionKey, JSON.stringify(session));
};

export const getPendingCardSession = (
  storage: MinimalStorage = getSessionStorage()!,
): PendingCardSessionV1 | null => {
  if (!storage) return null;
  try {
    const stored = storage.getItem(pendingCardSessionKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<PendingCardSessionV1>;
    if (
      typeof parsed.sessionId !== "string" ||
      typeof parsed.cardId !== "string" ||
      typeof parsed.greetingId !== "string" ||
      typeof parsed.greetingContent !== "string" ||
      typeof parsed.worldbookResourceRef !== "string" ||
      typeof parsed.memoryNamespace !== "string"
    ) {
      return null;
    }
    return parsed as PendingCardSessionV1;
  } catch {
    return null;
  }
};

export const clearPendingCardSession = (storage: MinimalStorage = getSessionStorage()!): void => {
  if (!storage) return;
  storage.removeItem(pendingCardSessionKey);
};

export const initializeCardRpSession = (
  pending: PendingCardSessionV1,
  options: { now?: Clock } = {},
): RpChatSessionV1 => ({
  sessionId: pending.sessionId,
  nextTurnNumber: 1,
  messages: [
    {
      id: "assistant-greeting",
      role: "assistant",
      text: pending.greetingContent,
      turnId: "greeting",
      createdAt: now(options.now),
      source: "greeting",
    },
  ],
  worldbookResourceRef: pending.worldbookResourceRef,
  memoryNamespace: pending.memoryNamespace,
  status: "idle",
});

export const formatTurnId = (turnNumber: number): string =>
  `turn-${String(Math.max(1, turnNumber)).padStart(4, "0")}`;

const createSessionId = (): string => {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `rp-web-${uuid}`;
};

const now = (clock?: Clock): string => (clock ? clock() : new Date().toISOString());

const isRpChatMessage = (value: unknown): value is RpChatMessageV1 => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as Partial<RpChatMessageV1>;
  return (
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.text === "string" &&
    typeof message.turnId === "string" &&
    typeof message.createdAt === "string"
  );
};
