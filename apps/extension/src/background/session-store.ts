import type { ExtensionExecutionSession } from "@rapidapply/contracts";
import {
  isExtensionExecutionSession,
  normalizePersistedExecutionSession,
  upgradeLegacyExecutionSession,
} from "../execution/session";

const EXECUTION_SESSION_KEY = "rapidapply.execution-session";

/**
 * This state is extension-private and survives both service-worker suspension
 * and browser restarts. The backend remains the durable source of truth for
 * the campaign; this local checkpoint is what lets the exact executor tab
 * safely resume page-by-page work after Chrome wakes the worker again.
 */
export async function saveExecutionSession(session: ExtensionExecutionSession): Promise<void> {
  await chrome.storage.local.set({ [EXECUTION_SESSION_KEY]: session });
}

export async function getExecutionSession(): Promise<ExtensionExecutionSession | null> {
  const result = await chrome.storage.local.get(EXECUTION_SESSION_KEY);
  const session = result[EXECUTION_SESSION_KEY];
  if (session === undefined) return null;
  if (isExtensionExecutionSession(session)) {
    const normalized = normalizePersistedExecutionSession(session);
    if (normalized !== session) await saveExecutionSession(normalized);
    return normalized;
  }

  const upgraded = upgradeLegacyExecutionSession(session);
  if (upgraded) {
    await saveExecutionSession(upgraded);
    return upgraded;
  }

  // Never attempt recovery from a stale or partially written schema.
  await chrome.storage.local.remove(EXECUTION_SESSION_KEY);
  return null;
}

export async function clearExecutionSession(): Promise<void> {
  await chrome.storage.local.remove(EXECUTION_SESSION_KEY);
}
