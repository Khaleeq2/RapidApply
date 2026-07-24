import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { CurrentUser } from "../src/server/auth/current-user";

process.env.RAPIDAPPLY_SUBMISSION_MODE = "test_submit";

const verificationUser: CurrentUser = {
  id: "submission-flow-verification-user",
  email: "submission-flow@rapidapply.local",
  name: "Submission flow verification",
};

const verificationDatabasePath = resolve(process.cwd(), "data/rapidapply.submission-flow.verify.db");

async function main(): Promise<void> {
  await Promise.all([
    verificationDatabasePath,
    `${verificationDatabasePath}-shm`,
    `${verificationDatabasePath}-wal`,
  ].map((path) => rm(path, { force: true })));

  const [{ db }, schema, repository] = await Promise.all([
    import("../src/server/db/client"),
    import("../src/server/db/schema"),
    import("../src/server/db/repositories/run-repository"),
  ]);
  const {
    appendExecutorRunEvent,
    createApplicationRun,
    getApplicationRun,
    listRunEvents,
    prepareExecutionTicket,
    claimExecutionTicket,
  } = repository;

  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });

  const created = await createApplicationRun(verificationUser, {
    targetRole: "Product Designer",
    targetLocation: "Remote",
    boardIds: ["linkedin"],
    targetApplications: 1,
    configuration: {
      dailyLimit: 1,
      experience: "senior",
      workStyle: "remote",
      aiTailor: true,
      onlyEasyApply: true,
      exclude: "",
    },
  });
  const prepared = await prepareExecutionTicket(verificationUser.id, created.id);
  const executorSessionId = randomUUID();
  const claimed = await claimExecutionTicket({
    runId: created.id,
    executionTicket: prepared.executionTicket.token,
    executorSessionId,
    executorTabId: 7,
    extensionVersion: "submission-flow-verification",
  });

  const capability = {
    runId: created.id,
    executorSessionId,
    executorEventToken: claimed.executorEventCapability.token,
  };
  const started = await appendExecutorRunEvent({
    ...capability,
    type: "executor_started",
    idempotencyKey: `submission-flow:${created.id}:started`,
  });
  const discovered = await appendExecutorRunEvent({
    ...capability,
    type: "job_discovered",
    idempotencyKey: `submission-flow:${created.id}:discovered`,
    detail: {
      source: "linkedin",
      externalId: "10001",
      url: "https://www.linkedin.com/jobs/view/10001/",
      jobTitle: "Product Designer",
      company: "Fixture Labs",
      location: "Remote",
      pageIndex: 0,
      hydrationCycles: 1,
    },
  });
  const submitted = await appendExecutorRunEvent({
    ...capability,
    type: "application_submitted",
    idempotencyKey: `submission-flow:${created.id}:submitted`,
    detail: {
      source: "linkedin",
      externalId: "10001",
      confirmation: "observed",
    },
  });
  const completed = await appendExecutorRunEvent({
    ...capability,
    type: "run_completed",
    idempotencyKey: `submission-flow:${created.id}:completed`,
  });

  const persisted = await getApplicationRun(verificationUser.id, created.id);
  const events = await listRunEvents(verificationUser.id, created.id);
  const eventTypes = events.map((event) => event.type);
  const persistedApplications = await db
    .select({ id: schema.applications.id, status: schema.applications.status })
    .from(schema.applications);

  if (
    claimed.executionPlan.submissionMode !== "test_submit" ||
    started.run.state !== "running" ||
    discovered.run.state !== "running" ||
    submitted.run.appliedCount !== 1 ||
    completed.run.state !== "completed" ||
    persisted.state !== "completed" ||
    persisted.appliedCount !== 1 ||
    persistedApplications.length !== 1 ||
    persistedApplications[0]?.status !== "submitted" ||
    !eventTypes.includes("application_submitted") ||
    !eventTypes.includes("run_completed")
  ) {
    throw new Error("Submission flow verification did not persist the confirmed application lifecycle.");
  }

  console.log("Submission flow verified: opt-in mode, discovered listing, confirmed submission event, application count, and completion state passed.");
}

main().catch((error: unknown) => {
  console.error("Submission flow verification failed.");
  console.error(error);
  process.exitCode = 1;
});
