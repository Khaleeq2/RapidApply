import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { CurrentUser } from "../src/server/auth/current-user";
import type { CreateRunInput } from "../src/server/http/run-schemas";

const verificationUser: CurrentUser = {
  id: "run-replacement-verification-user",
  email: "run-replacement@rapidapply.local",
  name: "Run replacement verification",
};

const runInput: CreateRunInput = {
  targetRole: "Product Designer",
  targetLocation: "Remote",
  boardIds: ["linkedin"],
  targetApplications: 5,
  configuration: {
    dailyLimit: 5,
    experience: "senior" as const,
    workStyle: "remote" as const,
    aiTailor: true,
    onlyEasyApply: true,
    exclude: "",
  },
};

const verificationDatabasePath = resolve(process.cwd(), "data/rapidapply.run-replacement.verify.db");

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
    appendExecutorRunEvent,
    claimExecutionTicket,
    createApplicationRun,
    getApplicationRun,
    listRunEvents,
    prepareExecutionTicket,
  } = repository;

  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });

  const first = await createApplicationRun(verificationUser, runInput);
  const prepared = await prepareExecutionTicket(verificationUser.id, first.id);
  const executorSessionId = randomUUID();
  const claimed = await claimExecutionTicket({
    runId: first.id,
    executionTicket: prepared.executionTicket.token,
    executorSessionId,
    executorTabId: 1,
    extensionVersion: "replacement-verification",
  });
  await appendExecutorRunEvent({
    runId: first.id,
    executorSessionId,
    executorEventToken: claimed.executorEventCapability.token,
    type: "executor_started",
    idempotencyKey: `replacement:${first.id}:started`,
  });

  const replacement = await createApplicationRun(verificationUser, runInput);
  const retired = await getApplicationRun(verificationUser.id, first.id);
  const replacementPersisted = await getApplicationRun(verificationUser.id, replacement.id);
  const events = await listRunEvents(verificationUser.id, first.id);
  const supersededEvent = events.find((event) =>
    event.type === "run_cancelled" && event.detail?.reason === "superseded_by_new_campaign");

  let oldCapabilityRejected = false;
  try {
    await appendExecutorRunEvent({
      runId: first.id,
      executorSessionId,
      executorEventToken: claimed.executorEventCapability.token,
      type: "page_loaded",
      idempotencyKey: `replacement:${first.id}:stale-capability`,
    });
  } catch (error) {
    if (error instanceof ExecutorEventCapabilityError) oldCapabilityRejected = true;
    else throw error;
  }

  const replacementTicket = await prepareExecutionTicket(verificationUser.id, replacement.id);
  if (
    retired.state !== "cancelled" ||
    replacementPersisted.state !== "ready" ||
    !supersededEvent ||
    !oldCapabilityRejected ||
    replacementTicket.run.id !== replacement.id
  ) {
    throw new Error("Run replacement verification did not preserve the one-active-run invariant.");
  }

  // Deliberately do not print tickets, tokens, or user identifiers.
  console.log("Run replacement verified: an active campaign is superseded atomically and its executor capability is revoked.");
}

main().catch((error: unknown) => {
  console.error("Run replacement verification failed.");
  console.error(error);
  process.exitCode = 1;
});
