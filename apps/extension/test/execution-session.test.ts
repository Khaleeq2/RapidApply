import type {
  BrowserExecutionPlan,
  BrowserRunSummary,
  ExtensionExecutionSession,
} from "@rapidapply/contracts";
import type { AdapterObservation } from "../src/adapters/types";
import {
  acceptDiscoveryPage,
  beginJobQualification,
  beginSearchNavigation,
  completeJobQualification,
  createExecutionSession,
  isExpectedLinkedInJobUrl,
  isAwaitingLinkedInSubmissionConfirmation,
  isExtensionExecutionSession,
  normalizePersistedExecutionSession,
  ownsExecutorTab,
  qualifyLinkedInJobObservation,
  rebindExecutionSession,
  resumeExecutionSession,
  shouldRepairExecutorObservation,
  shouldRecoverLinkedInEasyApplyOpening,
  shouldReopenLinkedInApplicationRetry,
  upgradeLegacyExecutionSession,
} from "../src/execution/session";
import {
  clearExecutionSession,
  getExecutionSession,
  saveExecutionSession,
} from "../src/background/session-store";
import {
  appendRecordingEntry,
  getExecutionRecording,
} from "../src/background/recording-store";

const run: BrowserRunSummary = {
  id: "8fc331d6-5712-4fd1-836a-a3b8e5dc1a9d",
  campaignId: "cf3fdb89-86af-4167-9a6e-5d28dce966d6",
  state: "claimed",
  targetRole: "Product Designer",
  targetLocation: "Remote",
  boardIds: ["linkedin"],
  targetApplications: 5,
  appliedCount: 0,
  skippedCount: 0,
  executorTabId: 42,
  startedAt: null,
  completedAt: null,
  createdAt: "2026-07-21T12:00:00.000Z",
  updatedAt: "2026-07-21T12:00:00.000Z",
};

const plan: BrowserExecutionPlan = {
  runId: run.id,
  adapterId: "linkedin",
  targetRole: run.targetRole,
  targetLocation: run.targetLocation,
  targetApplications: 5,
  poolTarget: 6,
  preferences: {
    experience: "senior",
    workStyle: "remote",
    onlyEasyApply: true,
    excludedTerms: [],
  },
};

describe("durable execution session", () => {
  let storage = new Map<string, unknown>();

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          async set(values: Record<string, unknown>) {
            for (const [key, value] of Object.entries(values)) storage.set(key, value);
          },
          async get(key: string) {
            return { [key]: storage.get(key) };
          },
          async remove(key: string) {
            storage.delete(key);
          },
        },
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("binds the run to one exact executor tab", () => {
    const session = makeSession();
    expect(ownsExecutorTab(session, 42)).toBe(true);
    expect(ownsExecutorTab(session, 43)).toBe(false);
  });

  it("recovers Easy Apply after qualification completes but the scheduled opener is lost", () => {
    const qualified = {
      ...makeSession(),
      state: "running" as const,
      phase: "qualification_complete" as const,
      qualification: {
        ...makeSession().qualification,
        currentJob: job("10001"),
      },
    };
    const observation = jobDetailObservation("10001");

    expect(shouldRecoverLinkedInEasyApplyOpening(
      qualified,
      observation,
      "https://www.linkedin.com/jobs/view/10001/",
    )).toBe(true);
    expect(shouldRecoverLinkedInEasyApplyOpening(
      qualified,
      { ...observation, actions: [] },
      "https://www.linkedin.com/jobs/view/10001/",
    )).toBe(false);
    expect(shouldRecoverLinkedInEasyApplyOpening(
      qualified,
      jobDetailObservation("10002"),
      "https://www.linkedin.com/jobs/view/10002/",
    )).toBe(false);
  });

  it("accepts confirmation only for the actively processing current submission", () => {
    const processing = {
      ...makeSession(),
      state: "running" as const,
      phase: "processing_application" as const,
      qualification: {
        ...makeSession().qualification,
        currentJob: job("10001"),
      },
    };

    expect(isAwaitingLinkedInSubmissionConfirmation(processing, confirmationObservation("10001"))).toBe(true);
    expect(isAwaitingLinkedInSubmissionConfirmation(processing, confirmationObservation("10002"))).toBe(false);
    expect(isAwaitingLinkedInSubmissionConfirmation(
      { ...processing, phase: "navigating_to_job" },
      confirmationObservation("10001"),
    )).toBe(false);
  });

  it("preserves discovery and qualification progress across a same-run rebind", () => {
    const previous = completeJobQualification(
      withDiscoveredJobs(makeSession(), [job("10001"), job("10002")]),
      { status: "qualified", job: job("10001"), reason: "fixture" },
      "2026-07-21T12:02:00.000Z",
    );
    const rebound = rebindExecutionSession({
      previous,
      run: { ...run, state: "running", executorTabId: 99 },
      executionPlan: { ...plan, submissionMode: "test_submit" },
      executorEventCapability: {
        runId: run.id,
        token: "c".repeat(64),
        expiresAt: "2026-07-22T12:30:00.000Z",
      },
      claimTicketFingerprint: "d".repeat(64),
      executorTabId: 99,
      executorSessionId: "85108b47-2a67-4059-9425-cf8bf7d4ec0b",
      now: "2026-07-21T12:03:00.000Z",
    });

    expect(rebound.discovery.jobs.map(({ externalId }) => externalId)).toEqual(["10001", "10002"]);
    expect(rebound.qualification.inspectedExternalIds).toEqual(["10001"]);
    expect(rebound.executorTabId).toBe(99);
    expect(rebound.executorSessionId).toBe("85108b47-2a67-4059-9425-cf8bf7d4ec0b");
    expect(rebound.phase).toBe("qualification_complete");
    expect(rebound.executionPlan.submissionMode).toBe("test_submit");
    expect(rebound.checkpoint.updatedAt).toBe("2026-07-21T12:03:00.000Z");
  });

  it("round-trips a validated checkpoint through extension-local storage", async () => {
    const navigating = beginSearchNavigation(makeSession(), "2026-07-21T12:01:00.000Z");
    await saveExecutionSession(navigating);

    const restored = await getExecutionSession();
    expect(restored).toEqual(navigating);
    expect(restored?.phase).toBe("navigating_to_search");

    await clearExecutionSession();
    await expect(getExecutionSession()).resolves.toBeNull();
  });

  it("recovers a legacy running application checkpoint by safely re-observing the form", async () => {
    const legacy = {
      ...withDiscoveredJobs(makeSession(), [job("10001")]),
      state: "running" as const,
      run: { ...run, state: "running" as const },
      phase: "awaiting_user" as const,
      qualification: {
        inspectionBudget: 1,
        inspectedExternalIds: ["10001"],
        currentJob: job("10001"),
      },
      checkpoint: {
        name: "legacy-session:linkedin:application_form:deadbeef",
        attempt: 2,
        updatedAt: "2026-07-21T12:04:00.000Z",
      },
    };

    expect(isExtensionExecutionSession(legacy)).toBe(true);
    await chrome.storage.local.set({ "rapidapply.execution-session": legacy });

    const restored = await getExecutionSession();

    expect(restored).toMatchObject({
      state: "running",
      phase: "application_retry",
      checkpoint: legacy.checkpoint,
    });
    expect(restored?.awaitingUserContext).toBeUndefined();
    expect(storage.get("rapidapply.execution-session")).toMatchObject({
      state: "running",
      phase: "application_retry",
    });
  });

  it("resumes a qualification pause from the persisted discovery search", () => {
    const paused = {
      ...withDiscoveredJobs(makeSession(), [job("10001"), job("10002")]),
      state: "needs_user_input" as const,
      run: { ...run, state: "needs_user_input" as const },
      phase: "awaiting_user" as const,
      awaitingUserContext: "qualification" as const,
      checkpoint: {
        name: "qualification:needs_user_input:10001",
        attempt: 1,
        updatedAt: "2026-07-21T12:04:00.000Z",
      },
    };

    const resumed = resumeExecutionSession(
      paused,
      { ...run, state: "running" as const },
      "2026-07-21T12:05:00.000Z",
    );

    expect(resumed.blockedReason).toBeUndefined();
    expect(resumed.navigateUrl).toBe(paused.discovery.searchUrl);
    expect(resumed.session).toMatchObject({
      state: "running",
      phase: "navigating_to_search",
      checkpoint: {
        name: `resume:linkedin-search:${paused.discovery.pageIndex}`,
      },
    });
  });

  it("repairs an invalidated observer for running and transport-blocked sessions only", () => {
    const running = {
      ...makeSession(),
      state: "running" as const,
      run: { ...run, state: "running" as const },
    };
    const transportBlocked = {
      ...running,
      state: "needs_user_input" as const,
      run: { ...run, state: "needs_user_input" as const },
      phase: "awaiting_user" as const,
      awaitingUserContext: "manual_verification" as const,
    };
    const finalReview = {
      ...transportBlocked,
      awaitingUserContext: "final_review" as const,
    };
    const deliberatelyPaused = {
      ...running,
      state: "paused" as const,
      run: { ...run, state: "paused" as const },
    };

    expect(shouldRepairExecutorObservation(running)).toBe(true);
    expect(shouldRepairExecutorObservation(transportBlocked)).toBe(true);
    expect(shouldRepairExecutorObservation(finalReview)).toBe(false);
    expect(shouldRepairExecutorObservation(deliberatelyPaused)).toBe(false);
  });

  it("re-opens only the exact qualified job when a recovered application retry is back on its detail page", () => {
    const retry = {
      ...withDiscoveredJobs(makeSession(), [job("10001")]),
      state: "running" as const,
      run: { ...run, state: "running" as const },
      phase: "application_retry" as const,
      qualification: {
        inspectionBudget: 1,
        inspectedExternalIds: ["10001"],
        currentJob: job("10001"),
      },
    };

    expect(shouldReopenLinkedInApplicationRetry(
      retry,
      jobDetailObservation("10001"),
      "https://www.linkedin.com/jobs/view/10001/?trackingId=fixture",
    )).toBe(true);
    expect(shouldReopenLinkedInApplicationRetry(
      retry,
      jobDetailObservation("10002"),
      "https://www.linkedin.com/jobs/view/10002/",
    )).toBe(false);
    expect(shouldReopenLinkedInApplicationRetry(
      retry,
      { ...jobDetailObservation("10001"), pageType: "application_form" },
      "https://www.linkedin.com/jobs/view/10001/",
    )).toBe(false);
  });

  it("fails closed when an incomplete legacy waiting checkpoint cannot be tied to a form", () => {
    const legacy = {
      ...makeSession(),
      state: "running" as const,
      run: { ...run, state: "running" as const },
      phase: "awaiting_user" as const,
      checkpoint: {
        name: "legacy-session:linkedin:unsupported:deadbeef",
        attempt: 1,
        updatedAt: "2026-07-21T12:04:00.000Z",
      },
    };

    const normalized = normalizePersistedExecutionSession(legacy);

    expect(normalized).toMatchObject({
      state: "needs_user_input",
      phase: "awaiting_user",
      awaitingUserContext: "manual_verification",
      run: { state: "needs_user_input" },
    });
  });

  it("rejects and removes a malformed checkpoint instead of attempting recovery", async () => {
    storage.set("rapidapply.execution-session", { runId: run.id, executorTabId: 42 });
    await expect(getExecutionSession()).resolves.toBeNull();
    expect(storage.has("rapidapply.execution-session")).toBe(false);
  });

  it("deduplicates replayed jobs and advances pages until the buffered pool is met", () => {
    const firstPage = acceptDiscoveryPage(makeSession(), [job("10001"), job("10002")]);
    expect(firstPage.complete).toBe(false);
    expect(firstPage.session.discovery.pageIndex).toBe(1);
    expect(firstPage.nextUrl).toContain("start=25");

    const secondPage = acceptDiscoveryPage(firstPage.session, [
      job("10002"),
      job("10003"),
      job("10004"),
      job("10005"),
      job("10006"),
    ]);
    expect(secondPage.complete).toBe(true);
    expect(secondPage.newJobs).toHaveLength(4);
    expect(secondPage.session.discovery.jobs).toHaveLength(6);
    expect(secondPage.session.phase).toBe("discovery_complete");
  });

  it("validates the complete serialized schema", () => {
    expect(isExtensionExecutionSession(makeSession())).toBe(true);
    expect(isExtensionExecutionSession({
      ...makeSession(),
      awaitingUserContext: "resume_selection",
    })).toBe(true);
    expect(isExtensionExecutionSession({
      ...makeSession(),
      applicationResume: {
        jobExternalId: "10001",
        fileName: "Taylor_Rivera_Product_Designer_Resume_v2.pdf",
      },
    })).toBe(true);
    expect(isExtensionExecutionSession({
      ...makeSession(),
      applicationResume: {
        jobExternalId: "10001",
        fileName: "not-a-pdf.txt",
      },
    })).toBe(false);
    expect(isExtensionExecutionSession({
      ...makeSession(),
      awaitingUserContext: "untrusted-page-text",
    })).toBe(false);
    expect(isExtensionExecutionSession({ ...makeSession(), claimTicketFingerprint: "bad" }))
      .toBe(false);
    expect(isExtensionExecutionSession({
      ...makeSession(),
      qualification: {
        ...makeSession().qualification,
        currentJob: job("99999"),
      },
    })).toBe(false);
  });

  it("upgrades an additive version-one checkpoint without losing its execution binding", () => {
    const legacy = { ...makeSession(), schemaVersion: 1 } as Record<string, unknown>;
    delete legacy.qualification;

    const upgraded = upgradeLegacyExecutionSession(legacy);

    expect(upgraded).toMatchObject({
      schemaVersion: 2,
      runId: run.id,
      executorTabId: 42,
      qualification: {
        inspectionBudget: plan.poolTarget,
        inspectedExternalIds: [],
      },
    });
  });

  it("selects one canonical discovered job for a bounded qualification checkpoint", () => {
    const session = withDiscoveredJobs(makeSession(), [job("10001"), job("10002")]);
    const selected = beginJobQualification(session, "2026-07-21T12:02:00.000Z");

    expect(selected.job).toEqual(job("10001"));
    expect(selected.session.phase).toBe("navigating_to_job");
    expect(selected.session.qualification.currentJob).toEqual(job("10001"));
    expect(selected.session.checkpoint.name).toBe("navigate:linkedin-job:10001");
    expect(isExpectedLinkedInJobUrl(
      selected.session,
      "https://www.linkedin.com/jobs/view/10001/?trackingId=fixture",
    )).toBe(true);
    expect(isExpectedLinkedInJobUrl(
      selected.session,
      "https://www.linkedin.com/jobs/view/10002/",
    )).toBe(false);
  });

  it("qualifies only the exact selected job when Easy Apply is visibly enabled", () => {
    const selected = beginJobQualification(
      withDiscoveredJobs(makeSession(), [job("10001")]),
    );
    const result = qualifyLinkedInJobObservation(
      selected.session,
      jobDetailObservation("10001"),
    );
    const completed = completeJobQualification(
      selected.session,
      result,
      "2026-07-21T12:02:00.000Z",
    );

    expect(result).toMatchObject({
      status: "qualified",
      job: { externalId: "10001" },
    });
    expect(completed.phase).toBe("qualification_complete");
    expect(completed.qualification.inspectedExternalIds).toEqual(["10001"]);
    expect(completed.checkpoint.name).toBe("qualification:qualified:10001");
  });

  it("skips a selected listing when it matches an explicit exclusion or lacks Easy Apply", () => {
    const excludedSession = withDiscoveredJobs(makeSession(), [job("10001", "Fixture Labs")]);
    excludedSession.executionPlan = {
      ...excludedSession.executionPlan,
      preferences: {
        ...excludedSession.executionPlan.preferences,
        excludedTerms: ["fixture labs"],
      },
    };
    const selectedExcluded = beginJobQualification(excludedSession);
    const excluded = qualifyLinkedInJobObservation(
      selectedExcluded.session,
      jobDetailObservation("10001", { company: "Fixture Labs" }),
    );

    const noEasyApply = qualifyLinkedInJobObservation(
      beginJobQualification(withDiscoveredJobs(makeSession(), [job("10002")])).session,
      jobDetailObservation("10002", {}, []),
    );

    expect(excluded).toMatchObject({ status: "skipped" });
    expect(excluded.reason).toContain("fixture labs");
    expect(noEasyApply).toMatchObject({ status: "skipped" });
    expect(noEasyApply.reason).toContain("enabled Easy Apply");
  });

  it("advances to the next discovered listing after a qualification skip", () => {
    const selected = beginJobQualification(
      withDiscoveredJobs(makeSession(), [job("10001"), job("10002")]),
    );
    const skipped = qualifyLinkedInJobObservation(
      selected.session,
      jobDetailObservation("10001", {}, []),
    );
    const completed = completeJobQualification(selected.session, skipped);
    const next = beginJobQualification(completed);

    expect(skipped.status).toBe("skipped");
    expect(next.job).toEqual(job("10002"));
    expect(next.session.phase).toBe("navigating_to_job");
    expect(next.session.qualification.inspectedExternalIds).toEqual(["10001"]);
  });

  it("fails closed when the observed LinkedIn job does not match the saved job", () => {
    const selected = beginJobQualification(
      withDiscoveredJobs(makeSession(), [job("10001")]),
    );
    const result = qualifyLinkedInJobObservation(
      selected.session,
      jobDetailObservation("99999"),
    );

    expect(result).toMatchObject({ status: "needs_user_input" });
    expect(result.reason).toContain("could not verify");
  });

  it("records identical search fingerprints separately for each controller page", async () => {
    const baseEntry = {
      runId: run.id,
      executorSessionId: "75108b47-2a67-4059-9425-cf8bf7d4ec0b",
      tabId: 42,
      capturedAt: "2026-07-21T12:00:00.000Z",
      observation: {
        adapterId: "linkedin",
        adapterVersion: "observer-1",
        observedAt: "2026-07-21T12:00:00.000Z",
        pageType: "search_results" as const,
        path: "/jobs/search/",
        queryKeys: ["start"],
        title: "Product Designer jobs",
        fingerprint: "deadbeef",
        fields: [],
        actions: [],
        validationMessages: [],
      },
    };

    const first = await appendRecordingEntry({
      ...baseEntry,
      checkpointName: "session:linkedin:search_results:0:deadbeef",
    });
    const second = await appendRecordingEntry({
      ...baseEntry,
      checkpointName: "session:linkedin:search_results:1:deadbeef",
    });
    const replay = await appendRecordingEntry({
      ...baseEntry,
      checkpointName: "session:linkedin:search_results:1:deadbeef",
    });

    expect(first.appended).toBe(true);
    expect(second.appended).toBe(true);
    expect(replay.appended).toBe(false);
    expect((await getExecutionRecording(run.id))?.entries).toHaveLength(2);

    expect((await getExecutionRecording(run.id))?.entries[1]).not.toHaveProperty("screenshot");
  });

  it("resumes a manual-authentication checkpoint at the saved search page", () => {
    const session = {
      ...makeSession(),
      state: "needs_user_input" as const,
      phase: "awaiting_user" as const,
      run: { ...run, state: "needs_user_input" as const },
      checkpoint: {
        name: "manual:login_required:deadbeef",
        attempt: 1,
        updatedAt: "2026-07-21T12:02:00.000Z",
      },
    };
    const runningRun = { ...run, state: "running" as const };

    const resumed = resumeExecutionSession(
      session,
      runningRun,
      "2026-07-21T12:03:00.000Z",
    );

    expect(resumed.session.state).toBe("running");
    expect(resumed.session.phase).toBe("navigating_to_search");
    expect(resumed.navigateUrl).toBe(session.discovery.searchUrl);
    expect(resumed.session.checkpoint.name).toBe("resume:linkedin-search:0");
  });

  it("re-enters application control when an application retry checkpoint is resumed", () => {
    const session = {
      ...withDiscoveredJobs(makeSession(), [job("10001")]),
      state: "needs_user_input" as const,
      phase: "awaiting_user" as const,
      awaitingUserContext: "manual_verification" as const,
      run: { ...run, state: "needs_user_input" as const },
      qualification: {
        inspectionBudget: 1,
        inspectedExternalIds: ["10001"],
        currentJob: job("10001"),
      },
      checkpoint: {
        name: "application:reopen:10001:deadbeef",
        attempt: 1,
        updatedAt: "2026-07-21T12:02:00.000Z",
      },
    };

    const resumed = resumeExecutionSession(
      session,
      { ...run, state: "running" as const },
      "2026-07-21T12:03:00.000Z",
    );

    expect(resumed.navigateUrl).toBeUndefined();
    expect(resumed.session).toMatchObject({
      state: "running",
      phase: "application_retry",
      awaitingUserContext: undefined,
      checkpoint: {
        name: "resume:linkedin-application:10001",
        attempt: 1,
      },
    });
  });

  it("re-enters discovery when a completed qualification checkpoint is resumed", () => {
    const session = {
      ...withDiscoveredJobs(makeSession(), [job("10001")]),
      state: "needs_user_input" as const,
      phase: "awaiting_user" as const,
      run: { ...run, state: "needs_user_input" as const },
      qualification: {
        inspectionBudget: 1,
        inspectedExternalIds: ["10001"],
        currentJob: job("10001"),
      },
      checkpoint: {
        name: "qualification:qualified:10001",
        attempt: 1,
        updatedAt: "2026-07-21T12:02:00.000Z",
      },
    };
    const runningRun = { ...run, state: "running" as const };

    const resumed = resumeExecutionSession(session, runningRun);

    expect(resumed.blockedReason).toBeUndefined();
    expect(resumed.navigateUrl).toBe(session.discovery.searchUrl);
    expect(resumed.session.phase).toBe("navigating_to_search");
    expect(resumed.session.checkpoint.name).toBe("resume:linkedin-search:0");
  });
});

function makeSession(): ExtensionExecutionSession {
  return createExecutionSession({
    run,
    executionPlan: plan,
    executorEventCapability: {
      runId: run.id,
      token: "a".repeat(64),
      expiresAt: "2026-07-22T12:00:00.000Z",
    },
    claimTicketFingerprint: "b".repeat(64),
    executorTabId: 42,
    executorSessionId: "75108b47-2a67-4059-9425-cf8bf7d4ec0b",
    controllerOrigin: "http://localhost:3000",
    now: "2026-07-21T12:00:00.000Z",
  });
}

function job(externalId: string, company?: string) {
  return {
    externalId,
    url: `https://www.linkedin.com/jobs/view/${externalId}/`,
    title: `Fixture role ${externalId}`,
    ...(company ? { company } : {}),
  };
}

function withDiscoveredJobs(
  session: ExtensionExecutionSession,
  jobs: ReturnType<typeof job>[],
): ExtensionExecutionSession {
  return {
    ...session,
    phase: "discovery_complete",
    discovery: {
      ...session.discovery,
      jobs,
    },
  };
}

function jobDetailObservation(
  externalId: string,
  job: Partial<NonNullable<AdapterObservation["job"]>> = {},
  actions: AdapterObservation["actions"] = [{
    key: "easyapply",
    name: "Easy Apply",
    kind: "open_application",
    disabled: false,
  }],
): AdapterObservation {
  return {
    adapterId: "linkedin",
    adapterVersion: "observer-1",
    observedAt: "2026-07-21T12:00:00.000Z",
    pageType: "job_detail",
    path: `/jobs/view/${externalId}/`,
    queryKeys: [],
    title: "Fixture role",
    fingerprint: "deadbeef",
    job: {
      externalId,
      title: "Fixture role",
      company: "Fixture company",
      location: "Remote",
      ...job,
    },
    fields: [],
    actions,
    validationMessages: [],
  };
}

function confirmationObservation(externalId: string): AdapterObservation {
  return {
    ...jobDetailObservation(externalId, {}, []),
    pageType: "application_confirmation",
    actions: [],
    fingerprint: "cafebabe",
  };
}
