import { findSiteAdapter } from "../src/adapters";
import { hydrateLinkedInSearchResults } from "../src/adapters/linkedin/search";
import {
  advanceLinkedInReviewOnlyStep,
  openLinkedInEasyApply,
  submitLinkedInApplication,
} from "../src/adapters/linkedin/review-only-controller";
import { applyLinkedInReviewOnlyAnswers } from "../src/adapters/linkedin/review-only-executor";
import {
  extractLinkedInExistingResumeNames,
  extractLinkedInProfileResumeNames,
  isLinkedInProfileResumeUploaded,
  selectExistingLinkedInResume,
  verifyLinkedInResumeAttachment,
} from "../src/adapters/linkedin/resume-selection";
import type { ApplicationAnswerPlanRecord } from "@rapidapply/contracts";
import { createApplicationInterventionPrompt } from "../src/intervention/prompt";
import {
  isShowApplicationInterventionCommand,
} from "../src/intervention/messages";
import { startPageObserver } from "../src/observer/page-observer";
import {
  isLinkedInSearchDiscoveryCommand,
  type AdapterObservationMessage,
  type AdapterObservationResponse,
  type LinkedInSearchDiscoveryResultMessage,
} from "../src/observer/messages";
import { defineContentScript } from "wxt/utils/define-content-script";

function logStep(step: string, event: string, context?: Record<string, unknown>): void {
  const time = new Date().toISOString().split("T")[1]?.slice(0, 12) ?? "";
  console.log(`[RapidApply ${time}] [${step}] ${event}`, context ?? "");
}

export default defineContentScript({
  matches: ["https://www.linkedin.com/*"],
  runAt: "document_idle",
  main(ctx) {
    const adapter = findSiteAdapter(new URL(window.location.href));
    if (!adapter) return;
    let discoveryInFlight: string | null = null;
    let lastObservationDeliveryFailure: string | null = null;
    let activeInterventionId = "";
    let observer: ReturnType<typeof startPageObserver> | null = null;
    let disposed = false;
    let runtimeInvalidated = false;
    let confirmationRecoveryReloadRequested = false;
    let lastObservedPageType: string | undefined;

    const prompt = createApplicationInterventionPrompt(document, {
      onAnswer: async (response) => {
        const current = await sendRuntimeMessage({
          type: "rapidapply.answer-application-intervention",
          interventionId: activeInterventionId,
          response,
        });
        if (!isPromptActionResponse(current)) {
          throw new Error("RapidApply could not save that application answer.");
        }
        return current.next;
      },
      onDefer: async () => {
        const current = await sendRuntimeMessage({
          type: "rapidapply.defer-application-intervention",
          interventionId: activeInterventionId,
        });
        if (!isPromptActionResponse(current)) {
          throw new Error("RapidApply could not save this application for later.");
        }
        return current.next;
      },
      onTouch: async () => {
        const current = await sendRuntimeMessage({
          type: "rapidapply.touch-application-intervention",
          interventionId: activeInterventionId,
        });
        return isPromptTouchResponse(current) ? current.intervention : undefined;
      },
    });

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      observer?.stop();
      prompt.destroy();
    };

    const hasLiveRuntime = (): boolean => {
      if (disposed || ctx.isInvalid) {
        runtimeInvalidated = true;
        dispose();
        return false;
      }
      return true;
    };

    /**
     * Every page-originated message goes through one liveness gate. An
     * unpacked extension reload invalidates chrome.runtime in the old content
     * script without reloading LinkedIn, so a raw heartbeat would otherwise
     * keep attempting sends against chrome-extension://invalid/ forever.
     */
    const sendRuntimeMessage = async (message: unknown): Promise<unknown> => {
      if (!hasLiveRuntime()) return null;
      try {
        return await chrome.runtime.sendMessage(message);
      } catch (error) {
        if (isExtensionRuntimeUnavailable(error) || ctx.isInvalid) {
          runtimeInvalidated = true;
          ctx.notifyInvalidated();
        }
        return null;
      }
    };

    observer = startPageObserver({
      adapter,
      document,
      location: window.location,
      signal: ctx.signal,
        onObservation: async (observation) => {
        lastObservedPageType = observation.pageType;
        logStep("observer.inspect", "Observed page state", {
          pageType: observation.pageType,
          step: observation.applicationStep,
          fields: observation.fields.length,
          actions: observation.actions.length,
          fingerprint: observation.fingerprint,
        });

        const response = await sendRuntimeMessage({
          type: "rapidapply.adapter-observation",
          observation,
        } satisfies AdapterObservationMessage);

        if (!hasLiveRuntime()) {
          lastObservationDeliveryFailure = "runtime_unavailable";
          logStep("observer.delivery_failed", "RapidApply content script lost its extension runtime.", {
            pageType: observation.pageType,
          });
          if (
            runtimeInvalidated &&
            lastObservedPageType === "application_confirmation" &&
            !confirmationRecoveryReloadRequested
          ) {
            confirmationRecoveryReloadRequested = true;
            logStep("observer.recovery", "Reloading the confirmed application page to reattach RapidApply.");
            window.setTimeout(() => window.location.reload(), 250);
          }
          return false;
        }

        if (!isAcceptedAdapterObservationResponse(response)) {
          logStep("observer.delivery_failed", "Background rejected observation", {
            reason: isRecord(response) && typeof response.reason === "string" ? response.reason : "unknown",
          });
          lastObservationDeliveryFailure = "observation_delivery_failed";
          if (
            runtimeInvalidated &&
            lastObservedPageType === "application_confirmation" &&
            !confirmationRecoveryReloadRequested
          ) {
            confirmationRecoveryReloadRequested = true;
            logStep("observer.recovery", "Reloading the confirmed application page to reattach RapidApply.");
            window.setTimeout(() => window.location.reload(), 250);
          }
          return false;
        }

        lastObservationDeliveryFailure = null;

        const command = readDiscoveryCommand(response);
        if (!command) return true;

        const commandKey = `${command.runId}:${command.pageIndex}`;
        if (discoveryInFlight === commandKey) return;
        discoveryInFlight = commandKey;

        try {
          const result = await hydrateLinkedInSearchResults(
            document,
            new URL(window.location.href),
          );
          await sendDiscoveryResultWithRetry({
            type: "rapidapply.linkedin-search-discovery",
            runId: command.runId,
            pageIndex: command.pageIndex,
            cycles: result.cycles,
            jobs: result.jobs,
          }, sendRuntimeMessage, hasLiveRuntime);
        } finally {
          discoveryInFlight = null;
        }
        return true;
      },
    });

    ctx.onInvalidated(dispose);

    chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!hasLiveRuntime()) return;
      if (!isRecord(message)) return;
      if (message.type === "rapidapply.flush-observation") {
        void observer!.flush()
          .then((delivered) => sendResponse({
            ok: delivered,
            ...(delivered
              ? {}
              : { reason: lastObservationDeliveryFailure ?? "observation_delivery_failed" }),
          }))
          .catch(() => sendResponse({ ok: false, reason: "observation_delivery_failed" }));
        return true;
      }
      if (message.type === "rapidapply.open-review-only-application") {
        logStep("observer.open_application", "Opening LinkedIn Easy Apply modal...");
        void openLinkedInEasyApply(document)
          .then(() => sendResponse({ ok: true }))
          .catch((error: unknown) => sendResponse({
            ok: false,
            reason: errorMessage(error),
            code: isLinkedInApplicationOpenError(error) ? error.code : undefined,
          }));
        return true;
      }
      if (message.type === "rapidapply.inspect-review-only-application") {
        const observation = adapter.inspect({ document, url: new URL(window.location.href) });
        sendResponse({ ok: true, pageType: observation.pageType });
        return;
      }
      if (message.type === "rapidapply.apply-review-only-answers" && Array.isArray(message.plans)) {
        const observation = adapter.inspect({ document, url: new URL(window.location.href) });
        logStep("observer.fill_start", `Filling form with ${message.plans.length} answer plans...`);
        void applyLinkedInReviewOnlyAnswers({
          document,
          observation,
          plans: message.plans as ApplicationAnswerPlanRecord[],
        })
          .then((result) => {
            logStep("observer.fill_complete", "Finished applying answer plans", {
              applied: result.appliedFieldKeys.length,
              satisfied: result.alreadySatisfiedFieldKeys.length,
              blocked: result.blocked.length,
              blockedDetails: result.blocked,
            });
            sendResponse({ ok: true, result });
          })
          .catch((error: unknown) => sendResponse({ ok: false, reason: errorMessage(error) }));
        return true;
      }
      if (message.type === "rapidapply.advance-review-only-application") {
        logStep("observer.advance_start", "Advancing form step (clicking Next/Continue)...");
        void advanceLinkedInReviewOnlyStep(document)
          .then((result) => {
            logStep("observer.advance_complete", `Step advance completed: ${result}`);
            sendResponse({ ok: true, result });
          })
          .catch((error: unknown) => sendResponse({ ok: false, reason: errorMessage(error) }));
        return true;
      }
      if (message.type === "rapidapply.select-existing-resume" && typeof message.fileName === "string") {
        void selectExistingLinkedInResume(document, message.fileName)
          .then((result) => sendResponse({ ok: true, result }))
          .catch((error: unknown) => sendResponse({ ok: false, reason: errorMessage(error) }));
        return true;
      }
      if (message.type === "rapidapply.check-profile-resume" && typeof message.fileName === "string") {
        const uploaded = isLinkedInProfileResumeUploaded(document, message.fileName);
        sendResponse({ ok: true, verified: uploaded });
        return;
      }
      if (message.type === "rapidapply.list-profile-resumes") {
        sendResponse({ ok: true, fileNames: extractLinkedInProfileResumeNames(document) });
        return;
      }
      if (message.type === "rapidapply.list-existing-application-resumes") {
        sendResponse({ ok: true, fileNames: extractLinkedInExistingResumeNames(document) });
        return;
      }
      if (message.type === "rapidapply.verify-resume-attachment" && typeof message.fileName === "string") {
        const fileName = message.fileName;
        void (async () => {
          for (let attempt = 0; attempt < 20; attempt++) {
            if (
              verifyLinkedInResumeAttachment(document, fileName) ||
              isLinkedInProfileResumeUploaded(document, fileName)
            ) {
              sendResponse({ ok: true, verified: true });
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
          sendResponse({ ok: true, verified: false });
        })();
        return true;
      }
      if (message.type === "rapidapply.submit-application") {
        void submitLinkedInApplication(document)
          .then((result) => sendResponse({ ok: true, result }))
          .catch((error: unknown) => sendResponse({ ok: false, reason: errorMessage(error) }));
        return true;
      }
      if (isShowApplicationInterventionCommand(message)) {
        activeInterventionId = message.intervention.id;
        prompt.show(message.intervention);
        sendResponse({ ok: true });
        return;
      }
    });
  },
});

function readDiscoveryCommand(value: unknown) {
  if (!isRecord(value) || value.ok !== true) return null;
  return isLinkedInSearchDiscoveryCommand(value.command) ? value.command : null;
}

function isLinkedInApplicationOpenError(
  value: unknown,
): value is { code: "easy_apply_unavailable" | "easy_apply_open_failed" } {
  return value instanceof Error &&
    ["easy_apply_unavailable", "easy_apply_open_failed"].includes(
      String((value as { code?: unknown }).code),
    );
}

function isAcceptedAdapterObservationResponse(value: unknown): value is AdapterObservationResponse {
  return isRecord(value) && value.ok === true;
}

async function sendDiscoveryResultWithRetry(
  message: LinkedInSearchDiscoveryResultMessage,
  sendMessage: (message: LinkedInSearchDiscoveryResultMessage) => Promise<unknown>,
  hasLiveRuntime: () => boolean,
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (!hasLiveRuntime()) {
      throw new Error("RapidApply browser helper was reloaded. Refresh this LinkedIn tab to continue.");
    }
    const response = await sendMessage(message);
    if (!hasLiveRuntime()) {
      throw new Error("RapidApply browser helper was reloaded. Refresh this LinkedIn tab to continue.");
    }
    if (isRecord(response) && response.ok === true) return;
    if (attempt < 3) await wait(attempt * 300);
  }
  throw new Error("RapidApply could not checkpoint the LinkedIn discovery page.");
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "RapidApply could not complete this browser step.";
}

function isExtensionRuntimeUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("extension context invalidated") ||
    message.includes("receiving end does not exist") ||
    message.includes("could not establish connection");
}

function isPromptActionResponse(value: unknown): value is {
  ok: true;
  next?: import("@rapidapply/contracts").ApplicationIntervention;
} {
  return isRecord(value) && value.ok === true &&
    (value.next === undefined || isRecord(value.next) && typeof value.next.id === "string");
}

function isPromptTouchResponse(value: unknown): value is {
  ok: true;
  intervention: import("@rapidapply/contracts").ApplicationIntervention;
} {
  return isRecord(value) && value.ok === true && isRecord(value.intervention) &&
    typeof value.intervention.id === "string";
}
