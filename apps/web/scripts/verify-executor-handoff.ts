import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import type { CurrentUser } from "../src/server/auth/current-user";
import { jobListings } from "../src/server/db/schema";

process.env.RAPIDAPPLY_SUBMISSION_MODE = "autonomous_submit";

const verificationUser: CurrentUser = {
  id: "executor-handoff-verification-user",
  email: "verification@rapidapply.local",
  name: "Executor handoff verification",
};

const verificationDatabasePath = resolve(process.cwd(), "data/rapidapply.executor-handoff.verify.db");

async function main(): Promise<void> {
  await Promise.all([
    verificationDatabasePath,
    `${verificationDatabasePath}-shm`,
    `${verificationDatabasePath}-wal`,
  ].map((path) => rm(path, { force: true })));

  // The database client opens its SQLite handle at module load. Load it only
  // after the isolated verification files have been cleared, otherwise SQLite
  // correctly refuses writes to a handle whose backing file was moved.
  const [{ db }, repository] = await Promise.all([
    import("../src/server/db/client"),
    import("../src/server/db/repositories/run-repository"),
  ]);
  const {
    ExecutorEventCapabilityError,
    ExecutionTicketError,
    appendExecutorRunEvent,
    appendRunEvent,
    claimExecutionTicket,
    createApplicationRun,
    getApplicationRun,
    getExecutorRunStatus,
    listRunEvents,
    prepareExecutionTicket,
  } = repository;

  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });

  const createdRun = await createApplicationRun(verificationUser, {
    targetRole: "Product Designer",
    targetLocation: "Remote",
    boardIds: ["linkedin"],
    targetApplications: 5,
    configuration: {
      dailyLimit: 5,
      experience: "senior",
      workStyle: "remote",
      aiTailor: true,
      onlyEasyApply: true,
      exclude: "",
    },
  });

  const prepared = await prepareExecutionTicket(verificationUser.id, createdRun.id);
  const executorSessionId = randomUUID();
  const claimedSession = await claimExecutionTicket({
    runId: prepared.run.id,
    executionTicket: prepared.executionTicket.token,
    executorSessionId,
    executorTabId: 1,
    extensionVersion: "verification",
  });

  const started = await appendExecutorRunEvent({
    runId: prepared.run.id,
    executorSessionId,
    executorEventToken: claimedSession.executorEventCapability.token,
    type: "executor_started",
    idempotencyKey: `executor:${createdRun.id}:started`,
  });
  const inputRequested = await appendExecutorRunEvent({
    runId: prepared.run.id,
    executorSessionId,
    executorEventToken: claimedSession.executorEventCapability.token,
    type: "user_input_required",
    idempotencyKey: `executor:${createdRun.id}:needs-input`,
  });
  const pausedExecutorStatus = await getExecutorRunStatus({
    runId: prepared.run.id,
    executorSessionId,
    executorEventToken: claimedSession.executorEventCapability.token,
  });

  let replayRejected = false;
  try {
    await claimExecutionTicket({
      runId: prepared.run.id,
      executionTicket: prepared.executionTicket.token,
      executorSessionId: randomUUID(),
      executorTabId: 1,
      extensionVersion: "verification",
    });
  } catch (error) {
    if (error instanceof ExecutionTicketError) replayRejected = true;
    else throw error;
  }

  let invalidEventCapabilityRejected = false;
  try {
    await appendExecutorRunEvent({
      runId: prepared.run.id,
      executorSessionId,
      executorEventToken: "invalid-event-capability-token-that-is-long-enough",
      type: "page_loaded",
      idempotencyKey: `executor:${createdRun.id}:invalid-capability`,
    });
  } catch (error) {
    if (error instanceof ExecutorEventCapabilityError) invalidEventCapabilityRejected = true;
    else throw error;
  }

  const recoveryPrepared = await prepareExecutionTicket(
    verificationUser.id,
    createdRun.id,
    { recover: true },
  );

  let oldCapabilityRevoked = false;
  try {
    await appendExecutorRunEvent({
      runId: prepared.run.id,
      executorSessionId,
      executorEventToken: claimedSession.executorEventCapability.token,
      type: "page_loaded",
      idempotencyKey: `executor:${createdRun.id}:after-recovery`,
    });
  } catch (error) {
    if (error instanceof ExecutorEventCapabilityError) oldCapabilityRevoked = true;
    else throw error;
  }

  const recoveredExecutorSessionId = randomUUID();
  const recoveredClaim = await claimExecutionTicket({
    runId: recoveryPrepared.run.id,
    executionTicket: recoveryPrepared.executionTicket.token,
    executorSessionId: recoveredExecutorSessionId,
    executorTabId: 2,
    extensionVersion: "verification-recovery",
  });
  const recoveredStarted = await appendExecutorRunEvent({
    runId: recoveryPrepared.run.id,
    executorSessionId: recoveredExecutorSessionId,
    executorEventToken: recoveredClaim.executorEventCapability.token,
    type: "executor_started",
    idempotencyKey: `executor:${createdRun.id}:recovered-started`,
  });
  const recoveredExecutorStatus = await getExecutorRunStatus({
    runId: recoveryPrepared.run.id,
    executorSessionId: recoveredExecutorSessionId,
    executorEventToken: recoveredClaim.executorEventCapability.token,
  });
  const discoveredJobEvent = {
    runId: recoveryPrepared.run.id,
    executorSessionId: recoveredExecutorSessionId,
    executorEventToken: recoveredClaim.executorEventCapability.token,
    type: "job_discovered" as const,
    idempotencyKey: `job-discovered:${createdRun.id}:linkedin:10001`,
    detail: {
      source: "linkedin",
      externalId: "10001",
      url: "https://www.linkedin.com/jobs/view/10001/",
      jobTitle: "Product Designer",
      company: "Fixture Labs",
      location: "Remote",
      pageIndex: 0,
      hydrationCycles: 2,
    },
  };
  const discovered = await appendExecutorRunEvent(discoveredJobEvent);
  const replayedDiscovery = await appendExecutorRunEvent(discoveredJobEvent);

  const cancelled = await appendRunEvent(verificationUser.id, createdRun.id, {
    type: "run_cancelled",
    idempotencyKey: `web:${createdRun.id}:cancelled`,
  });

  let terminalCapabilityRejected = false;
  try {
    await appendExecutorRunEvent({
      runId: prepared.run.id,
      executorSessionId: recoveredExecutorSessionId,
      executorEventToken: recoveredClaim.executorEventCapability.token,
      type: "page_loaded",
      idempotencyKey: `executor:${createdRun.id}:after-cancel`,
    });
  } catch (error) {
    if (error instanceof ExecutorEventCapabilityError) terminalCapabilityRejected = true;
    else throw error;
  }

  const persistedRun = await getApplicationRun(verificationUser.id, createdRun.id);
  const events = await listRunEvents(verificationUser.id, createdRun.id);
  const eventTypes = events.map((event) => event.type);
  const persistedJobs = await db
    .select({ id: jobListings.id })
    .from(jobListings)
    .where(eq(jobListings.runId, createdRun.id));

  if (
    createdRun.state !== "ready" ||
    prepared.run.state !== "ready" ||
    claimedSession.run.state !== "claimed" ||
    started.run.state !== "running" ||
    inputRequested.run.state !== "needs_user_input" ||
    pausedExecutorStatus.state !== "needs_user_input" ||
    recoveryPrepared.run.state !== "ready" ||
    recoveredClaim.run.state !== "claimed" ||
    recoveredStarted.run.state !== "running" ||
    recoveredExecutorStatus.state !== "running" ||
    discovered.run.state !== "running" ||
    !replayedDiscovery.deduplicated ||
    persistedJobs.length !== 1 ||
    recoveredClaim.executionPlan.runId !== createdRun.id ||
    recoveredClaim.executionPlan.poolTarget !== 6 ||
    recoveredClaim.executionPlan.preferences.workStyle !== "remote" ||
    recoveredClaim.executionPlan.autonomyPolicy?.mode !== "autonomous" ||
    recoveredClaim.executionPlan.autonomyPolicy?.freeTextStrategy !== "ai_draft" ||
    recoveredClaim.executionPlan.submissionMode !== "autonomous_submit" ||
    cancelled.run.state !== "cancelled" ||
    persistedRun.state !== "cancelled" ||
    !eventTypes.includes("run_created") ||
    !eventTypes.includes("executor_claimed") ||
    !eventTypes.includes("executor_started") ||
    !eventTypes.includes("user_input_required") ||
    !eventTypes.includes("executor_recovery_prepared") ||
    !replayRejected ||
    !invalidEventCapabilityRejected ||
    !oldCapabilityRevoked ||
    !terminalCapabilityRejected
  ) {
    throw new Error("Executor handoff verification did not reach the expected scoped-event state.");
  }

  // Deliberately do not print ticket values, IDs, or connection details.
  console.log("Executor handoff verified: claim, recovery, scoped events, revocation, and replay protection passed.");
}

main().catch((error: unknown) => {
  console.error("Executor handoff verification failed.");
  console.error(error);
  process.exitCode = 1;
});
