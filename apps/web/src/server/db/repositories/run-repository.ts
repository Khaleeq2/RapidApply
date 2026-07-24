import {
  RUN_STATES,
  type BrowserExecutionPlan,
  type BrowserExecutionTicket,
  type BrowserExecutorEventCapability,
  type BrowserRunSummary,
  type RunEventType,
  type RunState,
} from "@rapidapply/contracts";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { CurrentUser } from "../../auth/current-user";
import type {
  AppendRunEventInput,
  ClaimExecutorInput,
  CreateRunInput,
  ExecutorRunEventInput,
  ExecutorStatusInput,
} from "../../http/run-schemas";
import {
  executionTicketMatches,
  hasExecutionTicketExpired,
  hashExecutionTicket,
  issueExecutorEventCapability,
  issueExecutionTicket,
} from "../../execution/tickets";
import { parseAutonomyPolicy } from "../../execution/autonomy-policy";
import { db } from "../client";
import { applications, applicationRuns, campaigns, deferredJobs, jobListings, runEvents, users } from "../schema";
import type { DeferExecutorJobInput } from "../../http/run-schemas";

type EventDetail = Record<string, string | number | boolean | null>;
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ACTIVE_EXECUTION_STATES = [
  "ready",
  "claimed",
  "running",
  "paused",
  "needs_user_input",
] as const satisfies readonly RunState[];

interface RunRow {
  id: string;
  campaignId: string;
  userId: string;
  state: string;
  targetApplications: number;
  appliedCount: number;
  skippedCount: number;
  executorTabId: number | null;
  executionTicketHash: string | null;
  executionTicketExpiresAt: string | null;
  executorSessionId: string | null;
  executorEventTokenHash: string | null;
  executorEventTokenExpiresAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  targetRole: string;
  targetLocation: string;
  boardIdsJson: string;
  configurationJson: string;
  autonomyPolicyJson?: string;
}

export type RunSummary = BrowserRunSummary;

export interface ClaimedExecutionSession {
  run: RunSummary;
  executorEventCapability: BrowserExecutorEventCapability;
  executionPlan: BrowserExecutionPlan;
}

export interface PrepareExecutionTicketOptions {
  recover?: boolean;
}

export interface RunEventRecord {
  id: string;
  runId: string;
  type: RunEventType;
  idempotencyKey: string;
  detail: EventDetail | null;
  occurredAt: string;
}

export interface AuthorizedExecutorRunContext {
  userId: string;
  targetRole: string;
  targetLocation: string;
  run: RunSummary;
}

export class RunNotFoundError extends Error {
  constructor() {
    super("The requested application run does not exist.");
    this.name = "RunNotFoundError";
  }
}

export class InvalidRunTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRunTransitionError";
  }
}

export class ExecutionTicketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionTicketError";
  }
}

export class ExecutorEventCapabilityError extends Error {
  constructor() {
    super("The browser execution session is invalid or has expired.");
    this.name = "ExecutorEventCapabilityError";
  }
}

export async function createApplicationRun(
  user: CurrentUser,
  input: CreateRunInput,
): Promise<RunSummary> {
  const now = new Date().toISOString();
  const campaignId = crypto.randomUUID();
  const runId = crypto.randomUUID();

  await db.transaction(async (transaction) => {
    await transaction
      .insert(users)
      .values({
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: user.email,
          name: user.name ?? null,
          updatedAt: now,
        },
      });

    // One browser helper tab has one durable owner. Retire older active runs
    // before inserting the replacement so a user can start a new campaign
    // without needing to manually clear an abandoned paused/checkpointed run.
    await supersedeActiveRunsForNewCampaign(transaction, user.id, runId, now);

    const slug = input.targetRole.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const autonomyPolicy = input.autonomyPolicy ?? {
      mode: "autonomous",
      freeTextStrategy: input.configuration.aiTailor ? "ai_draft" : "profile_only",
      unknownFieldStrategy: "defer_to_finish_later",
      aiConfidenceThreshold: 0.75,
      maxThroughput: { dailyCap: input.configuration.dailyLimit, hourlyCap: 5 },
    };

    await transaction.insert(campaigns).values({
      id: campaignId,
      userId: user.id,
      name: `${input.targetRole} — ${input.targetLocation}`,
      slug,
      targetRole: input.targetRole,
      targetLocation: input.targetLocation,
      boardIdsJson: JSON.stringify(input.boardIds),
      configurationJson: JSON.stringify(input.configuration),
      autonomyPolicyJson: JSON.stringify(autonomyPolicy),
      dailyCap: autonomyPolicy.maxThroughput.dailyCap,
      hourlyCap: autonomyPolicy.maxThroughput.hourlyCap,
      createdAt: now,
      updatedAt: now,
    });

    await transaction.insert(applicationRuns).values({
      id: runId,
      campaignId,
      userId: user.id,
      state: "ready",
      targetApplications: input.targetApplications,
      appliedCount: 0,
      skippedCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    await transaction.insert(runEvents).values({
      id: crypto.randomUUID(),
      runId,
      type: "run_created",
      idempotencyKey: `run:${runId}:created`,
      detailJson: JSON.stringify({ source: "web" }),
      occurredAt: now,
      createdAt: now,
    });
  });

  return {
    id: runId,
    campaignId,
    state: "ready",
    targetRole: input.targetRole,
    targetLocation: input.targetLocation,
    boardIds: input.boardIds,
    targetApplications: input.targetApplications,
    appliedCount: 0,
    skippedCount: 0,
    executorTabId: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function supersedeActiveRunsForNewCampaign(
  transaction: DatabaseTransaction,
  userId: string,
  replacementRunId: string,
  now: string,
): Promise<void> {
  const activeRuns = await transaction
    .select({ id: applicationRuns.id })
    .from(applicationRuns)
    .where(and(
      eq(applicationRuns.userId, userId),
      inArray(applicationRuns.state, ACTIVE_EXECUTION_STATES),
    ));

  for (const activeRun of activeRuns) {
    await transaction.insert(runEvents).values({
      id: crypto.randomUUID(),
      runId: activeRun.id,
      type: "run_cancelled",
      idempotencyKey: `run:${activeRun.id}:superseded:${replacementRunId}`,
      detailJson: JSON.stringify({
        source: "web",
        reason: "superseded_by_new_campaign",
        replacementRunId,
      }),
      occurredAt: now,
      createdAt: now,
    });

    await transaction
      .update(applicationRuns)
      .set({
        state: "cancelled",
        executionTicketHash: null,
        executionTicketExpiresAt: null,
        executorSessionId: null,
        executorTabId: null,
        executorEventTokenHash: null,
        executorEventTokenExpiresAt: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(applicationRuns.id, activeRun.id));
  }
}

export async function prepareExecutionTicket(
  userId: string,
  runId: string,
  options: PrepareExecutionTicketOptions = {},
): Promise<{ run: RunSummary; executionTicket: BrowserExecutionTicket }> {
  const nowDate = new Date();
  const now = nowDate.toISOString();

  return db.transaction(async (transaction) => {
    const [row] = await transaction
      .select(runSelection)
      .from(applicationRuns)
      .innerJoin(campaigns, eq(applicationRuns.campaignId, campaigns.id))
      .where(and(eq(applicationRuns.id, runId), eq(applicationRuns.userId, userId)))
      .limit(1);

    if (!row) throw new RunNotFoundError();

    let run = toRunSummary(row);
    if (run.state !== "ready") {
      const recoverable = ["claimed", "running", "paused", "needs_user_input"].includes(run.state);
      if (!options.recover || !recoverable) {
        throw new InvalidRunTransitionError(
          recoverable
            ? "This campaign already has an executor. Explicitly reconnect it to replace that session."
            : "Only a ready campaign can be prepared for the browser helper.",
        );
      }

      await transaction.insert(runEvents).values({
        id: crypto.randomUUID(),
        runId: run.id,
        type: "executor_recovery_prepared",
        idempotencyKey: `executor-recovery:${run.id}:${crypto.randomUUID()}`,
        detailJson: JSON.stringify({ previousState: run.state }),
        occurredAt: now,
        createdAt: now,
      });

      run = { ...run, state: "ready", executorTabId: null, updatedAt: now };
    }

    const executionTicket = issueExecutionTicket(run.id, nowDate);
    await transaction
      .update(applicationRuns)
      .set({
        executionTicketHash: hashExecutionTicket(executionTicket.token),
        executionTicketExpiresAt: executionTicket.expiresAt,
        executorSessionId: null,
        executorTabId: null,
        executorEventTokenHash: null,
        executorEventTokenExpiresAt: null,
        state: "ready",
        updatedAt: now,
      })
      .where(eq(applicationRuns.id, run.id));

    return {
      run,
      executionTicket,
    };
  });
}

export async function claimExecutionTicket(
  input: ClaimExecutorInput,
): Promise<ClaimedExecutionSession> {
  return db.transaction(async (transaction) => {
    const [row] = await transaction
      .select(runSelection)
      .from(applicationRuns)
      .innerJoin(campaigns, eq(applicationRuns.campaignId, campaigns.id))
      .where(eq(applicationRuns.id, input.runId))
      .limit(1);

    // A capability endpoint must not reveal whether a run ID exists.
    if (!row || !row.executionTicketHash || !row.executionTicketExpiresAt) {
      throw new ExecutionTicketError("The browser handoff is invalid or has already been used.");
    }

    if (!executionTicketMatches(input.executionTicket, row.executionTicketHash)) {
      throw new ExecutionTicketError("The browser handoff is invalid or has already been used.");
    }

    if (hasExecutionTicketExpired(row.executionTicketExpiresAt)) {
      throw new ExecutionTicketError("The browser handoff has expired. Return to RapidApply and prepare it again.");
    }

    const run = toRunSummary(row);
    if (run.state !== "ready") {
      throw new InvalidRunTransitionError("This campaign is no longer available for browser preparation.");
    }

    const nowDate = new Date();
    const now = nowDate.toISOString();
    const executorEventCapability = issueExecutorEventCapability(run.id, nowDate);
    await transaction
      .update(applicationRuns)
      .set({
        state: "claimed",
        executorTabId: input.executorTabId,
        executorSessionId: input.executorSessionId,
        executionTicketHash: null,
        executionTicketExpiresAt: null,
        executorEventTokenHash: hashExecutionTicket(executorEventCapability.token),
        executorEventTokenExpiresAt: executorEventCapability.expiresAt,
        updatedAt: now,
      })
      .where(eq(applicationRuns.id, run.id));

    await transaction.insert(runEvents).values({
      id: crypto.randomUUID(),
      runId: run.id,
      type: "executor_claimed",
      idempotencyKey: `executor-claim:${run.id}:${input.executorSessionId}`,
      detailJson: JSON.stringify({
        executorTabId: input.executorTabId,
        executorSessionId: input.executorSessionId,
        extensionVersion: input.extensionVersion,
      }),
      occurredAt: now,
      createdAt: now,
    });

    return {
      run: {
        ...run,
        state: "claimed",
        executorTabId: input.executorTabId,
        updatedAt: now,
      },
      executorEventCapability,
      executionPlan: toExecutionPlan(row),
    };
  });
}

export async function listApplicationRuns(userId: string, limit = 50): Promise<RunSummary[]> {
  const rows = await db
    .select(runSelection)
    .from(applicationRuns)
    .innerJoin(campaigns, eq(applicationRuns.campaignId, campaigns.id))
    .where(eq(applicationRuns.userId, userId))
    .orderBy(desc(applicationRuns.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));

  return rows.map(toRunSummary);
}

export async function getApplicationRun(userId: string, runId: string): Promise<RunSummary> {
  const [row] = await db
    .select(runSelection)
    .from(applicationRuns)
    .innerJoin(campaigns, eq(applicationRuns.campaignId, campaigns.id))
    .where(and(eq(applicationRuns.id, runId), eq(applicationRuns.userId, userId)))
    .limit(1);

  if (!row) throw new RunNotFoundError();
  return toRunSummary(row);
}

export async function listRunEvents(userId: string, runId: string): Promise<RunEventRecord[]> {
  await getApplicationRun(userId, runId);

  const rows = await db
    .select({
      id: runEvents.id,
      runId: runEvents.runId,
      type: runEvents.type,
      idempotencyKey: runEvents.idempotencyKey,
      detailJson: runEvents.detailJson,
      occurredAt: runEvents.occurredAt,
    })
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.occurredAt));

  return rows.map((row) => ({
    id: row.id,
    runId: row.runId,
    type: parseRunEventType(row.type),
    idempotencyKey: row.idempotencyKey,
    detail: parseEventDetail(row.detailJson),
    occurredAt: row.occurredAt,
  }));
}

export async function appendRunEvent(
  userId: string,
  runId: string,
  input: AppendRunEventInput,
): Promise<{ run: RunSummary; event: RunEventRecord; deduplicated: boolean }> {
  return db.transaction(async (transaction) => {
    const [row] = await transaction
      .select(runSelection)
      .from(applicationRuns)
      .innerJoin(campaigns, eq(applicationRuns.campaignId, campaigns.id))
      .where(and(eq(applicationRuns.id, runId), eq(applicationRuns.userId, userId)))
      .limit(1);

    if (!row) throw new RunNotFoundError();

    return appendRunEventInTransaction(transaction, toRunSummary(row), input);
  });
}

/**
 * This path accepts only the extension-private capability issued at claim
 * time. It has no user-session fallback, so browser-page JavaScript cannot
 * forge executor progress through the dashboard API.
 */
export async function appendExecutorRunEvent(
  input: ExecutorRunEventInput,
): Promise<{ run: RunSummary; event: RunEventRecord; deduplicated: boolean }> {
  return db.transaction(async (transaction) => {
    const [row] = await transaction
      .select(runSelection)
      .from(applicationRuns)
      .innerJoin(campaigns, eq(applicationRuns.campaignId, campaigns.id))
      .where(eq(applicationRuns.id, input.runId))
      .limit(1);

    if (!hasValidExecutorEventCapability(row, input)) {
      throw new ExecutorEventCapabilityError();
    }

    const { executorEventToken: _token, executorSessionId: _sessionId, runId: _runId, ...event } = input;
    return appendRunEventInTransaction(transaction, toRunSummary(row), event);
  });
}

export async function getExecutorRunStatus(
  input: ExecutorStatusInput,
): Promise<RunSummary> {
  return (await getAuthorizedExecutorRunContext(input)).run;
}

/**
 * Resolves the owner and campaign only after validating the extension-private
 * capability. Executor APIs must use this instead of accepting a user ID or
 * role from browser-page JavaScript.
 */
export async function getAuthorizedExecutorRunContext(
  input: ExecutorStatusInput,
): Promise<AuthorizedExecutorRunContext> {
  const [row] = await db
    .select(runSelection)
    .from(applicationRuns)
    .innerJoin(campaigns, eq(applicationRuns.campaignId, campaigns.id))
    .where(eq(applicationRuns.id, input.runId))
    .limit(1);

  if (!hasValidExecutorEventCapability(row, input)) {
    throw new ExecutorEventCapabilityError();
  }
  return {
    userId: row.userId,
    targetRole: row.targetRole,
    targetLocation: row.targetLocation,
    run: toRunSummary(row),
  };
}

async function appendRunEventInTransaction(
  transaction: DatabaseTransaction,
  currentRun: RunSummary,
  input: AppendRunEventInput,
): Promise<{ run: RunSummary; event: RunEventRecord; deduplicated: boolean }> {
  const runId = currentRun.id;
  const [existingEvent] = await transaction
    .select({
      id: runEvents.id,
      runId: runEvents.runId,
      type: runEvents.type,
      idempotencyKey: runEvents.idempotencyKey,
      detailJson: runEvents.detailJson,
      occurredAt: runEvents.occurredAt,
    })
    .from(runEvents)
    .where(eq(runEvents.idempotencyKey, input.idempotencyKey))
    .limit(1);

  if (existingEvent) {
    if (existingEvent.runId !== runId) {
      throw new InvalidRunTransitionError("That event key belongs to a different run.");
    }

    return {
      run: currentRun,
      event: {
        id: existingEvent.id,
        runId: existingEvent.runId,
        type: parseRunEventType(existingEvent.type),
        idempotencyKey: existingEvent.idempotencyKey,
        detail: parseEventDetail(existingEvent.detailJson),
        occurredAt: existingEvent.occurredAt,
      },
      deduplicated: true,
    };
  }

  const nextState = determineNextState(currentRun.state, input.type);
  const now = new Date().toISOString();
  const occurredAt = input.occurredAt ?? now;
  const detail = input.detail ?? null;

  let appliedCount = currentRun.appliedCount;
  let skippedCount = currentRun.skippedCount;

  if (input.type === "application_submitted") {
    if (appliedCount >= currentRun.targetApplications) {
      throw new InvalidRunTransitionError("The run has already reached its application target.");
    }
    appliedCount += 1;
  }

  if (input.type === "application_skipped") {
    skippedCount += 1;
  }

  if (input.type === "application_submitted") {
    await persistSubmittedApplication(transaction, currentRun, detail, occurredAt, now);
  }

  const executorTabId = readExecutorTabId(input.type, detail, currentRun.executorTabId);
  const update: {
    state: RunState;
    appliedCount: number;
    skippedCount: number;
    executorTabId: number | null;
    executionTicketHash?: string | null;
    executionTicketExpiresAt?: string | null;
    executorEventTokenHash?: string | null;
    executorEventTokenExpiresAt?: string | null;
    startedAt?: string;
    completedAt?: string;
    updatedAt: string;
  } = {
    state: nextState,
    appliedCount,
    skippedCount,
    executorTabId,
    updatedAt: now,
  };

  if (input.type === "executor_started" && !currentRun.startedAt) {
    update.startedAt = occurredAt;
  }

  if (nextState === "completed" || nextState === "failed" || nextState === "cancelled") {
    update.completedAt = occurredAt;
    update.executionTicketHash = null;
    update.executionTicketExpiresAt = null;
    update.executorEventTokenHash = null;
    update.executorEventTokenExpiresAt = null;
  }

  const event: RunEventRecord = {
    id: crypto.randomUUID(),
    runId,
    type: input.type,
    idempotencyKey: input.idempotencyKey,
    detail,
    occurredAt,
  };

  if (input.type === "job_discovered") {
    const job = parseDiscoveredJob(detail);
    if (!job) {
      throw new InvalidRunTransitionError("A discovered job must include a valid LinkedIn identity and URL.");
    }
    await transaction
      .insert(jobListings)
      .values({
        id: crypto.randomUUID(),
        runId,
        source: job.source,
        externalId: job.externalId,
        url: job.url,
        title: job.title,
        company: job.company,
        location: job.location,
        status: "discovered",
        rawJson: JSON.stringify(detail),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [jobListings.runId, jobListings.source, jobListings.url],
        set: {
          externalId: job.externalId,
          title: job.title,
          company: job.company,
          location: job.location,
          rawJson: JSON.stringify(detail),
          updatedAt: now,
        },
      });
  }

  await transaction.insert(runEvents).values({
    id: event.id,
    runId,
    type: event.type,
    idempotencyKey: event.idempotencyKey,
    detailJson: detail ? JSON.stringify(detail) : null,
    occurredAt,
    createdAt: now,
  });

  await transaction
    .update(applicationRuns)
    .set(update)
    .where(eq(applicationRuns.id, runId));

  return {
    run: {
      ...currentRun,
      state: nextState,
      appliedCount,
      skippedCount,
      executorTabId,
      startedAt: update.startedAt ?? currentRun.startedAt,
      completedAt: update.completedAt ?? currentRun.completedAt,
      updatedAt: now,
    },
    event,
    deduplicated: false,
  };
}

async function persistSubmittedApplication(
  transaction: DatabaseTransaction,
  currentRun: RunSummary,
  detail: EventDetail | null,
  submittedAt: string,
  now: string,
): Promise<void> {
  const externalId = typeof detail?.externalId === "string" ? detail.externalId : null;
  const source = detail?.source === "linkedin" ? "linkedin" : null;
  if (!externalId || !source) {
    throw new InvalidRunTransitionError(
      "A submitted application must identify its LinkedIn listing.",
    );
  }

  const [listing] = await transaction
    .select({ id: jobListings.id })
    .from(jobListings)
    .where(and(
      eq(jobListings.runId, currentRun.id),
      eq(jobListings.source, source),
      eq(jobListings.externalId, externalId),
    ))
    .limit(1);

  if (!listing) {
    throw new InvalidRunTransitionError(
      "A submitted application must reference a listing already discovered by this run.",
    );
  }

  await transaction
    .insert(applications)
    .values({
      id: crypto.randomUUID(),
      runId: currentRun.id,
      jobListingId: listing.id,
      status: "submitted",
      submittedAt,
      confirmationJson: JSON.stringify({
        source,
        externalId,
        confirmation: detail.confirmation === "observed" ? "observed" : "recorded",
      }),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: applications.jobListingId,
      set: {
        status: "submitted",
        submittedAt,
        confirmationJson: JSON.stringify({
          source,
          externalId,
          confirmation: detail.confirmation === "observed" ? "observed" : "recorded",
        }),
        updatedAt: now,
      },
    });
}

const runSelection = {
  id: applicationRuns.id,
  campaignId: applicationRuns.campaignId,
  userId: applicationRuns.userId,
  state: applicationRuns.state,
  targetApplications: applicationRuns.targetApplications,
  appliedCount: applicationRuns.appliedCount,
  skippedCount: applicationRuns.skippedCount,
  executorTabId: applicationRuns.executorTabId,
  executionTicketHash: applicationRuns.executionTicketHash,
  executionTicketExpiresAt: applicationRuns.executionTicketExpiresAt,
  executorSessionId: applicationRuns.executorSessionId,
  executorEventTokenHash: applicationRuns.executorEventTokenHash,
  executorEventTokenExpiresAt: applicationRuns.executorEventTokenExpiresAt,
  startedAt: applicationRuns.startedAt,
  completedAt: applicationRuns.completedAt,
  createdAt: applicationRuns.createdAt,
  updatedAt: applicationRuns.updatedAt,
  targetRole: campaigns.targetRole,
  targetLocation: campaigns.targetLocation,
  boardIdsJson: campaigns.boardIdsJson,
  configurationJson: campaigns.configurationJson,
  autonomyPolicyJson: campaigns.autonomyPolicyJson,
};

function toRunSummary(row: RunRow): RunSummary {
  return {
    id: row.id,
    campaignId: row.campaignId,
    state: parseRunState(row.state),
    targetRole: row.targetRole,
    targetLocation: row.targetLocation,
    boardIds: parseBoardIds(row.boardIdsJson),
    targetApplications: row.targetApplications,
    appliedCount: row.appliedCount,
    skippedCount: row.skippedCount,
    executorTabId: row.executorTabId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function determineNextState(currentState: RunState, eventType: RunEventType): RunState {
  if (eventType === "run_created") {
    throw new InvalidRunTransitionError("Run creation events are server-owned.");
  }

  if (isTerminalState(currentState)) {
    throw new InvalidRunTransitionError("A completed, failed, or cancelled run cannot accept new events.");
  }

  switch (eventType) {
    case "executor_recovery_prepared":
      throw new InvalidRunTransitionError("Executor recovery events are server-owned.");
    case "executor_claimed":
      return requireState(currentState, ["ready"], "An executor can only claim a ready run.", "claimed");
    case "executor_started":
      return requireState(
        currentState,
        ["claimed"],
        "Only a claimed run can begin execution.",
        "running",
      );
    case "run_paused":
      return requireState(currentState, ["running"], "Only a running run can be paused.", "paused");
    case "run_resumed":
      return requireState(
        currentState,
        ["paused", "needs_user_input"],
        "Only a paused run can be resumed.",
        "running",
      );
    case "user_input_required":
      return requireState(
        currentState,
        ["running"],
        "Only a running run can request user input.",
        "needs_user_input",
      );
    case "application_question_answered":
      return requireState(
        currentState,
        ["needs_user_input"],
        "An application question can only be answered while the campaign is waiting for input.",
        "running",
      );
    case "application_question_deferred":
      return requireState(
        currentState,
        ["needs_user_input"],
        "An application question can only be deferred while the campaign is waiting for input.",
        "needs_user_input",
      );
    case "run_completed":
      return requireState(
        currentState,
        ["running", "paused", "needs_user_input"],
        "Only an active run can be completed.",
        "completed",
      );
    case "run_failed":
      return "failed";
    case "run_cancelled":
      return "cancelled";
    case "page_loaded":
    case "job_discovered":
    case "job_qualified":
    case "easy_apply":
    case "application_answers_planned":
    case "application_prepared":
    case "application_submitted":
    case "application_skipped":
      if (eventType === "application_answers_planned") {
        return requireState(
          currentState,
          ["running", "paused", "needs_user_input"],
          "Application answers can only be planned for an active campaign.",
          currentState,
        );
      }
      return requireState(
        currentState,
        ["running"],
        "Only a running run can record application activity.",
        "running",
      );
  }
}

function toExecutionPlan(row: RunRow): BrowserExecutionPlan {
  const configuration = parseCampaignConfiguration(row.configurationJson);
  const autonomy = parseAutonomyPolicy(row.autonomyPolicyJson);
  const targetApplications = row.targetApplications;
  const configuredSubmissionMode = process.env.RAPIDAPPLY_SUBMISSION_MODE?.trim();

  return {
    runId: row.id,
    adapterId: "linkedin",
    targetRole: row.targetRole,
    targetLocation: row.targetLocation,
    targetApplications,
    poolTarget: Math.max(targetApplications, Math.ceil(targetApplications * 1.2)),
    autonomyPolicy: autonomy,
    submissionMode: configuredSubmissionMode === "review_only"
      ? "review_only"
      : configuredSubmissionMode === "test_submit"
        ? "test_submit"
        : autonomy.mode === "autonomous"
          ? "autonomous_submit"
          : "review_only",
    preferences: configuration,
  };
}

function parseCampaignConfiguration(value: string): BrowserExecutionPlan["preferences"] {
  const fallback: BrowserExecutionPlan["preferences"] = {
    experience: "mid",
    workStyle: "any",
    onlyEasyApply: true,
    excludedTerms: [],
  };

  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fallback;
    const record = parsed as Record<string, unknown>;
    const experience = ["entry", "mid", "senior", "lead"].includes(String(record.experience))
      ? record.experience as BrowserExecutionPlan["preferences"]["experience"]
      : fallback.experience;
    const workStyle = ["remote", "hybrid", "onsite", "any"].includes(String(record.workStyle))
      ? record.workStyle as BrowserExecutionPlan["preferences"]["workStyle"]
      : fallback.workStyle;
    const excludedTerms = typeof record.exclude === "string"
      ? Array.from(new Set(record.exclude.split(",").map((term) => term.trim()).filter(Boolean))).slice(0, 50)
      : [];

    return {
      experience,
      workStyle,
      onlyEasyApply: typeof record.onlyEasyApply === "boolean"
        ? record.onlyEasyApply
        : fallback.onlyEasyApply,
      excludedTerms,
    };
  } catch {
    return fallback;
  }
}

function parseDiscoveredJob(detail: EventDetail | null): {
  source: "linkedin";
  externalId: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
} | null {
  if (!detail || detail.source !== "linkedin") return null;
  const externalId = detail.externalId;
  const urlValue = detail.url;
  const title = detail.jobTitle;
  const company = detail.company;
  const location = detail.location;
  if (
    typeof externalId !== "string" ||
    !/^\d+$/.test(externalId) ||
    typeof urlValue !== "string" ||
    typeof title !== "string" ||
    title.length === 0 ||
    typeof company !== "string" ||
    company.length === 0 ||
    (location !== null && typeof location !== "string")
  ) return null;

  try {
    const url = new URL(urlValue);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.linkedin.com" ||
      url.pathname !== `/jobs/view/${externalId}/`
    ) return null;
  } catch {
    return null;
  }

  return {
    source: "linkedin",
    externalId,
    url: urlValue,
    title: title.slice(0, 240),
    company: company.slice(0, 240),
    location: typeof location === "string" ? location.slice(0, 240) : null,
  };
}

function requireState<T extends RunState>(
  currentState: RunState,
  allowedStates: readonly RunState[],
  message: string,
  nextState: T,
): T {
  if (!allowedStates.includes(currentState)) {
    throw new InvalidRunTransitionError(message);
  }

  return nextState;
}

function isTerminalState(state: RunState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

function parseRunState(value: string): RunState {
  if ((RUN_STATES as readonly string[]).includes(value)) return value as RunState;
  throw new Error(`Unexpected persisted run state: ${value}`);
}

function parseRunEventType(value: string): RunEventType {
  // All event types enter through a validated API or server-owned creation.
  return value as RunEventType;
}

function parseBoardIds(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((boardId) => typeof boardId === "string")) {
      return parsed;
    }
  } catch {
    // A malformed legacy row is safely represented as no boards.
  }

  return [];
}

function parseEventDetail(value: string | null): EventDetail | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as EventDetail;
    }
  } catch {
    // Events remain readable even if an old detail payload is malformed.
  }

  return null;
}

function hasValidExecutorEventCapability(
  row: RunRow | undefined,
  input: Pick<ExecutorRunEventInput, "executorSessionId" | "executorEventToken">,
): row is RunRow {
  if (
    !row ||
    !row.executorSessionId ||
    !row.executorEventTokenHash ||
    !row.executorEventTokenExpiresAt ||
    row.executorSessionId !== input.executorSessionId
  ) {
    return false;
  }

  return (
    executionTicketMatches(input.executorEventToken, row.executorEventTokenHash) &&
    !hasExecutionTicketExpired(row.executorEventTokenExpiresAt)
  );
}

function readExecutorTabId(
  eventType: RunEventType,
  detail: EventDetail | null,
  currentExecutorTabId: number | null,
): number | null {
  if (eventType !== "executor_claimed" && eventType !== "executor_started") {
    return currentExecutorTabId;
  }

  const value = detail?.executorTabId;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  return currentExecutorTabId;
}

export async function deferExecutorJob(
  input: DeferExecutorJobInput,
): Promise<{ ok: boolean }> {
  const [row] = await db
    .select()
    .from(applicationRuns)
    .where(eq(applicationRuns.id, input.runId))
    .limit(1);

  if (!hasValidExecutorEventCapability(row as unknown as RunRow, input)) {
    throw new ExecutorEventCapabilityError();
  }

  const [existing] = await db.select({ id: deferredJobs.id })
    .from(deferredJobs)
    .where(and(
      eq(deferredJobs.runId, input.runId),
      eq(deferredJobs.jobExternalId, input.jobExternalId),
    ))
    .limit(1);
  if (existing) return { ok: true };

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(deferredJobs).values({
      id,
      runId: input.runId,
      userId: row.userId,
      jobExternalId: input.jobExternalId,
      url: input.url,
      title: input.title,
      company: input.company,
      reasonCode: input.reasonCode,
      reasonDetails: input.reasonDetails ?? null,
      createdAt: now,
      updatedAt: now,
    });

    await tx
      .update(applicationRuns)
      .set({
        jobsDeferredCount: (row.jobsDeferredCount ?? 0) + 1,
        updatedAt: now,
      })
      .where(eq(applicationRuns.id, input.runId));

    await tx.insert(runEvents).values({
      id: crypto.randomUUID(),
      runId: input.runId,
      type: "job_deferred",
      idempotencyKey: `defer:${input.runId}:${input.jobExternalId}`,
      detailJson: JSON.stringify({
        jobExternalId: input.jobExternalId,
        title: input.title,
        company: input.company,
        reasonCode: input.reasonCode,
      }),
      occurredAt: now,
      createdAt: now,
    });
  });

  return { ok: true };
}

export async function listDeferredJobsForUser(userId: string) {
  return db
    .select()
    .from(deferredJobs)
    .where(eq(deferredJobs.userId, userId))
    .orderBy(desc(deferredJobs.createdAt));
}
