export type ObservationFlushOutcome = "flushed" | "injected" | "reloaded" | "unavailable";

export interface FlushObservationAfterResumeOptions {
  tabId: number;
  send: (message: { type: "rapidapply.flush-observation" }) => Promise<unknown>;
  inject: (tabId: number) => Promise<unknown>;
  reload: (tabId: number) => Promise<unknown>;
}

/**
 * Gives the exact executor tab one chance to report its current DOM after a
 * campaign resumes. A Chrome extension reload invalidates content scripts
 * already present in open pages; when Chrome reports that specific condition,
 * reloading the stored executor tab is the narrowest safe recovery. The
 * LinkedIn observer is then reinjected at document idle and reports a fresh
 * observation on its own.
 *
 * This does not retry page actions, navigate to a new job, upload a résumé,
 * or submit anything. It repairs only the local observer transport.
 */
export async function flushObservationAfterResume({
  tabId,
  send,
  inject,
  reload,
}: FlushObservationAfterResumeOptions): Promise<ObservationFlushOutcome> {
  let repairable = false;
  try {
    const response = await send({ type: "rapidapply.flush-observation" });
    if (isFlushAcknowledged(response)) return "flushed";
    // Chrome can resolve an extension-reload message without a response when
    // its receiver belongs to the invalidated extension context. Treat only
    // that absent acknowledgement as a reason to refresh the exact tab.
    if (response !== undefined && response !== null && !isRepairableResponse(response)) {
      return "unavailable";
    }
    repairable = true;
  } catch (error) {
    if (!isMissingContentScriptError(error)) return "unavailable";
    repairable = true;
  }

  // Reinject the packaged observer before considering a whole-page reload.
  // This preserves the open Easy Apply modal and every value LinkedIn already
  // accepted while replacing only the invalidated extension execution world.
  if (repairable) {
    try {
      await inject(tabId);
      const response = await send({ type: "rapidapply.flush-observation" });
      if (isFlushAcknowledged(response)) return "injected";
    } catch {
      // Fall through to the exact-tab reload as a last-resort recovery.
    }
  }

  try {
    await reload(tabId);
    return "reloaded";
  } catch {
    return "unavailable";
  }
}

function isMissingContentScriptError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("receiving end does not exist") ||
    message.includes("could not establish connection");
}

function isFlushAcknowledged(value: unknown): value is { ok: true } {
  return typeof value === "object" && value !== null &&
    "ok" in value && (value as { ok?: unknown }).ok === true;
}

function isRepairableResponse(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    "ok" in value && "reason" in value &&
    (value as { ok?: unknown }).ok === false &&
    ["runtime_unavailable", "observation_delivery_failed"].includes(
      String((value as { reason?: unknown }).reason),
    );
}
