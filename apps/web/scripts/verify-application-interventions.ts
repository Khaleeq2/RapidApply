import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { CurrentUser } from "../src/server/auth/current-user";
import { db } from "../src/server/db/client";
import { applicationAnswerMemory, applicationInterventions } from "../src/server/db/schema";
import { saveCandidateProfile } from "../src/server/db/repositories/candidate-profile-repository";
import {
  createApplicationInterventions,
  deferApplicationInterventionForExecutor,
  resolveApplicationInterventionForExecutor,
} from "../src/server/db/repositories/application-intervention-repository";
import { planExecutorApplicationAnswers } from "../src/server/db/repositories/application-answer-plan-repository";
import {
  appendExecutorRunEvent,
  claimExecutionTicket,
  createApplicationRun,
  deferExecutorJob,
  listDeferredJobsForUser,
  prepareExecutionTicket,
} from "../src/server/db/repositories/run-repository";

async function main(): Promise<void> {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });

  const verificationId = `application-interventions-${randomUUID()}`;
  const user: CurrentUser = {
    id: verificationId,
    email: `${verificationId}@rapidapply.local`,
    name: "Application intervention verification",
  };
  const verificationProfile = {
    fullName: user.name!,
    contactEmail: user.email,
    phone: "+1 555 010 0000",
    location: "Remote",
    headline: "Product designer",
    summary: "Candidate-authored verification profile.",
    linkedinUrl: "",
    portfolioUrl: "",
    authorizedToWork: "yes",
    requiresSponsorship: "no",
    autopilot: { mode: "verified", questionTimeoutSeconds: 15, autoSkipOptionalFields: true },
  } as const;
  await saveCandidateProfile(user, verificationProfile);

  const run = await createApplicationRun(user, {
    targetRole: "Product Designer",
    targetLocation: "Remote",
    boardIds: ["linkedin"],
    targetApplications: 1,
    configuration: {
      dailyLimit: 1,
      experience: "senior",
      workStyle: "remote",
      aiTailor: false,
      onlyEasyApply: true,
      exclude: "",
    },
    autonomyPolicy: {
      mode: "strict_control",
      freeTextStrategy: "profile_only",
      unknownFieldStrategy: "pause_campaign",
      aiConfidenceThreshold: 0.75,
      maxThroughput: { dailyCap: 1, hourlyCap: 1 },
    },
  });
  const prepared = await prepareExecutionTicket(user.id, run.id);
  const executorSessionId = randomUUID();
  const claimed = await claimExecutionTicket({
    runId: run.id,
    executionTicket: prepared.executionTicket.token,
    executorSessionId,
    executorTabId: 4242,
    extensionVersion: "verification",
  });
  const authority = {
    runId: run.id,
    executorSessionId,
    executorEventToken: claimed.executorEventCapability.token,
  };
  await appendExecutorRunEvent({
    ...authority,
    type: "executor_started",
    idempotencyKey: `intervention-verification-started:${run.id}`,
  });

  const firstField = {
    key: "11111111",
    question: "Which work arrangement do you prefer?",
    kind: "single_select" as const,
    category: "other" as const,
    required: true,
    options: [
      { id: "22222222", label: "Remote" },
      { id: "33333333", label: "Hybrid" },
    ],
  };
  const firstPlan = await planExecutorApplicationAnswers({
    ...authority,
    jobExternalId: "123456789",
    observationFingerprint: "a1b2c3d4",
    fields: [firstField],
  });
  assert.equal(firstPlan.plans[0]?.decision, undefined, "unknown fields must ask before use");

  const queued = await createApplicationInterventions({
    ...authority,
    jobExternalId: "123456789",
    observationFingerprint: "a1b2c3d4",
    jobUrl: "https://www.linkedin.com/jobs/view/123456789/",
    jobTitle: "Product Designer",
    company: "Verification Co",
  });
  assert.equal(queued.active?.status, "pending");
  assert.ok(queued.active?.deadlineAt, "the active prompt needs a recoverable deadline");

  const resolved = await resolveApplicationInterventionForExecutor({
    ...authority,
    interventionId: queued.active!.id,
    response: {
      answer: { type: "options", optionIds: ["22222222"] },
      rememberScope: "global",
      autoUse: true,
    },
  });
  assert.equal(resolved.intervention.status, "answered");
  assert.equal(resolved.plan.decision?.status, "resolved");
  assert.equal(
    resolved.plan.decision?.status === "resolved" ? resolved.plan.decision.source : undefined,
    "user",
  );

  const repeatedObservation = await planExecutorApplicationAnswers({
    ...authority,
    jobExternalId: "123456789",
    observationFingerprint: "a1b2c3d4",
    fields: [firstField],
  });
  assert.equal(
    repeatedObservation.plans[0]?.decision?.status === "resolved"
      ? repeatedObservation.plans[0].decision.source
      : undefined,
    "user",
    "a re-observation cannot overwrite a just-saved answer",
  );

  const verifiedLaterField = {
    ...firstField,
    key: "44444444",
    options: [
      { id: "55555555", label: "Remote" },
      { id: "66666666", label: "Hybrid" },
    ],
  };
  const verifiedLaterPlan = await planExecutorApplicationAnswers({
    ...authority,
    jobExternalId: "987654321",
    observationFingerprint: "b1c2d3e4",
    fields: [verifiedLaterField],
  });
  assert.equal(
    verifiedLaterPlan.plans[0]?.decision,
    undefined,
    "Verified mode must ask again before reusing an answer from a different form.",
  );

  await saveCandidateProfile(user, {
    ...verificationProfile,
    autopilot: { ...verificationProfile.autopilot, mode: "smart" },
  });
  const mappedLaterField = {
    ...verifiedLaterField,
    key: "77777777",
  };
  const laterPlan = await planExecutorApplicationAnswers({
    ...authority,
    jobExternalId: "987654322",
    observationFingerprint: "b1c2d3e5",
    fields: [mappedLaterField],
  });
  assert.equal(
    laterPlan.plans[0]?.decision?.status === "resolved" ? laterPlan.plans[0].decision.source : undefined,
    "approved_answer",
  );
  assert.deepEqual(laterPlan.plans[0]?.decision?.status === "resolved"
    ? laterPlan.plans[0].decision.answer
    : undefined, { type: "options", optionIds: ["55555555"] }, "stored option labels must map to a fresh form ID");

  const deferredField = {
    key: "88888888",
    question: "What is your desired salary?",
    kind: "text" as const,
    category: "compensation" as const,
    required: true,
    options: [],
  };
  await planExecutorApplicationAnswers({
    ...authority,
    jobExternalId: "123456789",
    observationFingerprint: "c1d2e3f4",
    fields: [deferredField],
  });
  const deferredQueue = await createApplicationInterventions({
    ...authority,
    jobExternalId: "123456789",
    observationFingerprint: "c1d2e3f4",
    jobUrl: "https://www.linkedin.com/jobs/view/123456789/",
  });
  assert.equal(deferredQueue.active?.field.key, deferredField.key);
  const deferred = await deferApplicationInterventionForExecutor({
    ...authority,
    interventionId: deferredQueue.active!.id,
  });
  assert.equal(deferred.intervention.status, "deferred");

  const memories = await db.select().from(applicationAnswerMemory);
  const interventionRows = await db.select().from(applicationInterventions);
  assert.ok(memories.some((memory) => memory.userId === user.id), "remembered answers must persist independently of a form");
  assert.equal(interventionRows.filter((row) => row.runId === run.id && row.status === "deferred").length, 1);

  const autonomousRun = await createApplicationRun(user, {
    targetRole: "Product Designer",
    targetLocation: "Remote",
    boardIds: ["linkedin"],
    targetApplications: 1,
    configuration: {
      dailyLimit: 1,
      experience: "senior",
      workStyle: "remote",
      aiTailor: false,
      onlyEasyApply: true,
      exclude: "",
    },
    autonomyPolicy: {
      mode: "autonomous",
      freeTextStrategy: "skip_job",
      unknownFieldStrategy: "pause_campaign",
      aiConfidenceThreshold: 0.75,
      maxThroughput: { dailyCap: 1, hourlyCap: 1 },
    },
  });
  const autonomousPrepared = await prepareExecutionTicket(user.id, autonomousRun.id);
  const autonomousExecutorSessionId = randomUUID();
  const autonomousClaim = await claimExecutionTicket({
    runId: autonomousRun.id,
    executionTicket: autonomousPrepared.executionTicket.token,
    executorSessionId: autonomousExecutorSessionId,
    executorTabId: 5252,
    extensionVersion: "verification",
  });
  const autonomousAuthority = {
    runId: autonomousRun.id,
    executorSessionId: autonomousExecutorSessionId,
    executorEventToken: autonomousClaim.executorEventCapability.token,
  };
  await appendExecutorRunEvent({
    ...autonomousAuthority,
    type: "executor_started",
    idempotencyKey: `intervention-verification-autonomous-started:${autonomousRun.id}`,
  });
  const requiredFreeText = {
    key: "99999999",
    question: "Describe a project that is not documented in your profile.",
    kind: "textarea" as const,
    category: "open_text" as const,
    required: true,
    options: [],
  };
  await planExecutorApplicationAnswers({
    ...autonomousAuthority,
    jobExternalId: "223456789",
    observationFingerprint: "d1e2f3a4",
    fields: [requiredFreeText],
  });
  const autonomousQueue = await createApplicationInterventions({
    ...autonomousAuthority,
    jobExternalId: "223456789",
    observationFingerprint: "d1e2f3a4",
    jobUrl: "https://www.linkedin.com/jobs/view/223456789/",
  });
  assert.equal(autonomousQueue.active, undefined, "autonomous free-text skip policy must not create a blocking prompt");
  assert.equal(
    autonomousQueue.interventions.find((item) => item.field.key === requiredFreeText.key)?.status,
    "skipped",
    "freeTextStrategy=skip_job must take precedence over a pause-only unknown-field policy",
  );
  const deferredJobInput = {
    ...autonomousAuthority,
    jobExternalId: "323456789",
    url: "https://www.linkedin.com/jobs/view/323456789/",
    title: "Product Designer",
    company: "Deferred Verification Co",
    reasonCode: "required_question_needs_candidate_fact",
    reasonDetails: "A required answer needs a candidate-approved fact.",
  };
  await deferExecutorJob(deferredJobInput);
  await deferExecutorJob(deferredJobInput);
  const deferredJobs = await listDeferredJobsForUser(user.id);
  assert.equal(
    deferredJobs.filter((job) =>
      job.runId === autonomousRun.id && job.jobExternalId === deferredJobInput.jobExternalId
    ).length,
    1,
    "repeated autonomous observations must create one finish-later job",
  );

  console.log("Application interventions verified: durable question queue, verified-vs-smart answer reuse, safe re-observation, fresh option mapping, idempotent finish-later deferral, and autonomous free-text disposition passed.");
}

main().catch((error: unknown) => {
  console.error("Application intervention verification failed.");
  console.error(error);
  process.exitCode = 1;
});
