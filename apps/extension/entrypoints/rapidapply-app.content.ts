import {
  EXTENSION_BRIDGE_SOURCE,
  isExtensionApplicationInterventionsUpdatedMessage,
  isBrowserRunSummary,
  isExtensionPingMessage,
  isExtensionRunHandoffMessage,
  isExtensionRunLaunchAcknowledgementMessage,
  isExtensionRunStateSyncMessage,
  isRunState,
  type BrowserRunSummary,
} from "@rapidapply/contracts";
import { defineContentScript } from "wxt/utils/define-content-script";

interface HandoffSucceeded {
  ok: true;
  run: BrowserRunSummary;
}

interface HandoffFailed {
  ok: false;
  reason: string;
}

export default defineContentScript({
  matches: [
    "http://localhost:3000/*",
    "http://localhost:3001/*",
    "https://rapidapply.so/*",
    "https://www.rapidapply.so/*",
  ],
  runAt: "document_idle",
  main() {
    // An extension reload invalidates already-injected content scripts. Keep
    // every Chrome API call behind a safe boundary so an old script simply
    // becomes inert instead of surfacing a noisy page-level exception.
    const extensionVersion = readExtensionVersion();
    const announceAvailability = async () => {
      const status = await safeRuntimeMessage({
        type: "rapidapply.execution-status",
        origin: window.location.origin,
      });

      window.postMessage(
        {
          source: EXTENSION_BRIDGE_SOURCE,
          type: "EXTENSION_READY",
          version: extensionVersion,
          ...readPublicExecutionStatus(status),
        },
        window.location.origin,
      );
    };

    window.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) return;

      if (isExtensionPingMessage(event.data)) {
        void announceAvailability();
        return;
      }

      if (isExtensionRunHandoffMessage(event.data)) {
        if (!isLaunchPageForRun(event.data.executionTicket.runId)) return;
        void forwardHandoff(event.data.executionTicket);
        return;
      }

      if (isExtensionRunStateSyncMessage(event.data)) {
        void safeRuntimeMessage({
          type: "rapidapply.execution-state-sync",
          origin: window.location.origin,
          runId: event.data.runId,
          state: event.data.state,
        });
        return;
      }

      if (isExtensionApplicationInterventionsUpdatedMessage(event.data)) {
        void safeRuntimeMessage({
          type: "rapidapply.application-interventions-updated",
          origin: window.location.origin,
          runId: event.data.runId,
        });
        return;
      }

      if (!isExtensionRunLaunchAcknowledgementMessage(event.data)) return;
      if (isLaunchPageForRun(event.data.runId)) {
        void forwardLaunchAcknowledgement(event.data.runId);
      }
    });

    void safeRuntimeMessage({
      type: "rapidapply.web-app-ready",
      origin: window.location.origin,
    });
    void announceAvailability();

    async function forwardHandoff(executionTicket: {
      runId: string;
      token: string;
      expiresAt: string;
    }): Promise<void> {
      try {
        const result = await safeRuntimeMessage({
          type: "rapidapply.execution-handoff",
          origin: window.location.origin,
          executionTicket,
        });

        if (isHandoffSucceeded(result)) {
          window.postMessage(
            {
              source: EXTENSION_BRIDGE_SOURCE,
              type: "EXTENSION_RUN_CLAIMED",
              run: result.run,
            },
            window.location.origin,
          );
          return;
        }

        postClaimFailure(
          executionTicket.runId,
          isHandoffFailed(result)
            ? result.reason
            : "RapidApply could not prepare this campaign.",
        );
      } catch {
        postClaimFailure(
          executionTicket.runId,
          "RapidApply could not prepare this campaign.",
        );
      }
    }

    async function forwardLaunchAcknowledgement(runId: string): Promise<void> {
      const response = await safeRuntimeMessage({
        type: "rapidapply.execution-launch-acknowledged",
        origin: window.location.origin,
        runId,
      });

      if (!isRecord(response) || response.ok !== true) {
        postClaimFailure(
          runId,
          "The browser helper claimed this campaign but could not open LinkedIn. Retry the handoff from RapidApply.",
        );
      }
    }

    function postClaimFailure(runId: string, reason: string): void {
      window.postMessage(
        {
          source: EXTENSION_BRIDGE_SOURCE,
          type: "EXTENSION_RUN_CLAIM_FAILED",
          runId,
          reason,
        },
        window.location.origin,
      );
    }
  },
});

function isLaunchPageForRun(runId: string): boolean {
  return window.location.pathname === `/launch/${runId}`;
}

function readPublicExecutionStatus(value: unknown): {
  activeRunId?: string;
  executionState?: BrowserRunSummary["state"];
} {
  if (!isRecord(value) || value.ok !== true) return {};
  return {
    activeRunId: typeof value.activeRunId === "string" ? value.activeRunId : undefined,
    executionState: isRunState(value.executionState) ? value.executionState : undefined,
  };
}

function isHandoffSucceeded(value: unknown): value is HandoffSucceeded {
  return isRecord(value) && value.ok === true && isBrowserRunSummary(value.run);
}

function isHandoffFailed(value: unknown): value is HandoffFailed {
  return isRecord(value) && value.ok === false && typeof value.reason === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readExtensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "unavailable";
  }
}

function safeRuntimeMessage(message: Record<string, unknown>): Promise<unknown | null> {
  try {
    return chrome.runtime.sendMessage(message).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}
