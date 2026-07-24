import type {
  AutonomyPolicy,
  AwaitingUserContext,
  BrowserExecutionTicket,
  BrowserRunSummary,
  ExecutorClaimResponse,
  ExecutorRunEventType,
  ExtensionExecutionSession,
} from "@rapidapply/contracts";
import {
  isBrowserExecutionPlan,
  isBrowserExecutionTicket,
  isBrowserExecutorEventCapability,
  isBrowserRunSummary,
} from "@rapidapply/contracts";
import { defineBackground } from "wxt/utils/define-background";
import {
  appendRecordingEntry,
  clearExecutionRecording,
  getExecutionRecording,
  listRecordingSummaries,
  lockLocalStorageToTrustedContexts,
} from "../src/background/recording-store";
import {
  clickTrustedLinkedInAction,
  hasTrustedInputPermission,
} from "../src/background/trusted-input";
import { waitForContentCommand } from "../src/background/content-command";
import { prepareLinkedInResume } from "../src/background/linkedin-resume";
import { ensureLinkedInProfileResumeUploaded } from "../src/background/profile-resume-preflight";
import {
  downloadExecutorResume,
  findReusableManagedResume,
  requestExecutorResumeAudit,
  requestExecutorResumeDocument,
} from "../src/background/resume-document";
import {
  ApplicationAnswerPlanningError,
  requestApplicationAnswerPlans,
} from "../src/background/application-answer-plan";
import {
  answerApplicationIntervention,
  deferApplicationIntervention,
  deferExecutorJob,
  requestApplicationInterventions,
  touchApplicationIntervention,
} from "../src/background/application-interventions";
import { describeActionableApplicationFields } from "../src/application/field-descriptor";
import {
  isResumeSelectionField,
  needsManualResumeSelection,
} from "../src/application/resume-gate";
import type { ApplicationAnswerPlanRecord } from "@rapidapply/contracts";
import {
  clearExecutionSession,
  getExecutionSession,
  saveExecutionSession,
} from "../src/background/session-store";
import {
  acceptDiscoveryPage,
  beginJobObservationQualification,
  beginJobQualification,
  beginSearchDiscovery,
  beginSearchNavigation,
  completeJobQualification,
  createExecutionSession,
  isExpectedLinkedInJobUrl,
  isAwaitingLinkedInSubmissionConfirmation,
  ownsExecutorTab,
  qualifyLinkedInJobObservation,
  rebindExecutionSession,
  resumeExecutionSession,
  shouldRepairExecutorObservation,
  shouldRecoverLinkedInEasyApplyOpening,
  type LinkedInJobQualification,
} from "../src/execution/session";
import type { AdapterObservation } from "../src/adapters/types";
import {
  isAdapterObservationMessage,
  isLinkedInSearchDiscoveryResultMessage,
  isRecordingClearRequest,
  isRecordingExportRequest,
  isRecordingStatusRequest,
  type AdapterObservationMessage,
  type AdapterObservationResponse,
  type LinkedInSearchDiscoveryResultMessage,
} from "../src/observer/messages";
import {
  sendReviewOnlyFillWithRetry,
  type ReviewOnlyFillResult,
} from "../src/observer/review-only-fill-message";
import { flushObservationAfterResume } from "../src/observer/observation-flush";
import {
  isAnswerApplicationInterventionMessage,
  isDeferApplicationInterventionMessage,
  isTouchApplicationInterventionMessage,
  type AnswerApplicationInterventionMessage,
  type DeferApplicationInterventionMessage,
  type TouchApplicationInterventionMessage,
} from "../src/intervention/messages";

const RAPIDAPPLY_WEB_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:3001",
  "https://rapidapply.so",
  "https://www.rapidapply.so",
]);
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
const activeSubmissionTransitions = new Set<string>();
const DIRECT_EASY_APPLY_COMMAND_TIMEOUT_MS = 9_000;

class StaleExecutorCapabilityError extends Error {
  constructor() {
    super("The stored executor capability is no longer valid.");
    this.name = "StaleExecutorCapabilityError";
  }
}

interface WebAppReadyMessage {
  type: "rapidapply.web-app-ready";
  origin: string;
}

interface PublicExecutionStatusRequest {
  type: "rapidapply.execution-status";
  origin: string;
}

interface ExecutionHandoffRequest {
  type: "rapidapply.execution-handoff";
  origin: string;
  executionTicket: BrowserExecutionTicket;
}

interface ExecutionLaunchAcknowledgementRequest {
  type: "rapidapply.execution-launch-acknowledged";
  origin: string;
  runId: string;
}

interface ExecutionStateSyncRequest {
  type: "rapidapply.execution-state-sync";
  origin: string;
  runId: string;
  state: "running" | "paused" | "needs_user_input" | "cancelled";
}

interface ApplicationInterventionsUpdatedRequest {
  type: "rapidapply.application-interventions-updated";
  origin: string;
  runId: string;
}

interface ExecutionHandoffSuccess {
  ok: true;
  run: BrowserRunSummary;
}

interface ExecutionHandoffFailure {
  ok: false;
  reason: string;
}

type ExecutionHandoffResponse = ExecutionHandoffSuccess | ExecutionHandoffFailure;

export interface ExecutorEventReport {
  type: ExecutorRunEventType;
  idempotencyKey: string;
  detail?: Record<string, string | number | boolean | null>;
  occurredAt?: string;
}

export default defineBackground(() => {
  void lockLocalStorageToTrustedContexts();
  void reconcileStoredExecutorTab();

  chrome.runtime.onInstalled.addListener(() => {
    chrome.action.setTitle({ title: "RapidApply Browser Helper" });
    void lockLocalStorageToTrustedContexts();
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void clearRemovedExecutorTab(tabId);
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (isAnswerApplicationInterventionMessage(message)) {
      if (sender.id !== chrome.runtime.id || !isTrustedLinkedInSender(sender)) {
        sendResponse({ ok: false, reason: "untrusted_sender" });
        return;
      }
      void handleApplicationInterventionAnswer(message, sender)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, reason: "answer_failed" }));
      return true;
    }

    if (isDeferApplicationInterventionMessage(message)) {
      if (sender.id !== chrome.runtime.id || !isTrustedLinkedInSender(sender)) {
        sendResponse({ ok: false, reason: "untrusted_sender" });
        return;
      }
      void handleApplicationInterventionDeferral(message, sender)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, reason: "defer_failed" }));
      return true;
    }

    if (isTouchApplicationInterventionMessage(message)) {
      if (sender.id !== chrome.runtime.id || !isTrustedLinkedInSender(sender)) {
        sendResponse({ ok: false, reason: "untrusted_sender" });
        return;
      }
      void handleApplicationInterventionTouch(message, sender)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, reason: "touch_failed" }));
      return true;
    }

    if (isAdapterObservationMessage(message)) {
      void handleAdapterObservation(message, sender)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, reason: "observation_failed" }));
      return true;
    }

    if (isLinkedInSearchDiscoveryResultMessage(message)) {
      void handleLinkedInDiscoveryResult(message, sender)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, reason: "discovery_checkpoint_failed" }));
      return true;
    }

    if (isRecordingStatusRequest(message)) {
      void Promise.all([getExecutionSession(), listRecordingSummaries()])
        .then(([session, recordings]) => sendResponse({ ok: true, session, recordings }))
        .catch(() => sendResponse({ ok: false, reason: "status_failed" }));
      return true;
    }

    if (isRecordingExportRequest(message)) {
      void getExecutionRecording(message.runId)
        .then((recording) => sendResponse({ ok: true, recording }))
        .catch(() => sendResponse({ ok: false, reason: "export_failed" }));
      return true;
    }

    if (isRecordingClearRequest(message)) {
      void clearExecutionRecording(message.runId)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false, reason: "clear_failed" }));
      return true;
    }

    if (isPublicExecutionStatusRequest(message)) {
      if (!canAcceptRapidApplyPage(message.origin, sender)) {
        sendResponse({ ok: false });
        return;
      }
      void getExecutionSession()
        .then((session) => sendResponse({
          ok: true,
          activeRunId: session?.runId,
          executionState: session?.state,
        }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (isWebAppReadyMessage(message)) {
      markWebAppReady(message, sender);
      return;
    }

    if (isExecutionStateSyncRequest(message)) {
      if (!canAcceptRapidApplyPage(message.origin, sender)) {
        sendResponse({ ok: false, reason: "untrusted_sender" });
        return;
      }
      void synchronizeExecutionState(message)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, reason: "state_sync_failed" }));
      return true;
    }

    if (isApplicationInterventionsUpdatedRequest(message)) {
      if (!canAcceptRapidApplyPage(message.origin, sender)) {
        sendResponse({ ok: false, reason: "untrusted_sender" });
        return;
      }
      void refreshApplicationInterventions(message)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, reason: "intervention_refresh_failed" }));
      return true;
    }

    if (isExecutionLaunchAcknowledgementRequest(message)) {
      void acknowledgeExecutionLaunch(message, sender)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, reason: "launch_failed" }));
      return true;
    }

    if (!isExecutionHandoffRequest(message)) return;

    const executorTabId = sender.tab?.id;
    if (
      executorTabId === undefined ||
      !canAcceptLaunchPage(
        message.origin,
        message.executionTicket.runId,
        sender,
      )
    ) {
      sendResponse({
        ok: false,
        reason: "RapidApply could not verify this browser handoff.",
      } satisfies ExecutionHandoffFailure);
      return;
    }

    void claimExecutionHandoff(message, executorTabId)
      .then(sendResponse)
      .catch(() => sendResponse({
        ok: false,
        reason: "RapidApply could not prepare this campaign. Return to the app and try again.",
      } satisfies ExecutionHandoffFailure));
    return true;
  });
});

async function handleAdapterObservation(
  message: AdapterObservationMessage,
  sender: chrome.runtime.MessageSender,
): Promise<AdapterObservationResponse> {
  if (
    !canAcceptLinkedInObservation(message, sender) ||
    !sender.tab ||
    sender.tab.id === undefined
  ) {
    return { ok: false, reason: "untrusted_sender" };
  }

  const session = await getExecutionSession();
  if (!session) return { ok: false, reason: "no_active_execution" };
  if (!ownsExecutorTab(session, sender.tab.id)) {
    return { ok: false, reason: "not_executor_tab" };
  }
  if (TERMINAL_STATES.has(session.state)) {
    return { ok: false, reason: "terminal_execution" };
  }

  let currentSession = session;

  // LinkedIn's confirmation is authoritative only for the submit action that
  // this session is currently processing. A confirmation-shaped page observed
  // while navigating to another job is stale SPA state and must not consume
  // the next job before its Easy Apply flow starts.
  if (isAwaitingLinkedInSubmissionConfirmation(currentSession, message.observation)) {
    await completeConfirmedLinkedInSubmission(currentSession, message.observation);
    return { ok: true, recorded: false };
  }

  if (currentSession.state === "claimed" || currentSession.phase === "claimed") {
    const run = await reportExecutorEvent(currentSession, {
      type: "executor_started",
      idempotencyKey: `executor-started:${currentSession.executorSessionId}`,
      detail: {
        executorTabId: currentSession.executorTabId,
        adapterId: message.observation.adapterId,
        adapterVersion: message.observation.adapterVersion,
        mode: "linkedin-discovery",
      },
    });
    currentSession = beginSearchNavigation(withRun(currentSession, run));
    await saveExecutionSession(currentSession);
  }

  const tabId = sender.tab.id;
  const checkpointName = observationCheckpointName(currentSession, message);
  const existing = await getExecutionRecording(currentSession.runId);
  const alreadyRecorded = existing?.entries.some((entry) =>
    entry.tabId === tabId &&
    (entry.checkpointName
      ? entry.checkpointName === checkpointName
      : entry.observation.fingerprint === message.observation.fingerprint)
  ) ?? false;
  let appended = false;

  if (!alreadyRecorded) {
    currentSession = {
      ...currentSession,
      checkpoint: {
        name: checkpointName,
        attempt: currentSession.checkpoint.name === checkpointName
          ? currentSession.checkpoint.attempt + 1
          : 1,
        updatedAt: message.observation.observedAt,
      },
    };

    const recordingResult = await appendRecordingEntry({
      runId: currentSession.runId,
      executorSessionId: currentSession.executorSessionId,
      tabId,
      checkpointName,
      capturedAt: message.observation.observedAt,
      observation: message.observation,
    });
    appended = recordingResult.appended;

    if (appended && currentSession.state === "running") {
      const run = await reportExecutorEvent(currentSession, {
        type: "page_loaded",
        idempotencyKey: `page:${currentSession.runId}:${checkpointName}`,
        occurredAt: message.observation.observedAt,
        detail: {
          adapterId: message.observation.adapterId,
          adapterVersion: message.observation.adapterVersion,
          pageType: message.observation.pageType,
          path: message.observation.path,
          fingerprint: message.observation.fingerprint,
          fieldCount: message.observation.fields.length,
          actionCount: message.observation.actions.length,
          validationCount: message.observation.validationMessages.length,
        },
      });
      currentSession = withRun(currentSession, run);
    }
  }

  if (
    currentSession.state === "running" &&
    ["login_required", "security_challenge"].includes(message.observation.pageType)
  ) {
    const pausedRun = await reportExecutorEvent(currentSession, {
      type: "user_input_required",
      idempotencyKey: [
        "user-input",
        currentSession.runId,
        message.observation.fingerprint,
        currentSession.run.updatedAt,
      ].join(":"),
      occurredAt: message.observation.observedAt,
      detail: {
        pageType: message.observation.pageType,
        reason: message.observation.blockingReason ?? "Manual browser action is required.",
        waitingFor: "login_or_security",
      },
    });
    currentSession = {
      ...waitForCandidate(withRun(currentSession, pausedRun), "login_or_security"),
      checkpoint: {
        name: `manual:${message.observation.pageType}:${message.observation.fingerprint}`,
        attempt: 1,
        updatedAt: message.observation.observedAt,
      },
    };
    await saveExecutionSession(currentSession);
    return { ok: true, recorded: appended };
  }

  if (
    currentSession.state === "running" &&
    needsManualResumeSelection(message.observation) &&
    !hasVerifiedApplicationResumeForCurrentJob(currentSession)
  ) {
    const resumeCheckpoint = `application:resume:${message.observation.fingerprint}`;
    currentSession = {
      ...currentSession,
      checkpoint: {
        name: resumeCheckpoint,
        attempt: currentSession.checkpoint.name === resumeCheckpoint
          ? currentSession.checkpoint.attempt + 1
          : 1,
        updatedAt: message.observation.observedAt,
      },
    };
    await saveExecutionSession(currentSession);

    const prepared = await prepareLinkedInResume(
      currentSession,
      currentSession.executorTabId,
    );
    if (prepared.ok) {
      const jobExternalId = currentSession.qualification.currentJob?.externalId;
      if (!jobExternalId || !prepared.fileName) {
        throw new Error("RapidApply verified a resume without a current job or document identity.");
      }
      currentSession = {
        ...resumeCandidateController(currentSession, "application_retry"),
        applicationResume: {
          jobExternalId,
          fileName: prepared.fileName,
        },
        checkpoint: {
          name: `application:resume-ready:${message.observation.fingerprint}`,
          attempt: 1,
          updatedAt: new Date().toISOString(),
        },
      };
      await saveExecutionSession(currentSession);
      await setExecutorBadge(currentSession, "…", "#2563eb");
      void requestFreshApplicationObservation(currentSession.executorTabId);
      return { ok: true, recorded: appended };
    }

    const paused = await pauseForApplicationReview(
      currentSession,
      message.observation,
      prepared.reason ?? "RapidApply could not verify the generated resume on LinkedIn. The application is paused at this exact step.",
      "resume_selection",
    );
    await saveExecutionSession(paused);
    await setExecutorBadge(paused, "!", "#d97706");
    return { ok: true, recorded: appended };
  }

  const shouldProcessApplicationForm = currentSession.state === "running" &&
    message.observation.pageType === "application_form" &&
    (
      // A page observer can deliver the same form after the controller has
      // already checkpointed it. The durable phase, not the recording
      // deduplication flag, determines whether this form is actionable.
      // Reprocessing is idempotent because satisfied fields are filtered and
      // the live filler verifies each value before writing it.
      currentSession.phase === "qualification_complete" ||
      currentSession.phase === "opening_application" ||
      currentSession.phase === "application_retry"
    );

  if (shouldProcessApplicationForm) {
    const jobExternalId = currentSession.qualification.currentJob?.externalId;
    if (!jobExternalId) return { ok: false, reason: "missing_qualified_job" };
    currentSession = {
      ...currentSession,
      phase: "processing_application",
      checkpoint: {
        name: `application:linkedin:${jobExternalId}:${message.observation.fingerprint}`,
        attempt: currentSession.checkpoint.name === `application:linkedin:${jobExternalId}:${message.observation.fingerprint}`
          ? currentSession.checkpoint.attempt + 1
          : 1,
        updatedAt: message.observation.observedAt,
      },
    };
    await saveExecutionSession(currentSession);
    const fields = actionableApplicationFields(currentSession, message.observation);
    if (fields.length === 0) {
      const advanceResponse = await sendReviewOnlyAdvanceCommand(currentSession.executorTabId);
      if (advanceResponse.ok && advanceResponse.result === "review_ready" &&
        allowsAutomaticSubmission(currentSession)) {
        const reviewSession = resumeCandidateController(currentSession);
        await saveExecutionSession(reviewSession);
        await submitReviewedApplication(reviewSession, {
          ...message.observation,
          pageType: "application_review",
        });
        return { ok: true, recorded: appended };
      }
      if (!advanceResponse.ok || advanceResponse.result === "review_ready") {
        const paused = await pauseForApplicationReview(
          currentSession,
          message.observation,
          advanceResponse.ok
            ? "All observed application fields were already completed. LinkedIn is at final review; RapidApply will not submit the application."
            : advanceResponse.reason ?? "RapidApply could not safely advance this already-completed application step.",
          advanceResponse.ok ? "final_review" : "manual_verification",
        );
        await saveExecutionSession(paused);
        return { ok: true, recorded: appended };
      }
      await saveExecutionSession(resumeCandidateController(currentSession));
      return { ok: true, recorded: appended };
    }

    let plans: ApplicationAnswerPlanRecord[];
    try {
      plans = await requestApplicationAnswerPlans({
        session: currentSession,
        jobExternalId,
        observationFingerprint: message.observation.fingerprint,
        fields,
        jobContext: message.observation.job,
      });
    } catch (error) {
      await handleApplicationPlanningFailure(currentSession, message.observation, error);
      return { ok: true, recorded: appended };
    }
    const resolvedPlans = plans.filter(isAutomaticallyFillablePlan);
    const fillResponse = await sendReviewOnlyFillCommand(currentSession.executorTabId, resolvedPlans);
    if (!fillResponse.ok) {
      const paused = await pauseForApplicationReview(
        currentSession,
        message.observation,
        fillResponse.reason ?? "RapidApply could not verify the application form fill.",
        "manual_verification",
      );
      await saveExecutionSession(paused);
      return { ok: true, recorded: appended };
    }

    const interventions = await requestApplicationInterventions({
      session: currentSession,
      jobExternalId,
      observationFingerprint: message.observation.fingerprint,
      jobUrl: currentSession.qualification.currentJob?.url ?? sender.tab.url ?? "",
      jobTitle: message.observation.job?.title ?? currentSession.qualification.currentJob?.title,
      company: message.observation.job?.company ?? currentSession.qualification.currentJob?.company,
    });
    const plannedRun = await reportApplicationAnswerPlanning(
      currentSession,
      jobExternalId,
      message.observation,
      plans,
    );
    currentSession = withRun(currentSession, plannedRun);

    const run = await reportExecutorEvent(currentSession, {
      type: "application_prepared",
      idempotencyKey: `application-prepared:${currentSession.runId}:${jobExternalId}:${message.observation.fingerprint}`,
      occurredAt: message.observation.observedAt,
      detail: {
        source: "linkedin",
        externalId: jobExternalId,
        filledFields: fillResponse.result.appliedFieldKeys.length,
        alreadySatisfiedFields: fillResponse.result.alreadySatisfiedFieldKeys.length,
        blockedFields: fillResponse.result.blocked.length,
      },
    });
    currentSession = withRun(currentSession, run);

    if (interventions.active) {
      const paused = await pauseForApplicationReview(
        currentSession,
        message.observation,
        "RapidApply needs one answer before it can continue this application.",
        "application_intervention",
      );
      await saveExecutionSession(paused);
      await setExecutorBadge(paused, "?", "#d97706");
      await showApplicationIntervention(paused, interventions.active);
      return { ok: true, recorded: appended };
    }

    if (fillResponse.result.blocked.length > 0) {
      const paused = await pauseForApplicationReview(
        currentSession,
        message.observation,
        "RapidApply could not verify every approved field on this application.",
        "manual_verification",
      );
      await saveExecutionSession(paused);
      return { ok: true, recorded: appended };
    }

    if (
      executionAutonomyPolicy(currentSession).mode !== "autonomous" &&
      interventions.interventions.some((intervention) => intervention.status === "deferred")
    ) {
      const paused = await pauseForApplicationReview(
        currentSession,
        message.observation,
        "This application has an answer saved for later review.",
        "deferred_question",
      );
      await saveExecutionSession(paused);
      await setExecutorBadge(paused, "!", "#d97706");
      return { ok: true, recorded: appended };
    }

    const advanceResponse = await sendReviewOnlyAdvanceCommand(currentSession.executorTabId);
    if (advanceResponse.ok && advanceResponse.result === "review_ready" &&
      allowsAutomaticSubmission(currentSession)) {
      const reviewSession = resumeCandidateController(currentSession);
      await saveExecutionSession(reviewSession);
      await submitReviewedApplication(reviewSession, {
        ...message.observation,
        pageType: "application_review",
      });
      return { ok: true, recorded: appended };
    }
    if (!advanceResponse.ok || advanceResponse.result === "review_ready") {
      const paused = await pauseForApplicationReview(
        currentSession,
        message.observation,
        advanceResponse.ok
          ? "All approved fields are filled. LinkedIn is at final review; RapidApply will not submit the application."
          : advanceResponse.reason ?? "RapidApply could not safely advance this application step.",
        advanceResponse.ok ? "final_review" : "manual_verification",
      );
      await saveExecutionSession(paused);
      return { ok: true, recorded: appended };
    }
    await saveExecutionSession(resumeCandidateController(currentSession));
    return { ok: true, recorded: appended };
  }

  // A service-worker restart can occur after qualification is saved but before
  // the scheduled Easy Apply command runs. Recover from the durable state when
  // the exact qualified job and its live Easy Apply action are still visible.
  // The same path also handles an explicit application retry.
  if (shouldRecoverLinkedInEasyApplyOpening(
    currentSession,
    message.observation,
    sender.url ?? sender.tab.url,
  )) {
    const jobExternalId = currentSession.qualification.currentJob?.externalId;
    if (!jobExternalId) return { ok: false, reason: "missing_qualified_job" };

    currentSession = await prepareLinkedInEasyApplyOpening(
      currentSession,
      message.observation,
    );
    await saveExecutionSession(currentSession);
    scheduleLinkedInEasyApplyOpening(currentSession, message.observation);
    return { ok: true, recorded: appended };
  }

  if (
    currentSession.state === "running" &&
    message.observation.pageType === "application_review" &&
    ["qualification_complete", "opening_application", "application_retry"].includes(currentSession.phase)
  ) {
    if (
      currentSession.executionPlan.submissionMode === "test_submit" ||
      currentSession.executionPlan.submissionMode === "autonomous_submit"
    ) {
      await submitReviewedApplication(currentSession, message.observation);
      return { ok: true, recorded: appended };
    }
    const paused = await pauseForApplicationReview(
      currentSession,
      message.observation,
      "LinkedIn is at final review. RapidApply will not submit the application.",
      "final_review",
    );
    await saveExecutionSession(paused);
    return { ok: true, recorded: appended };
  }

  // Re-hydrate an answer prompt after a content-script/service-worker restart,
  // or after the candidate answered a queued question in the web dashboard.
  // The current form remains the source of field shape; stored answers are
  // always remapped to this fresh observation before any DOM interaction.
  if (
    currentSession.state === "needs_user_input" &&
    currentSession.phase === "awaiting_user" &&
    currentSession.awaitingUserContext === "application_intervention" &&
    ["application_form", "application_review"].includes(message.observation.pageType)
  ) {
    const jobExternalId = currentSession.qualification.currentJob?.externalId;
    if (!jobExternalId) return { ok: false, reason: "missing_qualified_job" };

    if (needsManualResumeSelection(message.observation)) {
      await saveExecutionSession(currentSession);
      await setExecutorBadge(currentSession, "!", "#d97706");
      return { ok: true, recorded: appended };
    }

    if (message.observation.pageType === "application_review") {
      if (allowsAutomaticSubmission(currentSession)) {
        const resumedRun = await reportExecutorEvent(currentSession, {
          type: "application_question_answered",
          idempotencyKey: `application-review-rehydrated:${currentSession.runId}:${jobExternalId}:${message.observation.fingerprint}`,
          occurredAt: message.observation.observedAt,
          detail: {
            source: "linkedin",
            externalId: jobExternalId,
            reason: "The answered application rehydrated at LinkedIn final review.",
          },
        });
        const resumed = resumeCandidateController(withRun(currentSession, resumedRun));
        await saveExecutionSession(resumed);
        await submitReviewedApplication(resumed, message.observation);
        return { ok: true, recorded: appended };
      }

      const paused = waitForCandidate(currentSession, "final_review");
      await saveExecutionSession(paused);
      await setExecutorBadge(paused, "!", "#d97706");
      return { ok: true, recorded: appended };
    }

    const fields = actionableApplicationFields(currentSession, message.observation);
    if (fields.length === 0) {
      const resumedRun = await reportExecutorEvent(currentSession, {
        type: "application_question_answered",
        idempotencyKey: `application-answers-already-satisfied:${currentSession.runId}:${jobExternalId}:${message.observation.fingerprint}`,
        occurredAt: message.observation.observedAt,
        detail: {
          source: "linkedin",
          externalId: jobExternalId,
          reason: "All observed application fields are already completed.",
        },
      });
      currentSession = resumeCandidateController(withRun(currentSession, resumedRun));
      const advanceResponse = await sendReviewOnlyAdvanceCommand(currentSession.executorTabId);
      if (advanceResponse.ok && advanceResponse.result === "review_ready" &&
        allowsAutomaticSubmission(currentSession)) {
        await saveExecutionSession(currentSession);
        await submitReviewedApplication(currentSession, {
          ...message.observation,
          pageType: "application_review",
        });
        return { ok: true, recorded: appended };
      }
      if (!advanceResponse.ok || advanceResponse.result === "review_ready") {
        const paused = await pauseForApplicationReview(
          currentSession,
          message.observation,
          advanceResponse.ok
            ? "All observed application fields were already completed. LinkedIn is at final review; RapidApply will not submit the application."
            : advanceResponse.reason ?? "RapidApply could not safely advance this already-completed application step.",
          advanceResponse.ok ? "final_review" : "manual_verification",
        );
        await saveExecutionSession(paused);
        return { ok: true, recorded: appended };
      }
      await saveExecutionSession(currentSession);
      return { ok: true, recorded: appended };
    }

    let plans: ApplicationAnswerPlanRecord[];
    try {
      plans = await requestApplicationAnswerPlans({
        session: currentSession,
        jobExternalId,
        observationFingerprint: message.observation.fingerprint,
        fields,
        jobContext: message.observation.job,
      });
    } catch (error) {
      await handleApplicationPlanningFailure(currentSession, message.observation, error);
      return { ok: true, recorded: appended };
    }
    const resolvedPlans = plans.filter(isAutomaticallyFillablePlan);
    const fillResponse = await sendReviewOnlyFillCommand(currentSession.executorTabId, resolvedPlans);
    if (!fillResponse.ok || fillResponse.result.blocked.length > 0) {
      const paused = waitForCandidate(currentSession, "manual_verification");
      await saveExecutionSession(paused);
      await setExecutorBadge(paused, "!", "#d97706");
      return { ok: true, recorded: appended };
    }

    const interventions = await requestApplicationInterventions({
      session: currentSession,
      jobExternalId,
      observationFingerprint: message.observation.fingerprint,
      jobUrl: currentSession.qualification.currentJob?.url ?? sender.tab.url ?? "",
      jobTitle: message.observation.job?.title ?? currentSession.qualification.currentJob?.title,
      company: message.observation.job?.company ?? currentSession.qualification.currentJob?.company,
    });
    const plannedRun = await reportApplicationAnswerPlanning(
      currentSession,
      jobExternalId,
      message.observation,
      plans,
    );
    currentSession = withRun(currentSession, plannedRun);

    const autonomousDisposition = unresolvedAutonomousDisposition(currentSession, plans);
    if (autonomousDisposition) {
      await applyAutonomousDisposition(
        currentSession,
        message.observation,
        autonomousDisposition,
      );
      return { ok: true, recorded: appended };
    }

    if (interventions.active) {
      await saveExecutionSession(currentSession);
      await setExecutorBadge(currentSession, "?", "#d97706");
      await showApplicationIntervention(currentSession, interventions.active);
      return { ok: true, recorded: appended };
    }

    if (
      executionAutonomyPolicy(currentSession).mode !== "autonomous" &&
      interventions.interventions.some((intervention) => intervention.status === "deferred")
    ) {
      const paused = waitForCandidate(currentSession, "deferred_question");
      await saveExecutionSession(paused);
      await setExecutorBadge(paused, "!", "#d97706");
      return { ok: true, recorded: appended };
    }

    const resumedRun = await reportExecutorEvent(currentSession, {
      type: "application_question_answered",
      idempotencyKey: `application-answers-resolved:${currentSession.runId}:${jobExternalId}:${message.observation.fingerprint}`,
      occurredAt: message.observation.observedAt,
      detail: {
        source: "linkedin",
        externalId: jobExternalId,
        reason: "All currently observed application answers are available.",
      },
    });
    currentSession = resumeCandidateController(withRun(currentSession, resumedRun));
    const advanceResponse = await sendReviewOnlyAdvanceCommand(currentSession.executorTabId);
    if (advanceResponse.ok && advanceResponse.result === "review_ready" &&
      allowsAutomaticSubmission(currentSession)) {
      await saveExecutionSession(currentSession);
      await submitReviewedApplication(currentSession, {
        ...message.observation,
        pageType: "application_review",
      });
      return { ok: true, recorded: appended };
    }
    if (!advanceResponse.ok || advanceResponse.result === "review_ready") {
      const paused = await pauseForApplicationReview(
        currentSession,
        message.observation,
        advanceResponse.ok
          ? "All approved fields are filled. LinkedIn is at final review; RapidApply will not submit the application."
          : advanceResponse.reason ?? "RapidApply could not safely advance this application step.",
        advanceResponse.ok ? "final_review" : "manual_verification",
      );
      await saveExecutionSession(paused);
      return { ok: true, recorded: appended };
    }
    await saveExecutionSession(currentSession);
    return { ok: true, recorded: appended };
  }

  if (
    currentSession.state === "running" &&
    (
      ["navigating_to_job", "qualifying_job"].includes(currentSession.phase) ||
      (
        currentSession.phase === "awaiting_user" &&
        currentSession.awaitingUserContext === "qualification"
      )
    )
  ) {
    const expectedJobPage = isExpectedLinkedInJobUrl(
      currentSession,
      sender.url ?? sender.tab.url,
    );

    // A content-script observation from the just-left search result page can
    // arrive after the controller has committed the next navigation. It is
    // not evidence for or against the selected job, so leave the checkpoint
    // intact and wait for the canonical job-detail URL to load.
    //
    // However: LinkedIn frequently loads the expected job in a right-panel while
    // keeping the URL on /jobs/search?currentJobId=XXXX. The observer correctly
    // returns "search_results" for this URL (so navigating_to_search still works),
    // but when we're in navigating_to_job and the expected job is the one showing
    // in the panel, we can qualify and open Easy Apply directly from the panel
    // without needing a page redirect — the Easy Apply button is right there.
    if (message.observation.pageType === "search_results") {
      const selectedJob = currentSession.qualification.currentJob;
      const panelJobId = message.observation.job?.externalId;
      if (
        selectedJob &&
        panelJobId &&
        panelJobId === selectedJob.externalId
      ) {
        // Right-panel view: the expected job IS showing in the panel view.
        // Synthesize a job_detail observation so the qualification path can
        // accept it, then run the full qualification + Easy Apply open pipeline.
        // This avoids a redirect loop (LinkedIn always restores the panel job).
        const panelObservation = { ...message.observation, pageType: "job_detail" as const };
        currentSession = beginJobObservationQualification(
          currentSession,
          panelObservation.observedAt,
        );
        const qualification = qualifyLinkedInJobObservation(currentSession, panelObservation);
        const qualificationSession = await pauseForLinkedInQualification(
          currentSession,
          qualification,
          panelObservation,
        );
        if (qualification.status === "skipped") {
          await advancePastLinkedInSkip(qualificationSession, panelObservation);
          return { ok: true, recorded: appended };
        }
        currentSession = qualificationSession;
        await saveExecutionSession(currentSession);
        await setExecutorBadge(currentSession, "!", "#d97706");
        if (qualification.status === "qualified") {
          currentSession = await prepareLinkedInEasyApplyOpening(currentSession, panelObservation);
          await saveExecutionSession(currentSession);
          scheduleLinkedInEasyApplyOpening(currentSession, panelObservation);
        }
        return { ok: true, recorded: appended };
      }
      await saveExecutionSession(currentSession);
      return { ok: true, recorded: appended };
    }

    if (message.observation.pageType === "job_detail" && expectedJobPage) {
      currentSession = beginJobObservationQualification(
        currentSession,
        message.observation.observedAt,
      );
      const qualification = qualifyLinkedInJobObservation(
        currentSession,
        message.observation,
      );

      const qualificationSession = await pauseForLinkedInQualification(
        currentSession,
        qualification,
        message.observation,
      );
      if (qualification.status === "skipped") {
        await advancePastLinkedInSkip(qualificationSession, message.observation);
        return { ok: true, recorded: appended };
      }

      currentSession = qualificationSession;
      await saveExecutionSession(currentSession);
      await setExecutorBadge(currentSession, "!", "#d97706");
      if (qualification.status === "qualified") {
        currentSession = await prepareLinkedInEasyApplyOpening(
          currentSession,
          message.observation,
        );
        await saveExecutionSession(currentSession);
        scheduleLinkedInEasyApplyOpening(currentSession, message.observation);
      }
      return { ok: true, recorded: appended };
    }

    if (message.observation.pageType === "job_detail" && !expectedJobPage) {
      // LinkedIn can deliver a stale or intermediate job-detail observation
      // while the controller is committing the canonical URL selected from
      // the persisted discovery pool. Treat that as a recoverable navigation
      // race, not a user-input blocker. The selected checkpoint remains the
      // source of truth, so return to it and let the normal qualification
      // path continue.
      const selectedJob = currentSession.qualification.currentJob;
      if (selectedJob) {
        await saveExecutionSession(currentSession);
        await setExecutorBadge(currentSession, "…", "#7c3aed");
        await chrome.tabs.update(currentSession.executorTabId, { url: selectedJob.url });
        return { ok: true, recorded: appended, recoveredNavigationRace: true };
      }

      // This is the genuinely ambiguous case: there is no selected job to
      // recover to. Keep the existing pause behavior rather than guessing.
      const paused = await pauseForLinkedInQualification(
        currentSession,
        {
          status: "needs_user_input",
          reason: "RapidApply opened a LinkedIn listing without a saved job checkpoint.",
        },
        message.observation,
      );
      await saveExecutionSession(paused);
      await setExecutorBadge(paused, "!", "#d97706");
      return { ok: true, recorded: appended };
    }

    if (message.observation.pageType === "application_confirmation") {
      const runningSession: ExtensionExecutionSession = {
        ...currentSession,
        state: "running",
      };
      await completeConfirmedLinkedInSubmission(runningSession, message.observation);
      return { ok: true, recorded: appended };
    }

    if (["application_form", "application_review"].includes(
      message.observation.pageType,
    )) {
      const paused = await pauseForLinkedInQualification(
        currentSession,
        {
          status: "needs_user_input",
          job: currentSession.qualification.currentJob,
          reason: "RapidApply encountered application UI before the qualification checkpoint. It did not interact with the form.",
        },
        message.observation,
      );
      await saveExecutionSession(paused);
      await setExecutorBadge(paused, "!", "#d97706");
      return { ok: true, recorded: appended };
    }
  }

  if (
    currentSession.state === "running" &&
    message.observation.pageType === "search_results" &&
    ["navigating_to_search", "discovering_search"].includes(currentSession.phase) &&
    isExpectedLinkedInSearchPage(currentSession, sender.url ?? sender.tab.url)
  ) {
    currentSession = beginSearchDiscovery(currentSession, message.observation.observedAt);
    await saveExecutionSession(currentSession);
    return {
      ok: true,
      recorded: appended,
      command: {
        type: "rapidapply.discover-linkedin-search",
        runId: currentSession.runId,
        pageIndex: currentSession.discovery.pageIndex,
        poolTarget: currentSession.discovery.poolTarget,
      },
    };
  }

  await saveExecutionSession(currentSession);
  return { ok: true, recorded: appended };
}

async function handleApplicationInterventionAnswer(
  message: AnswerApplicationInterventionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: boolean; next?: import("@rapidapply/contracts").ApplicationIntervention; reason?: string }> {
  const tabId = sender.tab?.id;
  const session = await getExecutionSession();
  if (!session || tabId === undefined || !ownsExecutorTab(session, tabId) || session.state !== "needs_user_input") {
    return { ok: false, reason: "no_active_question" };
  }

  const answered = await answerApplicationIntervention({
    session,
    interventionId: message.interventionId,
    response: message.response,
  });
  const fillResponse = await sendReviewOnlyFillCommand(session.executorTabId, [answered.plan]);
  if (!fillResponse.ok || fillResponse.result.blocked.length > 0) {
    return { ok: false, reason: "field_changed" };
  }

  const answeredRun = await reportExecutorEvent(session, {
    type: "application_question_answered",
    idempotencyKey: `application-question-answered:${session.runId}:${answered.intervention.id}`,
    detail: {
      source: "linkedin",
      externalId: answered.intervention.jobExternalId,
      fieldKey: answered.intervention.field.key,
      remembered: Boolean(answered.intervention.rememberScope),
    },
  });
  let currentSession = withRun(session, answeredRun);

  if (answered.next) {
    const pausedRun = await reportExecutorEvent(currentSession, {
      type: "user_input_required",
      idempotencyKey: `application-question-pending:${currentSession.runId}:${answered.next.id}`,
      detail: {
        source: "linkedin",
        externalId: answered.next.jobExternalId,
        fieldKey: answered.next.field.key,
        reason: "RapidApply needs one more answer before it can continue this application.",
        waitingFor: "application_intervention",
      },
    });
    currentSession = waitForCandidate(
      withRun(currentSession, pausedRun),
      "application_intervention",
    );
    await saveExecutionSession(currentSession);
    await setExecutorBadge(currentSession, "?", "#d97706");
    return { ok: true, next: answered.next };
  }

  currentSession = resumeCandidateController(currentSession);
  const advanceResponse = await sendReviewOnlyAdvanceCommand(currentSession.executorTabId);
  const interventionObservation: AdapterObservation = {
    adapterId: "linkedin",
    adapterVersion: "intervention",
    observedAt: new Date().toISOString(),
    pageType: "application_form",
    path: "/jobs",
    queryKeys: [],
    title: "LinkedIn Easy Apply",
    fingerprint: answered.intervention.observationFingerprint,
    fields: [],
    actions: [],
    validationMessages: [],
  };
  if (advanceResponse.ok && advanceResponse.result === "review_ready" &&
    allowsAutomaticSubmission(currentSession)) {
    await saveExecutionSession(currentSession);
    await setExecutorBadge(currentSession, "…", "#2563eb");
    await submitReviewedApplication(currentSession, {
      ...interventionObservation,
      pageType: "application_review",
    });
    return { ok: true };
  }
  if (!advanceResponse.ok || advanceResponse.result === "review_ready") {
    const paused = await pauseForApplicationReview(
      currentSession,
      interventionObservation,
      advanceResponse.ok
        ? "All approved fields are filled. LinkedIn is at final review; RapidApply will not submit the application."
        : advanceResponse.reason ?? "RapidApply could not safely advance this application step.",
      advanceResponse.ok ? "final_review" : "manual_verification",
    );
    await saveExecutionSession(paused);
    await setExecutorBadge(paused, "!", "#d97706");
    return { ok: true };
  }

  await saveExecutionSession(currentSession);
  await setExecutorBadge(currentSession, "…", "#7c3aed");
  return { ok: true };
}

async function handleApplicationInterventionDeferral(
  message: DeferApplicationInterventionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: boolean; next?: import("@rapidapply/contracts").ApplicationIntervention; reason?: string }> {
  const tabId = sender.tab?.id;
  const session = await getExecutionSession();
  if (!session || tabId === undefined || !ownsExecutorTab(session, tabId) || session.state !== "needs_user_input") {
    return { ok: false, reason: "no_active_question" };
  }
  const deferred = await deferApplicationIntervention({ session, interventionId: message.interventionId });
  const run = await reportExecutorEvent(session, {
    type: "application_question_deferred",
    idempotencyKey: `application-question-deferred:${session.runId}:${deferred.intervention.id}`,
    detail: {
      source: "linkedin",
      externalId: deferred.intervention.jobExternalId,
      fieldKey: deferred.intervention.field.key,
    },
  });
  const currentSession = waitForCandidate(withRun(session, run), "deferred_question");
  await saveExecutionSession(currentSession);
  await setExecutorBadge(currentSession, deferred.next ? "?" : "!", "#d97706");
  return { ok: true, next: deferred.next };
}

async function handleApplicationInterventionTouch(
  message: TouchApplicationInterventionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: boolean; intervention?: import("@rapidapply/contracts").ApplicationIntervention; reason?: string }> {
  const tabId = sender.tab?.id;
  const session = await getExecutionSession();
  if (!session || tabId === undefined || !ownsExecutorTab(session, tabId) || session.state !== "needs_user_input") {
    return { ok: false, reason: "no_active_question" };
  }
  const intervention = await touchApplicationIntervention({ session, interventionId: message.interventionId });
  return { ok: true, intervention };
}

async function reportApplicationAnswerPlanning(
  session: ExtensionExecutionSession,
  jobExternalId: string,
  observation: AdapterObservation,
  plans: readonly ApplicationAnswerPlanRecord[],
): Promise<BrowserRunSummary> {
  const deterministicCount = plans.filter(isAutomaticallyFillablePlan).length;
  const reviewCount = plans.filter((plan) => !isAutomaticallyFillablePlan(plan)).length;
  return reportExecutorEvent(session, {
    type: "application_answers_planned",
    idempotencyKey: `answer-plans:${session.runId}:${jobExternalId}:${observation.fingerprint}`,
    occurredAt: observation.observedAt,
    detail: {
      source: "linkedin",
      externalId: jobExternalId,
      fieldCount: plans.length,
      deterministicCount,
      reviewCount,
      reason: reviewCount > 0
        ? "RapidApply prepared application answers and is waiting only where a candidate decision is needed."
        : "RapidApply prepared all observed answers from approved candidate facts.",
    },
  });
}

function isAutomaticallyFillablePlan(plan: ApplicationAnswerPlanRecord): boolean {
  return plan.decision?.status === "resolved" && !plan.decision.requiresReview;
}

function hasVerifiedApplicationResumeForCurrentJob(
  session: ExtensionExecutionSession,
): boolean {
  const currentJobExternalId = session.qualification.currentJob?.externalId;
  return Boolean(
    currentJobExternalId &&
    session.applicationResume?.jobExternalId === currentJobExternalId &&
    session.applicationResume.fileName.toLowerCase().endsWith(".pdf")
  );
}

function actionableApplicationFields(
  session: ExtensionExecutionSession,
  observation: AdapterObservation,
) {
  const observedFields = hasVerifiedApplicationResumeForCurrentJob(session)
    ? observation.fields.filter((field) => !isResumeSelectionField(observation, field))
    : observation.fields;
  return describeActionableApplicationFields(observedFields);
}

function allowsAutomaticSubmission(session: ExtensionExecutionSession): boolean {
  return session.executionPlan.submissionMode === "autonomous_submit" ||
    session.executionPlan.submissionMode === "test_submit";
}

function unresolvedAutonomousDisposition(
  session: ExtensionExecutionSession,
  plans: readonly ApplicationAnswerPlanRecord[],
): { action: "skip" | "defer"; reasonCode: string; reason: string } | null {
  const policy = executionAutonomyPolicy(session);
  if (policy.mode !== "autonomous") return null;
  const unresolvedRequired = plans.filter((plan) =>
    plan.field.required && !isAutomaticallyFillablePlan(plan)
  );
  if (unresolvedRequired.length === 0) return null;
  const questions = unresolvedRequired
    .map((plan) => plan.field.question)
    .slice(0, 3)
    .join("; ");
  const unresolvedFreeText = unresolvedRequired.some((plan) =>
    plan.field.category === "open_text" || plan.field.kind === "textarea"
  );
  if (policy.freeTextStrategy === "skip_job" && unresolvedFreeText) {
    return {
      action: "skip",
      reasonCode: "required_free_text_unavailable",
      reason: `Autonomous policy skipped this listing because required free-text answers were unavailable: ${questions}`,
    };
  }
  if (policy.unknownFieldStrategy === "pause_campaign") return null;
  return policy.unknownFieldStrategy === "skip_job"
    ? {
        action: "skip",
        reasonCode: "required_question_unresolved",
        reason: `Autonomous policy skipped this listing because required questions could not be grounded: ${questions}`,
      }
    : {
        action: "defer",
        reasonCode: "required_question_needs_candidate_fact",
        reason: `Autonomous policy deferred this application because required questions need candidate facts: ${questions}`,
      };
}

async function applyAutonomousDisposition(
  session: ExtensionExecutionSession,
  observation: AdapterObservation,
  disposition: { action: "skip" | "defer"; reasonCode: string; reason: string },
): Promise<void> {
  const job = session.qualification.currentJob;
  if (!job) throw new Error("RapidApply cannot disposition an application without a qualified job.");
  if (disposition.action === "defer") {
    await deferExecutorJob({
      session,
      jobExternalId: job.externalId,
      url: job.url,
      title: observation.job?.title ?? job.title ?? "LinkedIn job",
      company: observation.job?.company ?? job.company ?? "Company not listed",
      reasonCode: disposition.reasonCode,
      reasonDetails: disposition.reason,
    });
  }
  await skipUnavailableLinkedInApplication(session, observation, disposition.reason);
}

/**
 * Planner transport is an operational dependency, not permission to guess or
 * to leave the browser in a silent retry loop. Make the exact safe outcome
 * visible: autonomous campaigns use their configured finish-later/skip rule;
 * supervised campaigns pause on the current form without changing a field.
 */
async function handleApplicationPlanningFailure(
  session: ExtensionExecutionSession,
  observation: AdapterObservation,
  error: unknown,
): Promise<void> {
  const jobExternalId = session.qualification.currentJob?.externalId;
  const detail = planningFailureDetail(error);
  const reason = `RapidApply could not prepare answers for this application (${detail}). No field was changed.`;
  const run = await reportExecutorEvent(session, {
    type: "user_input_required",
    idempotencyKey: `answer-planner-failed:${session.runId}:${jobExternalId ?? "unknown"}:${observation.fingerprint}`,
    occurredAt: observation.observedAt,
    detail: {
      pageType: observation.pageType,
      reason,
      waitingFor: "answer_planner",
    },
  });
  const currentSession = withRun(session, run);
  const policy = executionAutonomyPolicy(currentSession);
  if (policy.mode === "autonomous" && policy.unknownFieldStrategy !== "pause_campaign") {
    await applyAutonomousDisposition(currentSession, observation, {
      action: policy.unknownFieldStrategy === "skip_job" ? "skip" : "defer",
      reasonCode: "answer_planner_unavailable",
      reason,
    });
    return;
  }

  const paused = await pauseForApplicationReview(
    currentSession,
    observation,
    reason,
    "manual_verification",
  );
  await saveExecutionSession(paused);
  await setExecutorBadge(paused, "!", "#d97706");
}

function planningFailureDetail(error: unknown): string {
  if (error instanceof ApplicationAnswerPlanningError) {
    if (error.code === "http_error") return `planner service returned HTTP ${error.status ?? "error"}`;
    if (error.code === "network") return "planner service was unreachable";
    return "planner service returned an invalid response";
  }
  return "planner service failed unexpectedly";
}

function executionAutonomyPolicy(session: ExtensionExecutionSession): AutonomyPolicy {
  const value: unknown = session.executionPlan.autonomyPolicy;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Partial<AutonomyPolicy>;
    if (record.mode === "autonomous" || record.mode === "strict_control") {
      return {
        mode: record.mode,
        freeTextStrategy: record.freeTextStrategy ?? "profile_only",
        unknownFieldStrategy: record.unknownFieldStrategy ?? "pause_campaign",
        aiConfidenceThreshold: record.aiConfidenceThreshold ?? 0.75,
        maxThroughput: record.maxThroughput ?? { dailyCap: 25, hourlyCap: 5 },
      };
    }
  }
  return {
    mode: "strict_control",
    freeTextStrategy: "profile_only",
    unknownFieldStrategy: "pause_campaign",
    aiConfidenceThreshold: 0.75,
    maxThroughput: { dailyCap: 25, hourlyCap: 5 },
  };
}

async function showApplicationIntervention(
  session: ExtensionExecutionSession,
  intervention: import("@rapidapply/contracts").ApplicationIntervention,
): Promise<void> {
  const response: unknown = await chrome.tabs.sendMessage(session.executorTabId, {
    type: "rapidapply.show-application-intervention",
    intervention,
  }).catch(() => null);
  if (!isReviewOnlyCommandSuccess(response)) {
    throw new Error("RapidApply could not display the application question helper.");
  }
}

async function handleLinkedInDiscoveryResult(
  message: LinkedInSearchDiscoveryResultMessage,
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: boolean; discovered?: number; total?: number; complete?: boolean; reason?: string }> {
  if (!isTrustedLinkedInSender(sender) || sender.tab?.id === undefined) {
    return { ok: false, reason: "untrusted_sender" };
  }

  const session = await getExecutionSession();
  if (!session) return { ok: false, reason: "no_active_execution" };
  if (!ownsExecutorTab(session, sender.tab.id)) {
    return { ok: false, reason: "not_executor_tab" };
  }
  if (
    session.runId !== message.runId ||
    session.discovery.pageIndex !== message.pageIndex ||
    session.phase !== "discovering_search" ||
    session.state !== "running"
  ) {
    return { ok: false, reason: "stale_discovery_page" };
  }

  const accepted = acceptDiscoveryPage(session, message.jobs);
  let currentSession = accepted.session;

  for (const job of accepted.newJobs) {
    const run = await reportExecutorEvent(currentSession, {
      type: "job_discovered",
      idempotencyKey: `job-discovered:${currentSession.runId}:linkedin:${job.externalId}`,
      detail: {
        source: "linkedin",
        externalId: job.externalId,
        url: job.url,
        jobTitle: job.title ?? "LinkedIn job",
        company: job.company ?? "Company not listed",
        location: job.location ?? null,
        pageIndex: message.pageIndex,
        hydrationCycles: message.cycles,
      },
    });
    currentSession = withRun(currentSession, run);
  }

  if (accepted.complete) {
    const nextQualification = beginJobQualification(currentSession);
    currentSession = nextQualification.session;

    if (!nextQualification.job) {
      currentSession = await pauseForLinkedInQualification(
        currentSession,
        {
          status: "needs_user_input",
          reason: "LinkedIn discovery did not leave a job listing available for qualification.",
        },
        undefined,
      );
      await saveExecutionSession(currentSession);
      await setExecutorBadge(currentSession, "!", "#d97706");
      return {
        ok: true,
        discovered: accepted.newJobs.length,
        total: currentSession.discovery.jobs.length,
        complete: true,
      };
    }

    await saveExecutionSession(currentSession);
    await setExecutorBadge(currentSession, "…", "#7c3aed");
    await chrome.tabs.update(currentSession.executorTabId, { url: nextQualification.job.url });
    return {
      ok: true,
      discovered: accepted.newJobs.length,
      total: currentSession.discovery.jobs.length,
      complete: true,
    };
  }

  await saveExecutionSession(currentSession);
  await chrome.tabs.update(currentSession.executorTabId, { url: accepted.nextUrl });
  return {
    ok: true,
    discovered: accepted.newJobs.length,
    total: currentSession.discovery.jobs.length,
    complete: false,
  };
}

/**
 * Persist a post-discovery qualification result. Qualified and skipped
 * listings remain running; only an ambiguous or unverifiable observation
 * pauses the campaign. The event sequence is replay-safe.
 */
async function pauseForLinkedInQualification(
  session: ExtensionExecutionSession,
  qualification: LinkedInJobQualification,
  observation?: AdapterObservation,
): Promise<ExtensionExecutionSession> {
  let currentSession = completeJobQualification(
    session,
    qualification,
    observation?.observedAt,
  );
  const job = qualification.job;
  const commonDetail = job
    ? {
        source: "linkedin",
        externalId: job.externalId,
        url: job.url,
        jobTitle: observation?.job?.title ?? job.title ?? "LinkedIn job",
        company: observation?.job?.company ?? job.company ?? "Company not listed",
        location: observation?.job?.location ?? job.location ?? null,
      }
    : {
        source: "linkedin",
        externalId: null,
        url: null,
        jobTitle: "LinkedIn job",
        company: "Company not listed",
        location: null,
      };

  if (qualification.status === "qualified" && job) {
    const run = await reportExecutorEvent(currentSession, {
      type: "job_qualified",
      idempotencyKey: `job-qualified:${currentSession.runId}:linkedin:${job.externalId}`,
      occurredAt: observation?.observedAt,
      detail: {
        ...commonDetail,
        reason: qualification.reason,
        easyApplyAvailable: true,
      },
    });
    currentSession = withRun(currentSession, run);
    return {
      ...currentSession,
      phase: "qualification_complete",
    };
  }

  if (qualification.status === "skipped" && job) {
    const run = await reportExecutorEvent(currentSession, {
      type: "application_skipped",
      idempotencyKey: `job-skipped:${currentSession.runId}:linkedin:${job.externalId}:qualification`,
      occurredAt: observation?.observedAt,
      detail: {
        ...commonDetail,
        reason: qualification.reason,
      },
    });
    currentSession = withRun(currentSession, run);
    return currentSession;
  }

  const qualificationReason = qualification.status === "qualified"
    ? "LinkedIn job qualification is complete. The verified listing is ready for the next application-adapter phase; RapidApply did not open Easy Apply."
    : qualification.status === "skipped"
      ? "LinkedIn job qualification stopped after the first inspected listing was skipped. The next selection phase has not been enabled yet."
      : qualification.reason;
  const pausedRun = await reportExecutorEvent(currentSession, {
    type: "user_input_required",
    idempotencyKey: [
      "qualification-paused",
      currentSession.runId,
      currentSession.executorSessionId,
      job?.externalId ?? "unknown",
      qualification.status,
    ].join(":"),
    occurredAt: observation?.observedAt,
      detail: {
        ...commonDetail,
        reason: qualificationReason,
        qualificationStatus: qualification.status,
        discoveredJobs: currentSession.discovery.jobs.length,
        poolTarget: currentSession.discovery.poolTarget,
        waitingFor: "qualification",
    },
  });

  return waitForCandidate(withRun(currentSession, pausedRun), "qualification");
}

/**
 * Preserve the legacy helper's useful "go to next job" behavior while keeping
 * the candidate pool bounded to URLs discovered and persisted by this run.
 */
async function advancePastLinkedInSkip(
  session: ExtensionExecutionSession,
  observation?: AdapterObservation,
): Promise<void> {
  const currentJobId = session.qualification.currentJob?.externalId;
  const transitionKey = `${session.runId}:${currentJobId ?? "unknown"}`;
  if (activeSubmissionTransitions.has(transitionKey)) return;
  activeSubmissionTransitions.add(transitionKey);

  try {
    const updatedInspected = currentJobId && !session.qualification.inspectedExternalIds.includes(currentJobId)
      ? [...session.qualification.inspectedExternalIds, currentJobId]
      : session.qualification.inspectedExternalIds;

    const sessionWithInspected: ExtensionExecutionSession = {
      ...session,
      qualification: {
        ...session.qualification,
        inspectedExternalIds: updatedInspected,
      },
    };

    const nextQualification = beginJobQualification(sessionWithInspected, observation?.observedAt);
    if (!nextQualification.job) {
      const searchNav = beginSearchNavigation(nextQualification.session);
      await saveExecutionSession(searchNav);
      await setExecutorBadge(searchNav, "…", "#7c3aed");
      await chrome.tabs.update(searchNav.executorTabId, {
        url: searchNav.discovery.searchUrl,
      });
      return;
    }

    await saveExecutionSession(nextQualification.session);
    await setExecutorBadge(nextQualification.session, "…", "#7c3aed");
    await chrome.tabs.update(nextQualification.session.executorTabId, {
      url: nextQualification.job.url,
    });
  } finally {
    activeSubmissionTransitions.delete(transitionKey);
  }
}

async function skipUnavailableLinkedInApplication(
  session: ExtensionExecutionSession,
  observation: AdapterObservation,
  reason: string,
): Promise<void> {
  const job = session.qualification.currentJob;
  if (!job) {
    const paused = await pauseForApplicationReview(
      session,
      observation,
      "RapidApply could not identify the current LinkedIn listing after Easy Apply became unavailable.",
      "manual_verification",
    );
    await saveExecutionSession(paused);
    await setExecutorBadge(paused, "!", "#d97706");
    return;
  }

  const run = await reportExecutorEvent(session, {
    type: "application_skipped",
    idempotencyKey: `job-skipped:${session.runId}:linkedin:${job.externalId}:easy-apply-unavailable`,
    occurredAt: observation.observedAt,
    detail: {
      source: "linkedin",
      externalId: job.externalId,
      url: job.url,
      jobTitle: observation.job?.title ?? job.title ?? "LinkedIn job",
      company: observation.job?.company ?? job.company ?? "Company not listed",
      location: observation.job?.location ?? job.location ?? null,
      reason,
    },
  });
  await advancePastLinkedInSkip(withRun(session, run), observation);
}

async function pauseForApplicationReview(
  session: ExtensionExecutionSession,
  observation: AdapterObservation,
  reason: string,
  context: AwaitingUserContext = "manual_verification",
): Promise<ExtensionExecutionSession> {
  const run = await reportExecutorEvent(session, {
    type: "user_input_required",
    // A candidate may explicitly retry the same DOM state after selecting a
    // resume or correcting a field. Scope the durable pause to the executor
    // session and checkpoint attempt so a new retry can transition the run
    // back to needs_user_input without duplicating heartbeat observations.
    idempotencyKey: [
      "application-review-paused",
      session.runId,
      session.executorSessionId,
      observation.fingerprint,
      String(session.checkpoint.attempt),
    ].join(":"),
    occurredAt: observation.observedAt,
    detail: {
      source: "linkedin",
      externalId: session.qualification.currentJob?.externalId ?? null,
      reason,
      pageType: observation.pageType,
      waitingFor: context,
    },
  });
  return waitForCandidate(withRun(session, run), context);
}

/**
 * Submit only after the observer or verified progression controller has
 * established an enabled final-review action and the execution plan authorizes
 * submission. The content script must also observe LinkedIn's confirmation
 * text before the server records application_submitted.
 */
async function submitReviewedApplication(
  session: ExtensionExecutionSession,
  observation: AdapterObservation,
): Promise<void> {
  const jobExternalId = session.qualification.currentJob?.externalId;
  const submissionSession: ExtensionExecutionSession = {
    ...session,
    phase: "processing_application",
    checkpoint: {
      name: `application:submit:${jobExternalId ?? "unknown"}`,
      attempt: session.checkpoint.name === `application:submit:${jobExternalId ?? "unknown"}`
        ? session.checkpoint.attempt + 1
        : 1,
      updatedAt: observation.observedAt,
    },
  };
  await saveExecutionSession(submissionSession);

  const response = await sendSubmitApplicationCommand(submissionSession.executorTabId);
  if (!response.ok) {
    const paused = await pauseForApplicationReview(
      submissionSession,
      observation,
      response.reason ?? "RapidApply could not verify LinkedIn's application confirmation.",
      "manual_verification",
    );
    await saveExecutionSession(paused);
    await setExecutorBadge(paused, "!", "#d97706");
    return;
  }

  await completeConfirmedLinkedInSubmission(submissionSession, observation);
}

async function completeConfirmedLinkedInSubmission(
  session: ExtensionExecutionSession,
  observation: AdapterObservation,
): Promise<void> {

  const jobExternalId = session.qualification.currentJob?.externalId;
  const submittedRun = await reportExecutorEvent(session, {
    type: "application_submitted",
    // One application can produce multiple observations (review, success
    // modal, and post-dismiss job detail). Scope this event to the run/job,
    // not to a page fingerprint, so recovery cannot count the same submission
    // twice after a background turn or content-script restart.
    idempotencyKey: `application-submitted:${session.runId}:${jobExternalId ?? "unknown"}`,
    occurredAt: observation.observedAt,
    detail: {
      source: "linkedin",
      externalId: jobExternalId ?? null,
      confirmation: "observed",
    },
  });
  const submittedSession = withRun(session, submittedRun);

  if (submittedRun.appliedCount >= submittedRun.targetApplications) {
    await reportExecutorEvent(submittedSession, {
      type: "run_completed",
      idempotencyKey: `run-completed:${submittedSession.runId}:application-target-reached`,
      occurredAt: observation.observedAt,
      detail: {
        source: "linkedin",
        appliedCount: submittedRun.appliedCount,
        skippedCount: submittedRun.skippedCount,
      },
    });
    return;
  }

  await advancePastLinkedInSkip(submittedSession, observation);
}

/**
 * Prefer the low-privilege content-script click. If the page rejects it, use
 * the optional, candidate-enabled trusted-input transport for the one static
 * non-submit action that this release permits: opening Easy Apply.
 */
interface ReviewOnlyApplicationOpenResult {
  ok: boolean;
  verification?: "confirmed" | "pending";
  reason?: string;
  code?: "easy_apply_unavailable" | "easy_apply_open_failed";
  directOutcome: "confirmed" | "rejected" | "timed_out" | "unreachable";
  trustedInputOutcome: "not_needed" | "not_enabled" | "dispatched" | "failed";
}

type EasyApplyTransitionStage =
  | "open_requested"
  | "open_result"
  | "form_observed"
  | "open_timeout";

/**
 * Transition out of the page-observer message before asking that same content
 * script to click anything. The old PowerApply helper had this important
 * property: it started a durable form watcher, then made the click, rather
 * than allowing one response port to become the campaign's only liveness
 * dependency. Persisting `opening_application` prevents a heartbeat from
 * queuing a duplicate click while the separate turn is in flight.
 */
async function prepareLinkedInEasyApplyOpening(
  session: ExtensionExecutionSession,
  observation: AdapterObservation,
): Promise<ExtensionExecutionSession> {
  const jobExternalId = session.qualification.currentJob?.externalId;
  if (!jobExternalId) return session;

  const openingCheckpoint = `application:open-attempt:${jobExternalId}`;
  const retryCheckpoint = `application:open-retry:${jobExternalId}`;
  const attempt = session.checkpoint.name === openingCheckpoint
    ? session.checkpoint.attempt + 1
    : session.checkpoint.name === retryCheckpoint
      ? session.checkpoint.attempt + 1
      : 1;
  let openingSession: ExtensionExecutionSession = {
    ...session,
    phase: "opening_application",
    checkpoint: {
      name: openingCheckpoint,
      attempt,
      updatedAt: observation.observedAt,
    },
  };
  openingSession = await reportLinkedInEasyApplyTransition(
    openingSession,
    observation,
    "open_requested",
  );
  await setExecutorBadge(openingSession, "…", "#7c3aed");
  return openingSession;
}

function scheduleLinkedInEasyApplyOpening(
  session: ExtensionExecutionSession,
  observation: AdapterObservation,
): void {
  // setTimeout, rather than a microtask, guarantees the current adapter
  // observation response has been returned before Chrome delivers the next
  // command to this content-script context.
  globalThis.setTimeout(() => {
    void executeLinkedInEasyApplyOpening(session, observation);
  }, 0);
}

async function executeLinkedInEasyApplyOpening(
  scheduledSession: ExtensionExecutionSession,
  observation: AdapterObservation,
): Promise<void> {
  const current = await getExecutionSession();
  if (!isCurrentLinkedInEasyApplyOpening(scheduledSession, current)) return;

  try {
    const opened = await openReviewOnlyApplication(current.executorTabId);
    let currentSession = await reportLinkedInEasyApplyTransition(
      current,
      observation,
      "open_result",
      {
        verification: opened.verification ?? null,
        directOutcome: opened.directOutcome,
        trustedInputOutcome: opened.trustedInputOutcome,
        outcome: opened.ok ? "opened" : "failed",
        reason: opened.reason ?? null,
      },
    );
    await saveExecutionSession(currentSession);

    if (!opened.ok) {
      if (opened.code === "easy_apply_unavailable") {
        await skipUnavailableLinkedInApplication(
          currentSession,
          observation,
          opened.reason ?? "LinkedIn does not offer Easy Apply for this listing.",
        );
        return;
      }
      const paused = await pauseForApplicationReview(
        currentSession,
        observation,
        opened.reason ?? "RapidApply could not safely open LinkedIn Easy Apply.",
        "manual_verification",
      );
      await saveExecutionSession(paused);
      await setExecutorBadge(paused, "!", "#d97706");
      return;
    }

    // A command acknowledgement is not proof that LinkedIn mounted its form.
    // Verify the rendered surface independently before the answer planner can
    // run, exactly as the legacy helper waited for `jobs-easy-apply-modal`.
    void verifyLinkedInApplicationOpening(currentSession, observation);
  } catch (error) {
    const latest = await getExecutionSession();
    if (!isCurrentLinkedInEasyApplyOpening(scheduledSession, latest)) return;
    const paused = await pauseForApplicationReview(
      latest,
      observation,
      `RapidApply's Easy Apply controller stopped before LinkedIn confirmed the form: ${diagnosticMessage(error)}`,
      "manual_verification",
    );
    await saveExecutionSession(paused);
    await setExecutorBadge(paused, "!", "#d97706");
  }
}

function isCurrentLinkedInEasyApplyOpening(
  scheduled: ExtensionExecutionSession,
  current: ExtensionExecutionSession | null,
): current is ExtensionExecutionSession {
  return Boolean(
    current &&
    current.runId === scheduled.runId &&
    current.executorSessionId === scheduled.executorSessionId &&
    current.state === "running" &&
    current.phase === "opening_application" &&
    current.checkpoint.name === scheduled.checkpoint.name &&
    current.checkpoint.attempt === scheduled.checkpoint.attempt,
  );
}

async function reportLinkedInEasyApplyTransition(
  session: ExtensionExecutionSession,
  observation: AdapterObservation,
  stage: EasyApplyTransitionStage,
  detail: Record<string, string | number | boolean | null> = {},
): Promise<ExtensionExecutionSession> {
  const job = session.qualification.currentJob;
  if (!job) return session;
  const run = await reportExecutorEvent(session, {
    type: "easy_apply",
    idempotencyKey: [
      "easy-apply",
      session.runId,
      job.externalId,
      session.checkpoint.attempt,
      stage,
    ].join(":"),
    occurredAt: observation.observedAt,
    detail: {
      source: "linkedin",
      externalId: job.externalId,
      jobTitle: observation.job?.title ?? job.title ?? "LinkedIn job",
      stage,
      openAttempt: session.checkpoint.attempt,
      ...detail,
    },
  });
  return withRun(session, run);
}

async function openReviewOnlyApplication(
  tabId: number,
): Promise<ReviewOnlyApplicationOpenResult> {
  const directCommand = await waitForContentCommand(
    () => chrome.tabs.sendMessage(tabId, {
      type: "rapidapply.open-review-only-application",
    }),
    {
      timeoutMs: DIRECT_EASY_APPLY_COMMAND_TIMEOUT_MS,
      fallbackReason: "RapidApply could not reach the LinkedIn Easy Apply controller.",
    },
  );
  const directResponse = directCommand.kind === "response" ? directCommand.value : null;
  const directOutcome = directCommand.kind === "timeout"
    ? "timed_out"
    : directCommand.kind === "error"
      ? "unreachable"
      : isReviewOnlyCommandSuccess(directResponse)
        ? "confirmed"
        : "rejected";
  if (isReviewOnlyCommandSuccess(directResponse)) {
    return {
      ok: true,
      verification: "confirmed",
      directOutcome,
      trustedInputOutcome: "not_needed",
    };
  }

  const directReason = isReviewOnlyCommandFailure(directResponse)
    ? directResponse.reason
    : directCommand.kind === "timeout"
      ? "RapidApply did not receive a response from the LinkedIn page helper before the command deadline."
      : directCommand.kind === "error"
        ? directCommand.reason
        : undefined;
  const directCode = isReviewOnlyCommandFailure(directResponse)
    ? directResponse.code
    : undefined;
  const trustedInputEnabled = await hasTrustedInputPermission().catch(() => false);
  if (!trustedInputEnabled) {
    return {
      ok: false,
      reason: "LinkedIn ignored the direct page click and this Chrome profile has not granted RapidApply's trusted-input capability. Reload the updated helper, then retry this campaign.",
      code: directCode,
      directOutcome,
      trustedInputOutcome: "not_enabled",
    };
  }

  const trustedResult = await clickTrustedLinkedInAction("open_easy_apply", tabId);
  if (!trustedResult.ok) {
    return {
      ok: false,
      reason: trustedResult.reason ?? directReason ?? "RapidApply could not open LinkedIn Easy Apply.",
      code: directCode,
      directOutcome,
      trustedInputOutcome: "failed",
    };
  }

  // A trusted low-level mouse sequence does not return a DOM postcondition.
  // The controller verifies that LinkedIn actually rendered its application
  // surface after the current observation handler has completed.
  return {
    ok: true,
    verification: "pending",
    directOutcome,
    trustedInputOutcome: "dispatched",
  };
}

async function requestFreshApplicationObservation(tabId: number): Promise<boolean> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const response = await waitForContentCommand(
    () => chrome.tabs.sendMessage(tabId, {
      type: "rapidapply.flush-observation",
    }),
    { timeoutMs: 4_000 },
  );
  return response.kind === "response" &&
    typeof response.value === "object" && response.value !== null &&
    (response.value as { ok?: unknown }).ok === true;
}

async function verifyLinkedInApplicationOpening(
  session: ExtensionExecutionSession,
  jobDetailObservation: AdapterObservation,
): Promise<void> {
  // LinkedIn can render the dialog after the click acknowledgement while it
  // fetches account-specific form state. The legacy helper deliberately kept
  // checking for roughly 18–30 seconds; that persistence was functional, not
  // accidental. Preserve the same recovery window while keeping the loop
  // finite and observable.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (attempt > 0) await new Promise<void>((resolve) => setTimeout(resolve, 750));
    const current = await getExecutionSession();
    if (
      !current ||
      current.runId !== session.runId ||
      current.executorSessionId !== session.executorSessionId ||
      current.state !== "running" ||
      current.phase !== "opening_application"
    ) return;

    const inspection: unknown = await chrome.tabs.sendMessage(current.executorTabId, {
      type: "rapidapply.inspect-review-only-application",
    }).catch(() => null);
    if (isApplicationSurfaceInspection(inspection)) {
      const observedSession = await reportLinkedInEasyApplyTransition(
        current,
        jobDetailObservation,
        "form_observed",
      );
      await saveExecutionSession(observedSession);
      if (await requestFreshApplicationObservation(observedSession.executorTabId)) return;
    }
  }

  const current = await getExecutionSession();
  if (
    !current ||
    current.runId !== session.runId ||
    current.executorSessionId !== session.executorSessionId ||
    current.state !== "running" ||
    current.phase !== "opening_application"
  ) return;

  const timedOutSession = await reportLinkedInEasyApplyTransition(
    current,
    jobDetailObservation,
    "open_timeout",
  );
  await saveExecutionSession(timedOutSession);

  // Match the legacy helper's page-reset behavior once before abandoning the
  // listing. LinkedIn's SPA can leave the top card visually present while the
  // renderer is blank or the modal mount is stuck. Reloading the *same* saved
  // job URL lets the content script reinitialize its local state and retries
  // only this application's opening path; it never selects a new job or
  // submits anything.
  const job = timedOutSession.qualification.currentJob;
  if (job) {
    const retryCheckpoint = `application:open-retry:${job.externalId}`;
    const openingCheckpoint = `application:open-attempt:${job.externalId}`;
    const openingAttempt = timedOutSession.checkpoint.name === openingCheckpoint
      ? timedOutSession.checkpoint.attempt
      : 1;
    if (openingAttempt < 2) {
      const retrySession = {
        ...resumeCandidateController(timedOutSession, "application_retry"),
        checkpoint: {
          name: retryCheckpoint,
          attempt: openingAttempt,
          updatedAt: new Date().toISOString(),
        },
      };
      await saveExecutionSession(retrySession);
      await setExecutorBadge(retrySession, "…", "#7c3aed");
      await chrome.tabs.reload(retrySession.executorTabId);
      return;
    }
  }

  // After the bounded retry budget is exhausted, skip only this listing and
  // continue through the persisted candidate pool, where the next listing may
  // have a normal application surface.
  await skipUnavailableLinkedInApplication(
    timedOutSession,
    jobDetailObservation,
    "RapidApply verified the Easy Apply control but LinkedIn did not reveal an application form after the bounded modal and same-job reload retries.",
  );
}

function diagnosticMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message.slice(0, 300)
    : "unknown controller error";
}

function isApplicationSurfaceInspection(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    (value as { ok?: unknown }).ok === true &&
    ["application_form", "application_review", "application_confirmation"]
      .includes(String((value as { pageType?: unknown }).pageType));
}

async function sendReviewOnlyFillCommand(
  tabId: number,
  plans: readonly ApplicationAnswerPlanRecord[],
): Promise<{ ok: true; result: ReviewOnlyFillResult } | { ok: false; reason?: string }> {
  return sendReviewOnlyFillWithRetry({
    plans,
    send: (message) => chrome.tabs.sendMessage(tabId, message),
  });
}

async function sendReviewOnlyAdvanceCommand(
  tabId: number,
): Promise<{ ok: true; result: "advanced" | "review_ready" } | { ok: false; reason?: string }> {
  const response: unknown = await chrome.tabs.sendMessage(tabId, {
    type: "rapidapply.advance-review-only-application",
  }).catch(() => null);
  return isReviewOnlyAdvanceResponse(response)
    ? response
    : { ok: false, reason: "RapidApply could not verify the next application step." };
}

async function sendSubmitApplicationCommand(
  tabId: number,
): Promise<{ ok: true } | { ok: false; reason?: string }> {
  const response: unknown = await chrome.tabs.sendMessage(tabId, {
    type: "rapidapply.submit-application",
  }).catch(() => null);
  return isReviewOnlyCommandSuccess(response)
    ? response
    : {
        ok: false,
        reason: isReviewOnlyCommandFailure(response)
          ? response.reason
          : "RapidApply could not verify LinkedIn's application confirmation.",
      };
}

function isReviewOnlyCommandSuccess(value: unknown): value is { ok: true } {
  return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === true;
}

function isReviewOnlyCommandFailure(value: unknown): value is {
  ok: false;
  reason?: string;
  code?: "easy_apply_unavailable" | "easy_apply_open_failed";
} {
  return typeof value === "object" && value !== null &&
    (value as { ok?: unknown }).ok === false &&
    (typeof (value as { reason?: unknown }).reason === "string" ||
      (value as { reason?: unknown }).reason === undefined);
}

function isReviewOnlyAdvanceResponse(value: unknown): value is { ok: true; result: "advanced" | "review_ready" } {
  return isReviewOnlyCommandSuccess(value) &&
    ["advanced", "review_ready"].includes(String((value as { result?: unknown }).result));
}

export async function beginExecutionSession(session: ExtensionExecutionSession): Promise<void> {
  await saveExecutionSession(session);
  await setExecutorBadge(session, "…", "#7c3aed");
}

export async function finishExecutionSession(tabId: number): Promise<void> {
  await clearExecutionSession();
  try {
    await chrome.action.setBadgeText({ tabId, text: "" });
  } catch {
    // The execution tab may have closed before cleanup runs.
  }
}

export async function reportExecutorEvent(
  session: ExtensionExecutionSession,
  event: ExecutorEventReport,
): Promise<BrowserRunSummary> {
  const response = await fetch(new URL("/api/executor/events", session.controllerOrigin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: session.runId,
      executorSessionId: session.executorSessionId,
      executorEventToken: session.executorEventCapability.token,
      ...event,
    }),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok || !isExecutorEventResponse(payload)) {
    throw new Error("RapidApply could not record browser-helper progress.");
  }

  if (TERMINAL_STATES.has(payload.run.state)) {
    await finishExecutionSession(session.executorTabId);
  }
  return payload.run;
}

async function claimExecutionHandoff(
  message: ExecutionHandoffRequest,
  executorTabId: number,
): Promise<ExecutionHandoffResponse> {
  const ticketFingerprint = await fingerprintTicket(message.executionTicket.token);
  let existing = await getExecutionSession();

  if (existing && !TERMINAL_STATES.has(existing.state)) {
    // A campaign can be cancelled from the web dashboard while the helper is
    // asleep. Reconcile the persisted local session before treating its tab
    // ownership as active; otherwise a cancelled run can strand the browser
    // executor until the extension is manually reset.
    try {
      const authoritativeRun = await readAuthoritativeExecutorRun(existing);
      if (TERMINAL_STATES.has(authoritativeRun.state)) {
        await clearExecutionSession();
        existing = null;
      }
    } catch (error) {
      if (isStaleExecutorCapabilityError(error)) {
        await clearExecutionSession();
        existing = null;
      }
      // Preserve the existing ownership when the server cannot be reached;
      // a transient outage must not allow two controllers to race on one tab.
    }
  }

  if (existing && !TERMINAL_STATES.has(existing.state)) {
    const exactReplay =
      existing.runId === message.executionTicket.runId &&
      existing.executorTabId === executorTabId &&
      existing.controllerOrigin === message.origin &&
      existing.claimTicketFingerprint === ticketFingerprint;
    if (exactReplay) return { ok: true, run: existing.run };

    if (existing.runId !== message.executionTicket.runId) {
      return {
        ok: false,
        reason: "Another RapidApply campaign already owns the browser executor tab.",
      };
    }
    // A different valid ticket for the same run is an explicit server-issued
    // recovery handoff. Its successful claim atomically invalidates the old
    // local capability before this checkpoint is replaced.
  } else if (existing) {
    await clearExecutionSession();
  }

  const executorSessionId = crypto.randomUUID();
  const response = await fetch(new URL("/api/executor/claim", message.origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: message.executionTicket.runId,
      executionTicket: message.executionTicket.token,
      executorSessionId,
      executorTabId,
      extensionVersion: chrome.runtime.getManifest().version,
    }),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok || !isClaimResponse(payload)) {
    return {
      ok: false,
      reason: "RapidApply could not prepare this campaign. Return to the app and try again.",
    };
  }

  const session = existing && existing.runId === message.executionTicket.runId
    ? rebindExecutionSession({
        previous: existing,
        run: payload.run,
        executionPlan: payload.executionPlan,
        executorEventCapability: payload.executorEventCapability,
        claimTicketFingerprint: ticketFingerprint,
        executorTabId,
        executorSessionId,
      })
    : createExecutionSession({
        run: payload.run,
        executionPlan: payload.executionPlan,
        executorEventCapability: payload.executorEventCapability,
        claimTicketFingerprint: ticketFingerprint,
        executorTabId,
        executorSessionId,
        controllerOrigin: message.origin,
      });
  await beginExecutionSession(session);
  return { ok: true, run: session.run };
}

function isStaleExecutorCapabilityError(error: unknown): boolean {
  // Cross-realm / bundled Error subclasses are not always reliable with
  // instanceof inside an MV3 service worker. The stable name is deliberate.
  const name = typeof error === "object" && error !== null && "name" in error
    ? (error as { name?: unknown }).name
    : undefined;
  return error instanceof StaleExecutorCapabilityError || name === "StaleExecutorCapabilityError";
}

async function acknowledgeExecutionLaunch(
  message: ExecutionLaunchAcknowledgementRequest,
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: boolean; reason?: string }> {
  const session = await getExecutionSession();
  if (
    !session ||
    sender.tab?.id === undefined ||
    !ownsExecutorTab(session, sender.tab.id) ||
    session.runId !== message.runId ||
    session.controllerOrigin !== message.origin ||
    !canAcceptLaunchPage(message.origin, message.runId, sender)
  ) {
    return { ok: false, reason: "invalid_launch_acknowledgement" };
  }

  if (session.phase === "claimed") {
    let activeSession = session;
    if (!activeSession.profileResumeUploaded) {
      activeSession = await performPreflightProfileResumeUpload(activeSession);
      return { ok: true };
    }
    const navigating = beginSearchNavigation(activeSession);
    await saveExecutionSession(navigating);
    await chrome.tabs.update(navigating.executorTabId, {
      url: navigating.discovery.searchUrl,
    });
    return { ok: true };
  }

  // The page can replay its acknowledgement if it did not see Chrome begin
  // navigation. Never rewind a controller that has already progressed.
  if (session.phase === "navigating_to_search") {
    await chrome.tabs.update(session.executorTabId, { url: session.discovery.searchUrl });
  }
  return { ok: true };
}

async function performPreflightProfileResumeUpload(
  session: ExtensionExecutionSession,
): Promise<ExtensionExecutionSession> {
  if (session.profileResumeUploaded) return session;

  try {
    // Inspect LinkedIn before requesting PDF bytes or touching local downloads.
    await chrome.tabs.update(session.executorTabId, {
      url: "https://www.linkedin.com/jobs/application-settings/",
    });

    let existingFileNames: string[] = [];
    let profileResumeInspectionSucceeded = false;
    for (let attempt = 0; attempt < 25; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      try {
        const listed: unknown = await chrome.tabs.sendMessage(session.executorTabId, {
          type: "rapidapply.list-profile-resumes",
        });
        if (
          typeof listed === "object" &&
          listed !== null &&
          (listed as { ok?: unknown }).ok === true &&
          Array.isArray((listed as { fileNames?: unknown }).fileNames)
        ) {
          profileResumeInspectionSucceeded = true;
          existingFileNames = (listed as { fileNames: unknown[] }).fileNames
            .filter((value): value is string => typeof value === "string")
            .slice(0, 100);
          if (existingFileNames.length > 0 || attempt === 24) break;
        }
      } catch {
        // Tab loading
      }
    }
    if (!profileResumeInspectionSucceeded) {
      throw new Error("RapidApply could not inspect LinkedIn Application Settings before requesting the resume.");
    }

    const audit = await requestExecutorResumeAudit(session, existingFileNames);
    if (!audit.needsUpload) {
      const updatedSession: ExtensionExecutionSession = {
        ...session,
        profileResumeUploaded: true,
      };
      await saveExecutionSession(updatedSession);
      const navigating = beginSearchNavigation(updatedSession);
      await saveExecutionSession(navigating);
      await chrome.tabs.update(navigating.executorTabId, {
        url: navigating.discovery.searchUrl,
      });
      return navigating;
    }

    const reusable = await findReusableManagedResume(audit.summary);
    const downloaded = reusable
      ? null
      : await downloadExecutorResume(await requestExecutorResumeDocument(session));
    const absolutePath = reusable?.absolutePath ?? downloaded?.absolutePath;
    const fileName = reusable?.summary.fileName ?? downloaded?.document.fileName;
    if (!absolutePath || !fileName) {
      throw new Error("RapidApply could not prepare the audited resume for LinkedIn.");
    }
    const result = await ensureLinkedInProfileResumeUploaded(
      session.executorTabId,
      absolutePath,
      fileName,
    );
    if (!result.ok) {
      throw new Error(result.reason ?? "LinkedIn did not confirm the profile resume upload.");
    }

    const updatedSession: ExtensionExecutionSession = {
      ...session,
      profileResumeUploaded: true,
    };
    await saveExecutionSession(updatedSession);

    const navigating = beginSearchNavigation(updatedSession);
    await saveExecutionSession(navigating);
    await chrome.tabs.update(navigating.executorTabId, {
      url: navigating.discovery.searchUrl,
    });
    return navigating;
  } catch (error) {
    const updatedSession: ExtensionExecutionSession = {
      ...session,
      profileResumeUploaded: true,
    };
    const navigating = beginSearchNavigation(updatedSession);
    await saveExecutionSession(navigating);
    await chrome.tabs.update(navigating.executorTabId, {
      url: navigating.discovery.searchUrl,
    });
    return navigating;
  }
}

async function synchronizeExecutionState(
  message: ExecutionStateSyncRequest,
): Promise<{ ok: boolean; reason?: string }> {
  const session = await getExecutionSession();
  if (!session || session.runId !== message.runId) {
    return { ok: false, reason: "no_matching_execution" };
  }

  if (message.state === "cancelled") {
    await finishExecutionSession(session.executorTabId);
    return { ok: true };
  }

  if (message.state === "paused" || message.state === "needs_user_input") {
    await saveExecutionSession({
      ...session,
      state: message.state,
      run: { ...session.run, state: message.state },
    });
    return { ok: true };
  }

  const run = await readAuthoritativeExecutorRun(session);
  if (run.state !== "running") {
    return { ok: false, reason: "server_execution_not_running" };
  }

  const waitingContext = session.awaitingUserContext;
  if (
    session.phase === "awaiting_user" &&
    ["application_intervention", "deferred_question", "final_review"].includes(
      waitingContext ?? "",
    )
  ) {
    const runningSession = withRun(session, run);
    const pausedRun = await reportExecutorEvent(runningSession, {
      type: "user_input_required",
      idempotencyKey: [
        "explicit-resume-blocked",
        runningSession.runId,
        runningSession.checkpoint.name,
        waitingContext ?? "unknown",
        run.updatedAt,
      ].join(":"),
      detail: {
        reason: explicitResumeBlockedReason(waitingContext),
        waitingFor: waitingContext ?? "manual_verification",
      },
    });
    await saveExecutionSession(waitForCandidate(
      withRun(runningSession, pausedRun),
      waitingContext ?? "manual_verification",
    ));
    return { ok: true };
  }

  const canRetryApplication = session.phase === "awaiting_user" &&
    (
      waitingContext === "resume_selection" ||
      waitingContext === "manual_verification" ||
      (waitingContext === undefined &&
        !session.checkpoint.name.startsWith("manual:") &&
        !session.checkpoint.name.startsWith("qualification:"))
    );
  const sessionForExplicitResume = canRetryApplication
    ? resumeCandidateController({
        ...session,
        run,
        state: run.state,
        applicationResume: undefined,
      }, "application_retry")
    : { ...session, run, state: run.state, awaitingUserContext: undefined };
  const resumed = resumeExecutionSession(sessionForExplicitResume, run);
  if (resumed.blockedReason) {
    const pausedRun = await reportExecutorEvent(resumed.session, {
      type: "user_input_required",
      idempotencyKey: `qualification-resume-blocked:${resumed.session.runId}:${resumed.session.checkpoint.name}`,
      detail: {
        reason: resumed.blockedReason,
        qualificationStatus: qualificationStatusFromCheckpoint(resumed.session.checkpoint.name),
        discoveredJobs: resumed.session.discovery.jobs.length,
        poolTarget: resumed.session.discovery.poolTarget,
        waitingFor: "qualification",
      },
    });
    await saveExecutionSession(waitForCandidate(
      withRun(resumed.session, pausedRun),
      "qualification",
    ));
    return { ok: true };
  }
  await saveExecutionSession(resumed.session);
  if (resumed.navigateUrl) {
    await chrome.tabs.update(resumed.session.executorTabId, { url: resumed.navigateUrl });
    return { ok: true };
  }

  await flushObservationAfterResume({
    tabId: resumed.session.executorTabId,
    send: (message) => chrome.tabs.sendMessage(resumed.session.executorTabId, message),
    inject: injectLinkedInObserver,
    reload: (tabId) => chrome.tabs.reload(tabId),
  });
  return { ok: true };
}

async function refreshApplicationInterventions(
  message: ApplicationInterventionsUpdatedRequest,
): Promise<{ ok: boolean; reason?: string }> {
  const session = await getExecutionSession();
  if (
    !session ||
    session.runId !== message.runId ||
    session.state !== "needs_user_input" ||
    session.awaitingUserContext !== "application_intervention"
  ) {
    return { ok: false, reason: "no_matching_application_question" };
  }
  await chrome.tabs.sendMessage(session.executorTabId, {
    type: "rapidapply.flush-observation",
  }).catch(() => undefined);
  return { ok: true };
}

async function readAuthoritativeExecutorRun(
  session: ExtensionExecutionSession,
): Promise<BrowserRunSummary> {
  const response = await fetch(new URL("/api/executor/status", session.controllerOrigin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: session.runId,
      executorSessionId: session.executorSessionId,
      executorEventToken: session.executorEventCapability.token,
    }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok && response.status < 500) {
    throw new StaleExecutorCapabilityError();
  }
  if (!response.ok || !isExecutorEventResponse(payload)) {
    throw new Error("RapidApply could not refresh the executor state.");
  }
  return payload.run;
}

async function reconcileStoredExecutorTab(): Promise<void> {
  const session = await getExecutionSession();
  if (!session) return;

  try {
    const tab = await chrome.tabs.get(session.executorTabId);
    const tabUrl = tab.pendingUrl ?? tab.url;
    if (!tabUrl || !isValidExecutorTabUrl(session, tabUrl)) {
      await retireLostExecutorSession(
        session,
        "The RapidApply browser tab was closed or navigated away. Reconnect the browser helper to continue this campaign.",
      );
      return;
    }

    // Service workers restart routinely, but an extension *reload* also
    // invalidates the content script in an already-open LinkedIn executor
    // tab. Re-establish only the stored, running executor observation. The
    // helper itself decides whether a reload is needed, and it never replays
    // any form action while doing so.
    if (shouldRepairExecutorObservation(session) && isLinkedInExecutorPage(tabUrl)) {
      await flushObservationAfterResume({
        tabId: session.executorTabId,
        send: (message) => chrome.tabs.sendMessage(session.executorTabId, message),
        inject: injectLinkedInObserver,
        reload: (tabId) => chrome.tabs.reload(tabId),
      });
    }
  } catch {
    await retireLostExecutorSession(
      session,
      "RapidApply could no longer find the browser tab running this campaign. Reconnect the browser helper to continue.",
    );
  }
}

async function injectLinkedInObserver(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content-scripts/linkedin-observer.js"],
  });
}

async function clearRemovedExecutorTab(tabId: number): Promise<void> {
  const session = await getExecutionSession();
  if (session?.executorTabId !== tabId) return;
  await retireLostExecutorSession(
    session,
    "The RapidApply browser tab was closed. Reconnect the browser helper to continue this campaign.",
  );
}

/**
 * A campaign is bound to one deliberately created executor tab. If that tab
 * disappears, do not leave the server showing a deceptive "running" status:
 * release the local binding and ask the dashboard for a fresh, scoped handoff.
 * The event is best-effort because the capability may already be expired, but
 * clearing the local session is mandatory so a reconnect cannot inherit stale
 * browser state.
 */
async function retireLostExecutorSession(
  session: ExtensionExecutionSession,
  reason: string,
): Promise<void> {
  try {
    if (session.state === "running") {
      await reportExecutorEvent(session, {
        type: "user_input_required",
        idempotencyKey: `executor-tab-lost:${session.executorSessionId}:${session.executorTabId}`,
        detail: {
          reason,
          waitingFor: "reconnect_browser_helper",
          executorTabId: session.executorTabId,
        },
      });
    }
  } catch {
    // A missing or expired executor capability must not leave local state
    // behind. The server will reject stale events and the user can reconnect
    // from the dashboard with a freshly scoped ticket.
  } finally {
    await clearExecutionSession();
  }
}

function isValidExecutorTabUrl(
  session: ExtensionExecutionSession,
  value: string,
): boolean {
  try {
    const url = new URL(value);
    return (
      (url.origin === session.controllerOrigin &&
        url.pathname === `/launch/${session.runId}`) ||
      (url.protocol === "https:" && url.hostname === "www.linkedin.com")
    );
  } catch {
    return false;
  }
}

function isLinkedInExecutorPage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.linkedin.com";
  } catch {
    return false;
  }
}

function withRun(
  session: ExtensionExecutionSession,
  run: BrowserRunSummary,
): ExtensionExecutionSession {
  return { ...session, run, state: run.state };
}

function waitForCandidate(
  session: ExtensionExecutionSession,
  context: AwaitingUserContext,
): ExtensionExecutionSession {
  return {
    ...session,
    phase: "awaiting_user",
    awaitingUserContext: context,
  };
}

function resumeCandidateController(
  session: ExtensionExecutionSession,
  phase: ExtensionExecutionSession["phase"] = "qualification_complete",
): ExtensionExecutionSession {
  return {
    ...session,
    phase,
    awaitingUserContext: undefined,
  };
}

function explicitResumeBlockedReason(context: AwaitingUserContext | undefined): string {
  switch (context) {
    case "application_intervention":
      return "RapidApply is waiting for the saved application answer. Answer it in the dashboard or the focused browser helper first.";
    case "deferred_question":
      return "RapidApply has a deferred application question waiting in Answer Center. Review it before resuming this application.";
    case "final_review":
      return "LinkedIn is at final review. RapidApply will not submit the application; review it directly in the browser instead.";
    default:
      return "RapidApply is waiting at a saved candidate-input checkpoint.";
  }
}

function observationCheckpointName(
  session: ExtensionExecutionSession,
  message: AdapterObservationMessage,
): string {
  return [
    session.executorSessionId,
    message.observation.adapterId,
    message.observation.pageType,
    message.observation.pageType === "search_results"
      ? String(session.discovery.pageIndex)
      : null,
    message.observation.fingerprint,
  ].filter((part): part is string => part !== null).join(":");
}

function markWebAppReady(message: WebAppReadyMessage, sender: chrome.runtime.MessageSender): void {
  if (sender.tab?.id === undefined || !canAcceptRapidApplyPage(message.origin, sender)) return;
  void chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#10b981" });
  void chrome.action.setBadgeText({ tabId: sender.tab.id, text: "✓" });
}

async function setExecutorBadge(
  session: ExtensionExecutionSession,
  text: string,
  color: string,
): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId: session.executorTabId, color });
    await chrome.action.setBadgeText({ tabId: session.executorTabId, text });
  } catch {
    // Badge state is cosmetic; the durable checkpoint remains authoritative.
  }
}

function canAcceptRapidApplyPage(origin: string, sender: chrome.runtime.MessageSender): boolean {
  if (!RAPIDAPPLY_WEB_ORIGINS.has(origin) || sender.tab?.id === undefined) return false;
  const senderUrl = sender.url ?? sender.tab.url;
  if (!senderUrl) return false;
  try {
    return new URL(senderUrl).origin === origin;
  } catch {
    return false;
  }
}

function canAcceptLaunchPage(
  origin: string,
  runId: string,
  sender: chrome.runtime.MessageSender,
): boolean {
  if (!canAcceptRapidApplyPage(origin, sender)) return false;
  const senderUrl = sender.url ?? sender.tab?.url;
  if (!senderUrl) return false;
  try {
    return new URL(senderUrl).pathname === `/launch/${runId}`;
  } catch {
    return false;
  }
}

function canAcceptLinkedInObservation(
  message: AdapterObservationMessage,
  sender: chrome.runtime.MessageSender,
): boolean {
  if (message.observation.adapterId !== "linkedin" || !isTrustedLinkedInSender(sender)) {
    return false;
  }
  const senderUrl = sender.url ?? sender.tab?.url;
  if (!senderUrl) return false;
  try {
    return new URL(senderUrl).pathname === message.observation.path;
  } catch {
    return false;
  }
}

function isTrustedLinkedInSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.tab?.id === undefined) return false;
  const senderUrl = sender.url ?? sender.tab.url;
  if (!senderUrl) return false;
  try {
    const url = new URL(senderUrl);
    return url.protocol === "https:" && url.hostname === "www.linkedin.com";
  } catch {
    return false;
  }
}

function isExpectedLinkedInSearchPage(
  session: ExtensionExecutionSession,
  senderUrl: string | undefined,
): boolean {
  if (!senderUrl) return false;
  try {
    const url = new URL(senderUrl);
    const start = Number.parseInt(url.searchParams.get("start") ?? "0", 10);
    return (
      url.pathname.startsWith("/jobs/search") &&
      Number.isFinite(start) &&
      start === session.discovery.pageIndex * 25
    );
  } catch {
    return false;
  }
}

function qualificationStatusFromCheckpoint(
  checkpointName: string,
): "qualified" | "skipped" | "needs_user_input" {
  if (checkpointName.startsWith("qualification:qualified:")) return "qualified";
  if (checkpointName.startsWith("qualification:skipped:")) return "skipped";
  return "needs_user_input";
}

async function fingerprintTicket(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isWebAppReadyMessage(value: unknown): value is WebAppReadyMessage {
  return isRecord(value) &&
    value.type === "rapidapply.web-app-ready" &&
    typeof value.origin === "string";
}

function isPublicExecutionStatusRequest(value: unknown): value is PublicExecutionStatusRequest {
  return isRecord(value) &&
    value.type === "rapidapply.execution-status" &&
    typeof value.origin === "string";
}

function isExecutionHandoffRequest(value: unknown): value is ExecutionHandoffRequest {
  return isRecord(value) &&
    value.type === "rapidapply.execution-handoff" &&
    typeof value.origin === "string" &&
    isBrowserExecutionTicket(value.executionTicket);
}

function isExecutionLaunchAcknowledgementRequest(
  value: unknown,
): value is ExecutionLaunchAcknowledgementRequest {
  return isRecord(value) &&
    value.type === "rapidapply.execution-launch-acknowledged" &&
    typeof value.origin === "string" &&
    typeof value.runId === "string";
}

function isExecutionStateSyncRequest(value: unknown): value is ExecutionStateSyncRequest {
  return isRecord(value) &&
    value.type === "rapidapply.execution-state-sync" &&
    typeof value.origin === "string" &&
    typeof value.runId === "string" &&
    ["running", "paused", "needs_user_input", "cancelled"].includes(String(value.state));
}

function isApplicationInterventionsUpdatedRequest(
  value: unknown,
): value is ApplicationInterventionsUpdatedRequest {
  return isRecord(value) &&
    value.type === "rapidapply.application-interventions-updated" &&
    typeof value.origin === "string" &&
    typeof value.runId === "string";
}

function isClaimResponse(value: unknown): value is ExecutorClaimResponse {
  if (!isRecord(value)) return false;
  if (
    !isBrowserRunSummary(value.run) ||
    !isBrowserExecutorEventCapability(value.executorEventCapability) ||
    !isBrowserExecutionPlan(value.executionPlan)
  ) return false;

  return (
    value.executorEventCapability.runId === value.run.id &&
    value.executionPlan.runId === value.run.id
  );
}

function isExecutorEventResponse(value: unknown): value is { run: BrowserRunSummary } {
  return isRecord(value) && isBrowserRunSummary(value.run);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
