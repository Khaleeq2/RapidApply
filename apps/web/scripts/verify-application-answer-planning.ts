import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";
import type { CurrentUser } from "../src/server/auth/current-user";
import { db } from "../src/server/db/client";
import { applicationAnswerPlans } from "../src/server/db/schema";
import { saveCandidateProfile } from "../src/server/db/repositories/candidate-profile-repository";
import {
  claimExecutionTicket,
  createApplicationRun,
  appendExecutorRunEvent,
  prepareExecutionTicket,
} from "../src/server/db/repositories/run-repository";
import { planExecutorApplicationAnswers } from "../src/server/db/repositories/application-answer-plan-repository";
import {
  applicationAnswerIntentKey,
  resolveStoredAnswerForField,
} from "../src/server/db/repositories/application-answer-memory-repository";
import { executorApplicationPlanInputSchema } from "../src/server/http/run-schemas";

async function main(): Promise<void> {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });

  const verificationId = `answer-plan-verification-${randomUUID()}`;
  const user: CurrentUser = {
    id: verificationId,
    email: `${verificationId}@rapidapply.local`,
    name: "Answer plan verification",
  };
  await saveCandidateProfile(user, {
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
  });

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
  });
  const prepared = await prepareExecutionTicket(user.id, run.id);
  const claimedSessionId = randomUUID();
  const claimed = await claimExecutionTicket({
    runId: run.id,
    executionTicket: prepared.executionTicket.token,
    executorSessionId: claimedSessionId,
    executorTabId: 4242,
    extensionVersion: "verification",
  });
  await appendExecutorRunEvent({
    runId: run.id,
    executorSessionId: claimedSessionId,
    executorEventToken: claimed.executorEventCapability.token,
    type: "executor_started",
    idempotencyKey: `verification-executor-started:${run.id}`,
  });

  const input = {
    runId: run.id,
    executorSessionId: claimedSessionId,
    executorEventToken: claimed.executorEventCapability.token,
    jobExternalId: "123456789",
    observationFingerprint: "a1b2c3d4",
    fields: [
      {
        key: "11111111",
        question: "Email address",
        kind: "text" as const,
        category: "contact_email" as const,
        required: true,
        options: [],
      },
      {
        key: "22222222",
        question: "Please select a demographic response",
        kind: "single_select" as const,
        category: "demographic" as const,
        required: false,
        options: [{ id: "33333333", label: "Prefer not to say" }],
      },
    ],
  };

  const first = await planExecutorApplicationAnswers(input);
  const second = await planExecutorApplicationAnswers(input);
  await db.update(applicationAnswerPlans)
    .set({
      decisionJson: JSON.stringify({
        status: "resolved",
        fieldKey: "22222222",
        source: "user",
        answer: { type: "text", text: "stale answer for the wrong field type" },
        provenanceIds: [],
        requiresReview: false,
      }),
    })
    .where(and(
      eq(applicationAnswerPlans.runId, run.id),
      eq(applicationAnswerPlans.fieldKey, "22222222"),
    ));
  const afterStaleDecision = await planExecutorApplicationAnswers(input);
  const stored = await db.select().from(applicationAnswerPlans)
    .where(eq(applicationAnswerPlans.runId, run.id));

  assert.equal(first.plans.length, 2);
  assert.equal(second.plans.length, 2);
  assert.equal(stored.length, 2, "repeated observations must upsert rather than duplicate plans");
  assert.equal(first.plans[0]?.plan.strategy, "deterministic");
  assert.equal(first.plans[0]?.decision?.status, "resolved");
  assert.equal(first.plans[1]?.plan.strategy, "user_input");
  assert.equal(first.plans[1]?.decision, undefined);
  assert.equal(
    afterStaleDecision.plans[1]?.decision,
    undefined,
    "a stale decision with the wrong answer shape must not be reused for a changed form field",
  );
  assert.equal(afterStaleDecision.plans[1]?.plan.strategy, "user_input");
  assert.equal(
    applicationAnswerIntentKey({
      key: "email-one",
      question: "Email address",
      kind: "text",
      category: "contact_email",
      required: true,
      options: [],
    }),
    applicationAnswerIntentKey({
      key: "email-two",
      question: "Preferred e-mail",
      kind: "text",
      category: "contact_email",
      required: true,
      options: [],
    }),
    "direct contact facts should remain reusable across wording variants",
  );
  assert.notEqual(
    applicationAnswerIntentKey({
      key: "consent-one",
      question: "I consent to receive recruiting text messages",
      kind: "checkbox",
      category: "consent",
      required: false,
      options: [],
    }),
    applicationAnswerIntentKey({
      key: "consent-two",
      question: "I certify that every application answer is accurate",
      kind: "checkbox",
      category: "consent",
      required: true,
      options: [],
    }),
    "different consent decisions must never share one reusable memory key",
  );
  assert.equal(
    executorApplicationPlanInputSchema.safeParse({
      ...input,
      fields: [{
        key: "44444444",
        question: "Country",
        kind: "single_select",
        category: "location",
        required: true,
        options: Array.from({ length: 75 }, (_, index) => ({
          id: index.toString(16).padStart(8, "0"),
          label: `Country ${index + 1}`,
        })),
      }],
    }).success,
    true,
    "country-scale option lists must survive the executor API boundary",
  );
  assert.equal(
    resolveStoredAnswerForField(
      { type: "options", optionLabels: ["Yes"] },
      {
        key: "55555555",
        question: "Choose one",
        kind: "single_select",
        category: "other",
        required: true,
        options: [
          { id: "66666666", label: "Yes" },
          { id: "77777777", label: "Yes" },
        ],
      },
    ),
    null,
    "answer memory must not choose the first of duplicate visible option labels",
  );

  console.log("Application answer planning verified: capability authorization, deterministic facts, safe answer-memory identity, user review gates, and idempotent persistence passed.");
}

main().catch((error: unknown) => {
  console.error("Application answer planning verification failed.");
  console.error(error);
  process.exitCode = 1;
});
