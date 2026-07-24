import type {
  ApplicationAnswerDecision,
  ApplicationAnswerPlan,
  ApplicationAnswerPlanRecord,
  ApplicationFieldDescriptor,
} from "@rapidapply/contracts";
import { and, eq } from "drizzle-orm";
import { createGroundedApplicationAnswer } from "../../ai/application-answer-provider";
import { planApplicationAnswer, validateApplicationAnswerShape } from "../../ai/application-answer-policy";
import { parseAutonomyPolicy } from "../../execution/autonomy-policy";
import type { ExecutorApplicationPlanInput } from "../../http/run-schemas";
import { getCandidateProfileForUserId } from "./candidate-profile-repository";
import { findReusableApplicationAnswer } from "./application-answer-memory-repository";
import { applicationAnswerPlans, applicationRuns, campaigns } from "../schema";
import { db } from "../client";
import { ExecutorEventCapabilityError, InvalidRunTransitionError } from "./run-repository";
import { executionTicketMatches, hasExecutionTicketExpired } from "../../execution/tickets";

export async function planExecutorApplicationAnswers(
  input: ExecutorApplicationPlanInput,
): Promise<{ plans: ApplicationAnswerPlanRecord[] }> {
  const [run] = await db.select().from(applicationRuns).where(eq(applicationRuns.id, input.runId)).limit(1);
  if (!run || !hasExecutorCapability(run, input)) throw new ExecutorEventCapabilityError();
  if (!["running", "needs_user_input", "paused"].includes(run.state)) {
    throw new InvalidRunTransitionError("This campaign is not active for application answer planning.");
  }

  const { profile } = await getCandidateProfileForUserId(run.userId);
  const [campaign] = await db.select({
    autonomyPolicyJson: campaigns.autonomyPolicyJson,
    targetRole: campaigns.targetRole,
  }).from(campaigns).where(eq(campaigns.id, run.campaignId)).limit(1);
  const autonomyPolicy = parseAutonomyPolicy(campaign?.autonomyPolicyJson);
  const now = new Date().toISOString();
  const records: ApplicationAnswerPlanRecord[] = [];

  for (const field of input.fields) {
    const descriptor = field as ApplicationFieldDescriptor;
    const existingDecision = await readExistingDecision({
      runId: input.runId,
      jobExternalId: input.jobExternalId,
      observationFingerprint: input.observationFingerprint,
      fieldKey: descriptor.key,
      field: descriptor,
    });
    // An answer already resolved for this exact observed form remains valid
    // regardless of mode: the candidate just made that decision. Reusing an
    // answer from a different form is separate consent, enabled only by Smart
    // Autopilot and only when the candidate marked that answer reusable.
    const approvedAnswer = existingDecision?.status === "resolved" || profile.autopilot.mode !== "smart"
      ? undefined
      : await findReusableApplicationAnswer({
          userId: run.userId,
          campaignId: run.campaignId,
          field: descriptor,
        });
    const aiEnabled = autonomyPolicy.freeTextStrategy === "ai_draft";
    const planned = planApplicationAnswer(descriptor, {
      profile,
      aiEnabled,
      hasJobDescription: Boolean(input.jobContext?.description),
      approvedAnswer,
    });
    let plan = planned.plan;
    let decision = existingDecision?.status === "resolved"
      ? existingDecision
      : planned.deterministicAnswer;

    if (
      !decision &&
      (planned.plan.strategy === "ai_text" || planned.plan.strategy === "ai_option")
    ) {
      const aiResult = await createGroundedApplicationAnswer({
        field: descriptor,
        profile,
        job: {
          ...input.jobContext,
          targetRole: input.jobContext?.targetRole ?? campaign?.targetRole,
        },
        confidenceThreshold: autonomyPolicy.aiConfidenceThreshold,
        requiresReview: autonomyPolicy.mode !== "autonomous",
      });
      if (aiResult.decision) {
        decision = aiResult.decision;
        plan = {
          ...plan,
          candidateFactIds: aiResult.decision.provenanceIds,
          requiresReview: aiResult.decision.requiresReview,
        };
      }
    }
    const record = toRecord({
      id: crypto.randomUUID(),
      runId: input.runId,
      jobExternalId: input.jobExternalId,
      observationFingerprint: input.observationFingerprint,
      field: descriptor,
      plan,
      // A just-answered field is already tied to this exact observed form.
      // Never let an ordinary re-observation replace that candidate answer
      // with a fresh "unknown" policy decision.
      decision,
      now,
    });

    await db.insert(applicationAnswerPlans).values({
      id: record.id,
      runId: record.runId,
      jobExternalId: record.jobExternalId,
      observationFingerprint: record.observationFingerprint,
      fieldKey: record.field.key,
      fieldJson: JSON.stringify(record.field),
      planJson: JSON.stringify(record.plan),
      decisionJson: record.decision ? JSON.stringify(record.decision) : null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        applicationAnswerPlans.runId,
        applicationAnswerPlans.jobExternalId,
        applicationAnswerPlans.observationFingerprint,
        applicationAnswerPlans.fieldKey,
      ],
      set: {
        fieldJson: JSON.stringify(record.field),
        planJson: JSON.stringify(record.plan),
        decisionJson: record.decision ? JSON.stringify(record.decision) : null,
        updatedAt: now,
      },
    });
    records.push(record);
  }

  return { plans: records };
}

async function readExistingDecision(input: {
  runId: string;
  jobExternalId: string;
  observationFingerprint: string;
  fieldKey: string;
  field: ApplicationFieldDescriptor;
}): Promise<ApplicationAnswerDecision | undefined> {
  const [row] = await db.select({ decisionJson: applicationAnswerPlans.decisionJson })
    .from(applicationAnswerPlans)
    .where(and(
      eq(applicationAnswerPlans.runId, input.runId),
      eq(applicationAnswerPlans.jobExternalId, input.jobExternalId),
      eq(applicationAnswerPlans.observationFingerprint, input.observationFingerprint),
      eq(applicationAnswerPlans.fieldKey, input.fieldKey),
    ))
    .limit(1);

  if (!row?.decisionJson) return undefined;
  try {
    const parsed: unknown = JSON.parse(row.decisionJson);
    if (!isResolvedDecisionForField(parsed, input.fieldKey)) return undefined;
    if (validateApplicationAnswerShape(input.field, parsed.answer).length > 0) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function isResolvedDecisionForField(
  value: unknown,
  fieldKey: string,
): value is Extract<ApplicationAnswerDecision, { status: "resolved" }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.status === "resolved" && record.fieldKey === fieldKey &&
    typeof record.answer === "object" && record.answer !== null && Array.isArray(record.provenanceIds);
}

function hasExecutorCapability(
  run: typeof applicationRuns.$inferSelect,
  input: ExecutorApplicationPlanInput,
): boolean {
  return run.executorSessionId === input.executorSessionId &&
    Boolean(run.executorEventTokenHash) &&
    Boolean(run.executorEventTokenExpiresAt) &&
    !hasExecutionTicketExpired(run.executorEventTokenExpiresAt!) &&
    executionTicketMatches(input.executorEventToken, run.executorEventTokenHash!);
}

function toRecord(input: {
  id: string;
  runId: string;
  jobExternalId: string;
  observationFingerprint: string;
  field: ApplicationFieldDescriptor;
  plan: ApplicationAnswerPlan;
  decision?: ApplicationAnswerDecision;
  now: string;
}): ApplicationAnswerPlanRecord {
  return {
    id: input.id,
    runId: input.runId,
    jobExternalId: input.jobExternalId,
    observationFingerprint: input.observationFingerprint,
    field: input.field,
    plan: input.plan,
    decision: input.decision,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
