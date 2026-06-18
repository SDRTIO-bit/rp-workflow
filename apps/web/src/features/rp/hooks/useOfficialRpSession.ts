import { useEffect, useRef, useState } from "react";
import { runOfficialRpTurn } from "../../../officialRpClient";
import {
  buildOfficialRpRequest,
  clearPendingCardSession,
  createInitialRpSession,
  getPendingCardSession,
  initializeCardRpSession,
  markRpTurnCanceled,
  markRpTurnFailed,
  markRpTurnSucceeded,
  prepareRpTurn,
  resetRpSession,
  restoreRpSession,
  serializeRpSession,
  type RpChatSessionV1,
} from "../../../rpSessionState";

const rpSessionStorageKey = "awp:official-rp-session:v1";
const continueText = "继续";

const loadRpSession = (): RpChatSessionV1 => {
  // Check for pending card session first (from Cards page initialization)
  const pendingCard = getPendingCardSession();
  if (pendingCard) {
    clearPendingCardSession();
    return initializeCardRpSession(pendingCard);
  }

  try {
    const stored = window.sessionStorage.getItem(rpSessionStorageKey);
    return restoreRpSession(stored ? JSON.parse(stored) : undefined);
  } catch {
    return createInitialRpSession();
  }
};

export const useOfficialRpSession = () => {
  const [session, setSession] = useState<RpChatSessionV1>(loadRpSession);
  const [draft, setDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    window.sessionStorage.setItem(rpSessionStorageKey, JSON.stringify(serializeRpSession(session)));
  }, [session]);

  const submit = async (input: string) => {
    const prepared = prepareRpTurn(session, input);
    if (prepared === session || prepared.status !== "sending") return;

    setSession(prepared);
    setDraft("");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await runOfficialRpTurn(buildOfficialRpRequest(prepared), {
        signal: controller.signal,
      });
      setSession((current) => markRpTurnSucceeded(current, response));
    } catch (error) {
      setDraft(input);
      setSession((current) => markRpTurnFailed(current, error as never));
    } finally {
      abortRef.current = null;
    }
  };

  const retry = () => {
    if (session.pendingTurn) {
      void submit(session.pendingTurn.userInput);
    }
  };

  const continueTurn = () => void submit(continueText);

  const cancel = () => {
    abortRef.current?.abort();
    setSession((current) => markRpTurnCanceled(current));
  };

  const newSession = () => {
    abortRef.current?.abort();
    setSession((current) => resetRpSession(current));
    setDraft("");
  };

  return {
    session,
    draft,
    setDraft,
    submit,
    retry,
    continueTurn,
    cancel,
    newSession,
    isSending: session.status === "sending",
  };
};
