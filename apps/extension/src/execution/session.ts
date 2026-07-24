import type {
  AdapterObservation,
} from "../adapters/types";
import type {
  BrowserExecutionPlan,
  BrowserExecutorEventCapability,
  BrowserRunSummary,
  DiscoveredJobReference,
  ExtensionExecutionSession,
} from "@rapidapply/contracts";
import {
  AWAITING_USER_CONTEXTS,
  EXECUTION_PHASES,
  isBrowserExecutionPlan,
  isBrowserExecutorEventCapability,
  isBrowserRunSummary,
  isRunState,
} from "@rapidapply/contracts";
import {
  createLinkedInDiscoveryState,
  mergeDiscoveredJobs,
  nextLinkedInSearchPageUrl,
} from "../adapters/linkedin/search";

const MAX_QUALIFICATION_INSPECTION_BUDGET = 120;

export function createExecutionSession(input: {
  run: BrowserRunSummary;
  executionPlan: BrowserExecutionPlan;
  executorEventCapability: BrowserExecutorEventCapability;
  claimTicketFingerprint: string;
  executorTabId: number;
  executorSessionId: string;
  controllerOrigin: string;
  now?: string;
}): ExtensionExecutionSession {
  const now = input.now ?? new Date().toISOString();
  return {
    schemaVersion: 2,
    runId: input.run.id,
    claimTicketFingerprint: input.claimTicketFingerprint,
    executorTabId: input.executorTabId,
    executorSessionId: input.executorSessionId,
    executorEventCapability: input.executorEventCapability,
    controllerOrigin: input.controllerOrigin,
    state: input.run.state,
    phase: "claimed",
    run: input.run,
    executionPlan: input.executionPlan,
    discovery: createLinkedInDiscoveryState(input.executionPlan),
    qualification: {
      // Qualification is deliberately bounded to the campaign's persisted
      // discovery pool. Every navigation still targets a canonical URL that
      // this session collected itself; an unavailable listing therefore moves
      // forward through known candidates instead of ending the whole run.
      inspectionBudget: qualificationInspectionBudget(input.executionPlan),
      inspectedExternalIds: [],
    },
    checkpoint: {
      name: "browser-helper-claimed",
      attempt: 1,
      updatedAt: now,
    },
    pendingEventIds: [],
  };
}

/**
 * Rebind a same-run recovery handoff to a new browser tab/session without
 * throwing away the durable discovery and qualification checkpoint. A new
 * ticket changes authority, not campaign progress.
 */
export function rebindExecutionSession(input: {
  previous: ExtensionExecutionSession;
  run: BrowserRunSummary;
  executionPlan: BrowserExecutionPlan;
  executorEventCapability: BrowserExecutorEventCapability;
  claimTicketFingerprint: string;
  executorTabId: number;
  executorSessionId: string;
  now?: string;
}): ExtensionExecutionSession {
  return {
    ...input.previous,
    claimTicketFingerprint: input.claimTicketFingerprint,
    executorTabId: input.executorTabId,
    executorSessionId: input.executorSessionId,
    executorEventCapability: input.executorEventCapability,
    state: input.run.state,
    run: input.run,
    // A recovery ticket is also the server's chance to issue an updated,
    // authoritative execution policy. Retaining the previous plan here could
    // strand a campaign in review-only mode even after the server enabled a
    // controlled submission run.
    executionPlan: input.executionPlan,
    // A recovery rebind changes the live browser authority. Re-assert the
    // target resume against the current LinkedIn DOM before trusting it again.
    applicationResume: undefined,
    checkpoint: {
      ...input.previous.checkpoint,
      updatedAt: input.now ?? new Date().toISOString(),
    },
    pendingEventIds: [],
  };
}

export function ownsExecutorTab(session: ExtensionExecutionSession, tabId: number): boolean {
  return session.executorTabId === tabId;
}

export function beginSearchNavigation(
  session: ExtensionExecutionSession,
  now = new Date().toISOString(),
): ExtensionExecutionSession {
  return {
    ...session,
    phase: "navigating_to_search",
    checkpoint: nextCheckpoint(session, "navigate:linkedin-search:0", now),
  };
}

export function beginSearchDiscovery(
  session: ExtensionExecutionSession,
  now = new Date().toISOString(),
): ExtensionExecutionSession {
  return {
    ...session,
    phase: "discovering_search",
    checkpoint: nextCheckpoint(
      session,
      `discover:linkedin-search:${session.discovery.pageIndex}`,
      now,
    ),
  };
}

export type LinkedInJobQualification =
  | {
      status: "qualified";
      job: DiscoveredJobReference;
      reason: string;
    }
  | {
      status: "skipped";
      job: DiscoveredJobReference;
      reason: string;
    }
  | {
      status: "needs_user_input";
      job?: DiscoveredJobReference;
      reason: string;
    };

/**
 * Select exactly one persisted LinkedIn job in deterministic discovery order.
 * The controller must navigate to this URL itself before it accepts any job
 * detail observation as evidence for the campaign.
 */
export function beginJobQualification(
  session: ExtensionExecutionSession,
  now = new Date().toISOString(),
): { session: ExtensionExecutionSession; job?: DiscoveredJobReference } {
  const remainingBudget = session.qualification.inspectionBudget -
    session.qualification.inspectedExternalIds.length;
  const job = remainingBudget > 0
    ? session.discovery.jobs.find((candidate) =>
      !session.qualification.inspectedExternalIds.includes(candidate.externalId))
    : undefined;

  if (!job) {
    return {
      session: {
        ...session,
        phase: "qualification_complete",
        applicationResume: undefined,
        checkpoint: nextCheckpoint(session, "qualification:linkedin:no-candidate", now),
      },
    };
  }

  return {
    job,
    session: {
      ...session,
      phase: "navigating_to_job",
      applicationResume: undefined,
      qualification: {
        ...session.qualification,
        currentJob: job,
      },
      checkpoint: nextCheckpoint(
        session,
        `navigate:linkedin-job:${job.externalId}`,
        now,
      ),
    },
  };
}

export function beginJobObservationQualification(
  session: ExtensionExecutionSession,
  now = new Date().toISOString(),
): ExtensionExecutionSession {
  const externalId = session.qualification.currentJob?.externalId ?? "unknown";
  return {
    ...session,
    phase: "qualifying_job",
    checkpoint: nextCheckpoint(
      session,
      `qualify:linkedin-job:${externalId}`,
      now,
    ),
  };
}

export function isExpectedLinkedInJobUrl(
  session: ExtensionExecutionSession,
  value: string | undefined,
): boolean {
  const expected = session.qualification.currentJob;
  if (!expected || !value) return false;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "www.linkedin.com") return false;

    // Canonical standalone job-detail URL (with or without trailing slash).
    if (
      url.pathname === `/jobs/view/${expected.externalId}` ||
      url.pathname === `/jobs/view/${expected.externalId}/` ||
      url.pathname.startsWith(`/jobs/view/${expected.externalId}/`)
    ) return true;

    // LinkedIn right-panel view: /jobs/search?currentJobId=XXXX
    if (
      url.pathname.startsWith("/jobs/search") &&
      url.searchParams.get("currentJobId") === expected.externalId
    ) return true;

    return false;
  } catch {
    return false;
  }
}

/**
 * A recovered application controller can legitimately be back on its saved
 * job-detail URL after an extension reload, a modal dismissal, or a browser
 * history restoration. In that exact case the helper may re-open Easy Apply
 * and verify the resulting surface before it attempts any form work again.
 *
 * This is deliberately narrower than a general retry: it never changes jobs,
 * operates only for an active application retry, and requires the canonical
 * job URL that was qualified for this run.
 */
export function shouldReopenLinkedInApplicationRetry(
  session: ExtensionExecutionSession,
  observation: Pick<AdapterObservation, "pageType">,
  value: string | undefined,
): boolean {
  return (
    session.state === "running" &&
    session.phase === "application_retry" &&
    observation.pageType === "job_detail" &&
    isExpectedLinkedInJobUrl(session, value)
  );
}

/**
 * Recover the opener when qualification was durably completed but the
 * fire-and-forget Easy Apply command was lost with a service-worker restart.
 * The recovery is limited to the exact qualified job and requires the observer
 * to see a live, enabled Easy Apply action on the settled job-detail page.
 */
export function shouldRecoverLinkedInEasyApplyOpening(
  session: ExtensionExecutionSession,
  observation: Pick<AdapterObservation, "pageType" | "job" | "actions">,
  value: string | undefined,
): boolean {
  const currentJob = session.qualification.currentJob;
  const hasEnabledEasyApply = observation.actions.some((action) =>
    action.kind === "open_application" && !action.disabled
  );

  return session.state === "running" &&
    ["qualification_complete", "application_retry"].includes(session.phase) &&
    observation.pageType === "job_detail" &&
    Boolean(currentJob && observation.job?.externalId === currentJob.externalId) &&
    hasEnabledEasyApply &&
    isExpectedLinkedInJobUrl(session, value);
}

/**
 * A confirmation surface is authoritative only while this run is actively
 * waiting for the result of its own submit action. LinkedIn can leave the
 * previous success text mounted while the browser is already showing another
 * job, so page text alone is not sufficient proof of a new submission.
 */
export function isAwaitingLinkedInSubmissionConfirmation(
  session: ExtensionExecutionSession,
  observation: Pick<AdapterObservation, "pageType" | "job">,
): boolean {
  const currentJob = session.qualification.currentJob;
  return session.state === "running" &&
    session.phase === "processing_application" &&
    observation.pageType === "application_confirmation" &&
    Boolean(currentJob && observation.job?.externalId === currentJob.externalId);
}

/**
 * Classify a job-detail observation without touching its controls. A positive
 * result means only that the next, separately verified application adapter may
 * consider this listing; it never opens Easy Apply or changes the page.
 */
export function qualifyLinkedInJobObservation(
  session: ExtensionExecutionSession,
  observation: AdapterObservation,
): LinkedInJobQualification {
  const expected = session.qualification.currentJob;
  if (!expected) {
    return {
      status: "needs_user_input",
      reason: "RapidApply reached a LinkedIn job page without a saved job checkpoint.",
    };
  }

  if (observation.pageType !== "job_detail") {
    return {
      status: "needs_user_input",
      job: expected,
      reason: "RapidApply expected a LinkedIn job detail page before qualification.",
    };
  }

  if (observation.job?.externalId !== expected.externalId) {
    return {
      status: "needs_user_input",
      job: expected,
      reason: "RapidApply could not verify that LinkedIn opened the saved job listing.",
    };
  }

  const excludedTerm = firstMatchingExcludedTerm(session, observation);
  if (excludedTerm) {
    return {
      status: "skipped",
      job: expected,
      reason: `Skipped because it matches your excluded term: ${excludedTerm}.`,
    };
  }

  const bodyText = (observation.title + " " + (observation.heading ?? "")).toLowerCase();
  if (
    bodyText.includes("application submitted") ||
    bodyText.includes("application was sent") ||
    bodyText.includes("applied")
  ) {
    return {
      status: "skipped",
      job: expected,
      reason: "Skipped because this application was already submitted on LinkedIn.",
    };
  }

  const easyApply = observation.actions.find((action) => action.kind === "open_application");
  if (!easyApply || easyApply.disabled) {
    return {
      status: "skipped",
      job: expected,
      reason: "Skipped because an enabled Easy Apply control was not observed.",
    };
  }

  return {
    status: "qualified",
    job: expected,
    reason: "Verified LinkedIn job detail and enabled Easy Apply availability.",
  };
}

export function completeJobQualification(
  session: ExtensionExecutionSession,
  result: LinkedInJobQualification,
  now = new Date().toISOString(),
): ExtensionExecutionSession {
  const externalId = result.job?.externalId;
  const inspectedExternalIds = externalId && !session.qualification.inspectedExternalIds.includes(externalId)
    ? [...session.qualification.inspectedExternalIds, externalId]
    : session.qualification.inspectedExternalIds;
  const checkpointSuffix = externalId ?? "unknown";

  return {
    ...session,
    phase: "qualification_complete",
    qualification: {
      ...session.qualification,
      inspectedExternalIds,
    },
    checkpoint: nextCheckpoint(
      session,
      `qualification:${result.status}:${checkpointSuffix}`,
      now,
    ),
  };
}

export function resumeExecutionSession(
  session: ExtensionExecutionSession,
  run: BrowserRunSummary,
  now = new Date().toISOString(),
): {
  session: ExtensionExecutionSession;
  navigateUrl?: string;
  blockedReason?: string;
} {
  const resumed: ExtensionExecutionSession = { ...session, run, state: run.state };
  if (
    resumed.phase === "awaiting_user" &&
    resumed.checkpoint.name.startsWith("qualification:")
  ) {
    return {
      // Qualification is a recoverable controller checkpoint, not a reason
      // to strand the campaign. Re-enter discovery from the persisted search
      // URL and let the normal candidate-pool logic select the next listing.
      // Only form questions and genuinely ambiguous required inputs remain
      // user-blocking checkpoints.
      session: {
        ...resumed,
        phase: "navigating_to_search",
        checkpoint: {
          name: `resume:linkedin-search:${resumed.discovery.pageIndex}`,
          attempt: 1,
          updatedAt: now,
        },
      },
      navigateUrl: resumed.discovery.searchUrl,
    };
  }
  if (
    resumed.phase === "awaiting_user" &&
    (resumed.awaitingUserContext === "manual_verification" ||
      resumed.awaitingUserContext === "resume_selection") &&
    resumed.checkpoint.name.startsWith("application:")
  ) {
    // Application recovery checkpoints must re-enter the application
    // controller. Leaving this phase as awaiting_user makes the observer
    // acknowledge a live form while every normal fill/advance branch remains
    // intentionally disabled, which strands the campaign after a retry.
    return {
      session: {
        ...resumed,
        phase: "application_retry",
        awaitingUserContext: undefined,
        checkpoint: {
          ...resumed.checkpoint,
          name: `resume:linkedin-application:${resumed.qualification.currentJob?.externalId ?? "unknown"}`,
          attempt: 1,
          updatedAt: now,
        },
      },
    };
  }
  if (resumed.phase !== "awaiting_user" || !resumed.checkpoint.name.startsWith("manual:")) {
    return { session: resumed };
  }

  return {
    session: {
      ...resumed,
      phase: "navigating_to_search",
      checkpoint: {
        name: `resume:linkedin-search:${resumed.discovery.pageIndex}`,
        attempt: 1,
        updatedAt: now,
      },
    },
    navigateUrl: resumed.discovery.searchUrl,
  };
}

/**
 * Decide whether background startup should repair the page-observer transport
 * for the exact stored executor tab.
 *
 * Reloading an unpacked extension invalidates content scripts that were
 * already injected into open pages. A running campaign always needs its
 * observer restored. A campaign paused specifically because page automation
 * could not be verified needs the same repair; otherwise it remains stranded
 * even after the helper itself has been reloaded. Do not refresh deliberate
 * user pauses, unanswered questions, or final review because those surfaces
 * may contain candidate work that must be preserved.
 */
export function shouldRepairExecutorObservation(
  session: ExtensionExecutionSession,
): boolean {
  if (session.state === "running") return true;
  return session.state === "needs_user_input" &&
    session.phase === "awaiting_user" &&
    session.awaitingUserContext === "manual_verification";
}

export function acceptDiscoveryPage(
  session: ExtensionExecutionSession,
  jobs: readonly DiscoveredJobReference[],
  now = new Date().toISOString(),
): {
  session: ExtensionExecutionSession;
  newJobs: DiscoveredJobReference[];
  complete: boolean;
  nextUrl?: string;
} {
  const previousIds = new Set(session.discovery.jobs.map((job) => job.externalId));
  const mergedJobs = mergeDiscoveredJobs(session.discovery.jobs, jobs);
  const newJobs = mergedJobs.filter((job) => !previousIds.has(job.externalId));
  const reachedTarget = mergedJobs.length >= session.discovery.poolTarget;
  const exhaustedPages = session.discovery.pageIndex + 1 >= session.discovery.maxPages;
  const complete = reachedTarget || exhaustedPages;

  if (complete) {
    return {
      session: {
        ...session,
        phase: "discovery_complete",
        discovery: { ...session.discovery, jobs: mergedJobs },
        checkpoint: nextCheckpoint(session, "discovery:linkedin-complete", now),
      },
      newJobs,
      complete: true,
    };
  }

  const pageIndex = session.discovery.pageIndex + 1;
  const nextUrl = nextLinkedInSearchPageUrl(session.executionPlan, pageIndex);
  return {
    session: {
      ...session,
      phase: "navigating_to_search",
      discovery: {
        ...session.discovery,
        jobs: mergedJobs,
        pageIndex,
        searchUrl: nextUrl,
      },
      checkpoint: nextCheckpoint(session, `navigate:linkedin-search:${pageIndex}`, now),
    },
    newJobs,
    complete: false,
    nextUrl,
  };
}

export function isExtensionExecutionSession(value: unknown): value is ExtensionExecutionSession {
  if (!isRecord(value)) return false;
  const checkpoint = value.checkpoint;
  const discovery = value.discovery;
  return (
    value.schemaVersion === 2 &&
    typeof value.runId === "string" &&
    typeof value.claimTicketFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(value.claimTicketFingerprint) &&
    typeof value.executorTabId === "number" &&
    Number.isInteger(value.executorTabId) &&
    value.executorTabId >= 0 &&
    typeof value.executorSessionId === "string" &&
    isBrowserExecutorEventCapability(value.executorEventCapability) &&
    typeof value.controllerOrigin === "string" &&
    isRunState(value.state) &&
    typeof value.phase === "string" &&
    (EXECUTION_PHASES as readonly string[]).includes(value.phase) &&
    (value.awaitingUserContext === undefined ||
      (typeof value.awaitingUserContext === "string" &&
        (AWAITING_USER_CONTEXTS as readonly string[]).includes(value.awaitingUserContext))) &&
    isBrowserRunSummary(value.run) &&
    isBrowserExecutionPlan(value.executionPlan) &&
    value.run.id === value.runId &&
    value.executionPlan.runId === value.runId &&
    value.executorEventCapability.runId === value.runId &&
    value.run.state === value.state &&
    value.run.executorTabId === value.executorTabId &&
    isRecord(discovery) &&
    typeof discovery.searchUrl === "string" &&
    typeof discovery.pageIndex === "number" &&
    Number.isInteger(discovery.pageIndex) &&
    discovery.pageIndex >= 0 &&
    typeof discovery.maxPages === "number" &&
    Number.isInteger(discovery.maxPages) &&
    discovery.maxPages >= 1 &&
    discovery.maxPages <= 8 &&
    discovery.pageIndex < discovery.maxPages &&
    discovery.searchUrl === nextLinkedInSearchPageUrl(
      value.executionPlan,
      discovery.pageIndex,
    ) &&
    typeof discovery.poolTarget === "number" &&
    Number.isInteger(discovery.poolTarget) &&
    discovery.poolTarget === value.executionPlan.poolTarget &&
    Array.isArray(discovery.jobs) &&
    discovery.jobs.every(isDiscoveredJob) &&
    isQualificationState(value.qualification) &&
    qualificationStateIsConsistent(value.qualification, discovery.jobs, value.phase) &&
    (value.profileResumeUploaded === undefined || typeof value.profileResumeUploaded === "boolean") &&
    (value.applicationResume === undefined || isApplicationResumeCheckpoint(value.applicationResume)) &&
    isRecord(checkpoint) &&
    typeof checkpoint.name === "string" &&
    typeof checkpoint.attempt === "number" &&
    Number.isInteger(checkpoint.attempt) &&
    checkpoint.attempt >= 1 &&
    typeof checkpoint.updatedAt === "string" &&
    Array.isArray(value.pendingEventIds) &&
    value.pendingEventIds.every((id) => typeof id === "string")
  );
}

function isApplicationResumeCheckpoint(
  value: unknown,
): value is NonNullable<ExtensionExecutionSession["applicationResume"]> {
  return isRecord(value) &&
    typeof value.jobExternalId === "string" &&
    /^\d+$/.test(value.jobExternalId) &&
    typeof value.fileName === "string" &&
    value.fileName.length >= 5 &&
    value.fileName.length <= 240 &&
    value.fileName.toLowerCase().endsWith(".pdf");
}

/**
 * Earlier helper builds could persist an application-form checkpoint while the
 * `awaitingUserContext` field was still additive. That leaves a structurally
 * valid session in an impossible runtime state: the controller is marked as
 * running, but its phase says it is waiting for a candidate without saying
 * why. Do not broadly "resume" those checkpoints. The one safe automatic
 * repair is a qualified, running session that was already observing an
 * application form: return it to the review-only application controller so
 * the current DOM can be inspected again before any action is taken.
 *
 * Every other incomplete waiting checkpoint is converted to an explicit
 * manual-verification pause. This fails closed rather than guessing what a
 * candidate intended to do on a third-party page.
 */
export function normalizePersistedExecutionSession(
  session: ExtensionExecutionSession,
): ExtensionExecutionSession {
  const qualificationBudget = qualificationInspectionBudget(session.executionPlan);
  const normalized = session.qualification.inspectionBudget >= qualificationBudget
    ? session
    : {
        ...session,
        qualification: {
          ...session.qualification,
          inspectionBudget: qualificationBudget,
        },
      };

  if (normalized.phase !== "awaiting_user" || normalized.awaitingUserContext !== undefined) {
    return normalized;
  }

  if (
    normalized.state === "running" &&
    normalized.qualification.currentJob &&
    isLegacyApplicationFormCheckpoint(normalized.checkpoint.name)
  ) {
    return {
      ...normalized,
      phase: "application_retry",
    };
  }

  return {
    ...normalized,
    state: "needs_user_input",
    run: {
      ...normalized.run,
      state: "needs_user_input",
    },
    awaitingUserContext: "manual_verification",
  };
}

/**
 * Version 1 had no post-discovery controller. Upgrade an otherwise valid
 * checkpoint in place so a harmless extension update never strands an active
 * campaign solely because its local state gained a new, additive field.
 */
export function upgradeLegacyExecutionSession(value: unknown): ExtensionExecutionSession | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const executionPlan = isBrowserExecutionPlan(value.executionPlan)
    ? value.executionPlan
    : null;
  const upgraded: unknown = {
    ...value,
    schemaVersion: 2,
    qualification: {
      inspectionBudget: executionPlan
        ? qualificationInspectionBudget(executionPlan)
        : 1,
      inspectedExternalIds: [],
    },
  };
  return isExtensionExecutionSession(upgraded) ? upgraded : null;
}

function isQualificationState(value: unknown): value is ExtensionExecutionSession["qualification"] {
  if (!isRecord(value)) return false;
  return (
    typeof value.inspectionBudget === "number" &&
    Number.isInteger(value.inspectionBudget) &&
    value.inspectionBudget >= 1 &&
    value.inspectionBudget <= 120 &&
    Array.isArray(value.inspectedExternalIds) &&
    value.inspectedExternalIds.every((externalId) =>
      typeof externalId === "string" && /^\d+$/.test(externalId)) &&
    new Set(value.inspectedExternalIds).size === value.inspectedExternalIds.length &&
    (value.currentJob === undefined || isDiscoveredJob(value.currentJob))
  );
}

function qualificationInspectionBudget(plan: BrowserExecutionPlan): number {
  return Math.max(1, Math.min(plan.poolTarget, MAX_QUALIFICATION_INSPECTION_BUDGET));
}

function qualificationStateIsConsistent(
  qualification: ExtensionExecutionSession["qualification"],
  discoveredJobs: unknown[],
  phase: string,
): boolean {
  const currentJob = qualification.currentJob;
  const requiresCurrentJob = [
    "navigating_to_job",
    "qualifying_job",
    "qualification_complete",
    "processing_application",
    "application_retry",
  ]
    .includes(phase);

  if (requiresCurrentJob && !currentJob && phase !== "qualification_complete") return false;
  if (!currentJob) return true;
  if (qualification.inspectedExternalIds.length > qualification.inspectionBudget) return false;

  return discoveredJobs.some((job) =>
    isDiscoveredJob(job) && job.externalId === currentJob.externalId && job.url === currentJob.url);
}

function firstMatchingExcludedTerm(
  session: ExtensionExecutionSession,
  observation: AdapterObservation,
): string | null {
  const haystack = [
    observation.job?.title,
    observation.job?.company,
    observation.job?.location,
  ].filter((value): value is string => Boolean(value))
    .join(" ")
    .toLocaleLowerCase();

  return session.executionPlan.preferences.excludedTerms
    .map((term) => term.trim())
    .find((term) => term.length > 0 && haystack.includes(term.toLocaleLowerCase())) ?? null;
}

function nextCheckpoint(
  session: ExtensionExecutionSession,
  name: string,
  updatedAt: string,
): ExtensionExecutionSession["checkpoint"] {
  return {
    name,
    attempt: session.checkpoint.name === name ? session.checkpoint.attempt + 1 : 1,
    updatedAt,
  };
}

function isLegacyApplicationFormCheckpoint(name: string): boolean {
  return name.startsWith("application:") || name.includes(":application_form:");
}

function isDiscoveredJob(value: unknown): value is DiscoveredJobReference {
  if (
    !isRecord(value) ||
    typeof value.externalId !== "string" ||
    !/^\d+$/.test(value.externalId) ||
    typeof value.url !== "string" ||
    ![value.title, value.company, value.location]
      .every((field) => field === undefined || typeof field === "string")
  ) return false;

  try {
    const url = new URL(value.url);
    return (
      url.protocol === "https:" &&
      url.hostname === "www.linkedin.com" &&
      url.pathname === `/jobs/view/${value.externalId}/`
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
