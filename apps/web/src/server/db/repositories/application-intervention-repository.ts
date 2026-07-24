import {
  APPLICATION_QUESTION_CATEGORIES,
  type ApplicationAnswerDecision,
  type ApplicationAnswerPlan,
  type ApplicationAnswerPlanRecord,
  type ApplicationAnswerValue,
  type ApplicationFieldDescriptor,
  type ApplicationIntervention,
  type ApplicationInterventionResponse,
  type ApplicationInterventionStatus,
  type ApplicationQuestionCategory,
} from "@rapidapply/contracts";
import { and, asc, eq } from "drizzle-orm";
import { validateApplicationAnswerShape } from "../../ai/application-answer-policy";
import { parseAutonomyPolicy } from "../../execution/autonomy-policy";
import { getCandidateProfileForUserId } from "./candidate-profile-repository";
import { saveApplicationAnswerMemory } from "./application-answer-memory-repository";
import { db } from "../client";
import {
  applicationAnswerPlans,
  applicationInterventions,
  applicationRuns,
  campaigns,
} from "../schema";
import { ExecutorEventCapabilityError, InvalidRunTransitionError } from "./run-repository";
import { executionTicketMatches, hasExecutionTicketExpired } from "../../execution/tickets";

export class ApplicationInterventionNotFoundError extends Error {
  constructor() {
    super("Application question not found.");
    this.name = "ApplicationInterventionNotFoundError";
  }
}

export interface ExecutorInterventionAuthority {
  runId: string;
  executorSessionId: string;
  executorEventToken: string;
}

export interface CreateApplicationInterventionsInput extends ExecutorInterventionAuthority {
  jobExternalId: string;
  observationFingerprint: string;
  jobUrl: string;
  jobTitle?: string;
  company?: string;
}

export async function createApplicationInterventions(
  input: CreateApplicationInterventionsInput,
): Promise<{ interventions: ApplicationIntervention[]; active?: ApplicationIntervention }> {
  const run = await getExecutorAuthorizedRun(input);
  const { profile } = await getCandidateProfileForUserId(run.userId);
  const [campaign] = await db.select({ autonomyPolicyJson: campaigns.autonomyPolicyJson })
    .from(campaigns)
    .where(eq(campaigns.id, run.campaignId))
    .limit(1);
  const autonomyPolicy = parseAutonomyPolicy(campaign?.autonomyPolicyJson);
  const plans = await readPlanRecords(input.runId, input.jobExternalId, input.observationFingerprint);
  const now = new Date().toISOString();

  await deferExpiredPendingInterventions({ userId: run.userId, runId: input.runId, now });

  for (const record of plans) {
    if (record.decision?.status === "resolved" && !record.decision.requiresReview) continue;
    const skipOptional = !record.field.required && profile.autopilot.autoSkipOptionalFields;
    const skipForFreeText = autonomyPolicy.mode === "autonomous" &&
      autonomyPolicy.freeTextStrategy === "skip_job" &&
      (record.field.category === "open_text" || record.field.kind === "textarea");
    const autonomousDisposition = skipForFreeText
      ? "skipped"
      : autonomyPolicy.mode === "autonomous" &&
          autonomyPolicy.unknownFieldStrategy !== "pause_campaign"
        ? autonomyPolicy.unknownFieldStrategy === "skip_job" ? "skipped" : "deferred"
        : "pending";
    const status: ApplicationInterventionStatus = skipOptional ? "skipped" : autonomousDisposition;

    await db.insert(applicationInterventions).values({
      id: crypto.randomUUID(),
      runId: input.runId,
      userId: run.userId,
      jobExternalId: input.jobExternalId,
      jobUrl: input.jobUrl,
      jobTitle: input.jobTitle ?? null,
      company: input.company ?? null,
      observationFingerprint: input.observationFingerprint,
      fieldKey: record.field.key,
      fieldJson: JSON.stringify(record.field),
      status,
      deferredAt: status === "deferred" ? now : null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        applicationInterventions.runId,
        applicationInterventions.jobExternalId,
        applicationInterventions.observationFingerprint,
        applicationInterventions.fieldKey,
      ],
      set: {
        jobUrl: input.jobUrl,
        jobTitle: input.jobTitle ?? null,
        company: input.company ?? null,
        updatedAt: now,
      },
    });
  }

  const interventions = await listRunInterventionsForUser(run.userId, input.runId);
  const active = await activateFirstPendingIntervention({
    userId: run.userId,
    runId: input.runId,
    profileTimeoutSeconds: profile.autopilot.questionTimeoutSeconds,
  });
  return { interventions, active };
}

export async function listApplicationInterventionsForUser(userId: string): Promise<ApplicationIntervention[]> {
  const rows = await db.select().from(applicationInterventions)
    .where(eq(applicationInterventions.userId, userId))
    .orderBy(asc(applicationInterventions.createdAt));
  return rows.map(toIntervention).filter((value): value is ApplicationIntervention => value !== null);
}

export async function listRunInterventionsForUser(
  userId: string,
  runId: string,
): Promise<ApplicationIntervention[]> {
  const rows = await db.select().from(applicationInterventions)
    .where(and(eq(applicationInterventions.userId, userId), eq(applicationInterventions.runId, runId)))
    .orderBy(asc(applicationInterventions.createdAt));
  return rows.map(toIntervention).filter((value): value is ApplicationIntervention => value !== null);
}

export async function resolveApplicationInterventionForUser(input: {
  userId: string;
  interventionId: string;
  response: ApplicationInterventionResponse;
}): Promise<{ intervention: ApplicationIntervention; plan: ApplicationAnswerPlanRecord; next?: ApplicationIntervention }> {
  const loaded = await loadIntervention(input.interventionId);
  if (!loaded || loaded.userId !== input.userId) throw new ApplicationInterventionNotFoundError();
  return resolveLoadedIntervention(loaded, input.response);
}

export async function resolveApplicationInterventionForExecutor(input: ExecutorInterventionAuthority & {
  interventionId: string;
  response: ApplicationInterventionResponse;
}): Promise<{ intervention: ApplicationIntervention; plan: ApplicationAnswerPlanRecord; next?: ApplicationIntervention }> {
  const run = await getExecutorAuthorizedRun(input);
  const loaded = await loadIntervention(input.interventionId);
  if (!loaded || loaded.userId !== run.userId || loaded.runId !== input.runId) {
    throw new ApplicationInterventionNotFoundError();
  }
  return resolveLoadedIntervention(loaded, input.response);
}

export async function deferApplicationInterventionForExecutor(input: ExecutorInterventionAuthority & {
  interventionId: string;
}): Promise<{ intervention: ApplicationIntervention; next?: ApplicationIntervention }> {
  const run = await getExecutorAuthorizedRun(input);
  const loaded = await loadIntervention(input.interventionId);
  if (!loaded || loaded.userId !== run.userId || loaded.runId !== input.runId) {
    throw new ApplicationInterventionNotFoundError();
  }

  const now = new Date().toISOString();
  await db.update(applicationInterventions)
    .set({ status: "deferred", deadlineAt: null, deferredAt: now, updatedAt: now })
    .where(eq(applicationInterventions.id, input.interventionId));
  const deferred = await loadIntervention(input.interventionId);
  if (!deferred) throw new ApplicationInterventionNotFoundError();
  const intervention = toIntervention(deferred);
  if (!intervention) throw new ApplicationInterventionNotFoundError();
  const { profile } = await getCandidateProfileForUserId(run.userId);
  const next = await activateFirstPendingIntervention({
    userId: run.userId,
    runId: input.runId,
    profileTimeoutSeconds: profile.autopilot.questionTimeoutSeconds,
  });
  return { intervention, next };
}

/**
 * A visible answer helper periodically touches its deadline while the
 * candidate is actively typing. That makes the countdown recoverable across
 * a page or service-worker restart without storing a long-lived "paused"
 * state in the browser.
 */
export async function touchApplicationInterventionForExecutor(input: ExecutorInterventionAuthority & {
  interventionId: string;
}): Promise<ApplicationIntervention> {
  const run = await getExecutorAuthorizedRun(input);
  const loaded = await loadIntervention(input.interventionId);
  if (!loaded || loaded.userId !== run.userId || loaded.runId !== input.runId || loaded.status !== "pending") {
    throw new ApplicationInterventionNotFoundError();
  }
  const field = parseField(loaded.fieldJson);
  if (!field) throw new ApplicationInterventionNotFoundError();

  const { profile } = await getCandidateProfileForUserId(run.userId);
  const now = new Date();
  const deadlineAt = new Date(
    now.getTime() + timeoutMilliseconds(field, profile.autopilot.questionTimeoutSeconds),
  ).toISOString();
  await db.update(applicationInterventions)
    .set({ deadlineAt, updatedAt: now.toISOString() })
    .where(eq(applicationInterventions.id, loaded.id));
  const refreshed = await loadIntervention(loaded.id);
  const intervention = refreshed ? toIntervention(refreshed) : null;
  if (!intervention) throw new ApplicationInterventionNotFoundError();
  return intervention;
}

export async function getApplicationInterventionForExecutor(input: ExecutorInterventionAuthority & {
  interventionId: string;
}): Promise<ApplicationIntervention> {
  const run = await getExecutorAuthorizedRun(input);
  const loaded = await loadIntervention(input.interventionId);
  if (!loaded || loaded.userId !== run.userId || loaded.runId !== input.runId) {
    throw new ApplicationInterventionNotFoundError();
  }
  const intervention = toIntervention(loaded);
  if (!intervention) throw new ApplicationInterventionNotFoundError();
  return intervention;
}

async function resolveLoadedIntervention(
  loaded: typeof applicationInterventions.$inferSelect,
  response: ApplicationInterventionResponse,
): Promise<{ intervention: ApplicationIntervention; plan: ApplicationAnswerPlanRecord; next?: ApplicationIntervention }> {
  const field = parseField(loaded.fieldJson);
  if (!field) throw new ApplicationInterventionNotFoundError();
  const issues = validateApplicationAnswerShape(field, response.answer);
  if (issues.length > 0) {
    throw new InvalidRunTransitionError("The supplied answer does not match the current application field.");
  }

  const run = await getRun(loaded.runId);
  if (!run) throw new ApplicationInterventionNotFoundError();
  const now = new Date().toISOString();
  const decision: ApplicationAnswerDecision = {
    status: "resolved",
    fieldKey: field.key,
    source: "user",
    answer: response.answer,
    provenanceIds: [`intervention:${loaded.id}`],
    requiresReview: false,
  };

  await db.transaction(async (transaction) => {
    await transaction.update(applicationInterventions)
      .set({
        status: "answered",
        answerJson: JSON.stringify(response.answer),
        rememberScope: response.rememberScope ?? null,
        autoUse: response.autoUse ?? Boolean(response.rememberScope),
        deadlineAt: null,
        answeredAt: now,
        updatedAt: now,
      })
      .where(eq(applicationInterventions.id, loaded.id));

    await transaction.update(applicationAnswerPlans)
      .set({ decisionJson: JSON.stringify(decision), updatedAt: now })
      .where(and(
        eq(applicationAnswerPlans.runId, loaded.runId),
        eq(applicationAnswerPlans.jobExternalId, loaded.jobExternalId),
        eq(applicationAnswerPlans.observationFingerprint, loaded.observationFingerprint),
        eq(applicationAnswerPlans.fieldKey, loaded.fieldKey),
      ));
  });

  if (response.rememberScope) {
    await saveApplicationAnswerMemory({
      userId: loaded.userId,
      campaignId: run.campaignId,
      scope: response.rememberScope,
      field,
      answer: response.answer,
      autoUse: response.autoUse ?? true,
    });
  }

  const interventionRow = await loadIntervention(loaded.id);
  const plan = await readPlanRecord({
    runId: loaded.runId,
    jobExternalId: loaded.jobExternalId,
    observationFingerprint: loaded.observationFingerprint,
    fieldKey: loaded.fieldKey,
  });
  if (!interventionRow || !plan) throw new ApplicationInterventionNotFoundError();
  const intervention = toIntervention(interventionRow);
  if (!intervention) throw new ApplicationInterventionNotFoundError();

  const { profile } = await getCandidateProfileForUserId(loaded.userId);
  const next = await activateFirstPendingIntervention({
    userId: loaded.userId,
    runId: loaded.runId,
    profileTimeoutSeconds: profile.autopilot.questionTimeoutSeconds,
  });
  return { intervention, plan, next };
}

async function activateFirstPendingIntervention(input: {
  userId: string;
  runId: string;
  profileTimeoutSeconds: 15 | 30 | 60;
}): Promise<ApplicationIntervention | undefined> {
  await deferExpiredPendingInterventions({
    userId: input.userId,
    runId: input.runId,
    now: new Date().toISOString(),
  });
  const rows = await db.select().from(applicationInterventions)
    .where(and(
      eq(applicationInterventions.userId, input.userId),
      eq(applicationInterventions.runId, input.runId),
      eq(applicationInterventions.status, "pending"),
    ))
    .orderBy(asc(applicationInterventions.createdAt));
  const first = rows[0];
  if (!first) return undefined;

  const field = parseField(first.fieldJson);
  if (!field) return undefined;
  const now = new Date();
  const deadlineAt = new Date(now.getTime() + timeoutMilliseconds(field, input.profileTimeoutSeconds)).toISOString();

  if (!first.deadlineAt || Date.parse(first.deadlineAt) < now.getTime()) {
    await db.update(applicationInterventions)
      .set({ deadlineAt, updatedAt: now.toISOString() })
      .where(eq(applicationInterventions.id, first.id));
  }

  const active = await loadIntervention(first.id);
  const result = active ? toIntervention(active) : null;
  return result ?? undefined;
}

async function deferExpiredPendingInterventions(input: {
  userId: string;
  runId: string;
  now: string;
}): Promise<void> {
  const rows = await db.select({ id: applicationInterventions.id, deadlineAt: applicationInterventions.deadlineAt })
    .from(applicationInterventions)
    .where(and(
      eq(applicationInterventions.userId, input.userId),
      eq(applicationInterventions.runId, input.runId),
      eq(applicationInterventions.status, "pending"),
    ));
  const nowMs = Date.parse(input.now);
  const expiredIds = rows
    .filter((row) => row.deadlineAt && Date.parse(row.deadlineAt) <= nowMs)
    .map((row) => row.id);

  for (const id of expiredIds) {
    await db.update(applicationInterventions)
      .set({ status: "deferred", deadlineAt: null, deferredAt: input.now, updatedAt: input.now })
      .where(eq(applicationInterventions.id, id));
  }
}

function timeoutMilliseconds(field: ApplicationFieldDescriptor, baseSeconds: 15 | 30 | 60): number {
  const minimum = field.category === "open_text" || field.kind === "textarea"
    ? 60
    : field.category === "security_clearance" || field.category === "legal_attestation"
      ? 30
      : 15;
  return Math.max(baseSeconds, minimum) * 1_000;
}

async function getExecutorAuthorizedRun(input: ExecutorInterventionAuthority) {
  const run = await getRun(input.runId);
  if (!run || !hasExecutorCapability(run, input)) throw new ExecutorEventCapabilityError();
  if (!["running", "needs_user_input", "paused"].includes(run.state)) {
    throw new InvalidRunTransitionError("This campaign is not active for application questions.");
  }
  return run;
}

function hasExecutorCapability(
  run: typeof applicationRuns.$inferSelect,
  input: ExecutorInterventionAuthority,
): boolean {
  return run.executorSessionId === input.executorSessionId &&
    Boolean(run.executorEventTokenHash) &&
    Boolean(run.executorEventTokenExpiresAt) &&
    !hasExecutionTicketExpired(run.executorEventTokenExpiresAt!) &&
    executionTicketMatches(input.executorEventToken, run.executorEventTokenHash!);
}

async function getRun(runId: string) {
  const [run] = await db.select().from(applicationRuns).where(eq(applicationRuns.id, runId)).limit(1);
  return run;
}

async function loadIntervention(id: string) {
  const [row] = await db.select().from(applicationInterventions)
    .where(eq(applicationInterventions.id, id)).limit(1);
  return row;
}

async function readPlanRecords(
  runId: string,
  jobExternalId: string,
  observationFingerprint: string,
): Promise<ApplicationAnswerPlanRecord[]> {
  const rows = await db.select().from(applicationAnswerPlans).where(and(
    eq(applicationAnswerPlans.runId, runId),
    eq(applicationAnswerPlans.jobExternalId, jobExternalId),
    eq(applicationAnswerPlans.observationFingerprint, observationFingerprint),
  )).orderBy(asc(applicationAnswerPlans.createdAt));
  return rows.map(toPlanRecord).filter((value): value is ApplicationAnswerPlanRecord => value !== null);
}

async function readPlanRecord(input: {
  runId: string;
  jobExternalId: string;
  observationFingerprint: string;
  fieldKey: string;
}): Promise<ApplicationAnswerPlanRecord | null> {
  const [row] = await db.select().from(applicationAnswerPlans).where(and(
    eq(applicationAnswerPlans.runId, input.runId),
    eq(applicationAnswerPlans.jobExternalId, input.jobExternalId),
    eq(applicationAnswerPlans.observationFingerprint, input.observationFingerprint),
    eq(applicationAnswerPlans.fieldKey, input.fieldKey),
  )).limit(1);
  return row ? toPlanRecord(row) : null;
}

function toPlanRecord(row: typeof applicationAnswerPlans.$inferSelect): ApplicationAnswerPlanRecord | null {
  const field = parseField(row.fieldJson);
  const plan = parsePlan(row.planJson);
  if (!field || !plan) return null;
  const decision = parseDecision(row.decisionJson);
  return {
    id: row.id,
    runId: row.runId,
    jobExternalId: row.jobExternalId,
    observationFingerprint: row.observationFingerprint,
    field,
    plan,
    decision: decision ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toIntervention(row: typeof applicationInterventions.$inferSelect): ApplicationIntervention | null {
  const field = parseField(row.fieldJson);
  const status = asInterventionStatus(row.status);
  if (!field || !status) return null;
  const answer = parseAnswer(row.answerJson);
  return {
    id: row.id,
    runId: row.runId,
    jobExternalId: row.jobExternalId,
    jobUrl: row.jobUrl,
    jobTitle: row.jobTitle ?? undefined,
    company: row.company ?? undefined,
    observationFingerprint: row.observationFingerprint,
    field,
    status,
    deadlineAt: row.deadlineAt ?? undefined,
    answer: answer ?? undefined,
    rememberScope: row.rememberScope === "global" || row.rememberScope === "campaign"
      ? row.rememberScope
      : undefined,
    autoUse: row.autoUse ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    answeredAt: row.answeredAt ?? undefined,
    deferredAt: row.deferredAt ?? undefined,
  };
}

function parseField(value: string): ApplicationFieldDescriptor | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.key !== "string" || typeof parsed.question !== "string") return null;
    if (!isFieldKind(parsed.kind) || !isQuestionCategory(parsed.category) || typeof parsed.required !== "boolean") return null;
    if (!Array.isArray(parsed.options) || !parsed.options.every(isOption)) return null;
    return {
      key: parsed.key,
      question: parsed.question,
      kind: parsed.kind,
      category: parsed.category,
      required: parsed.required,
      options: parsed.options,
      constraints: isRecord(parsed.constraints) ? parsed.constraints : undefined,
    } as ApplicationFieldDescriptor;
  } catch {
    return null;
  }
}

function parsePlan(value: string): ApplicationAnswerPlan | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.strategy !== "string" || typeof parsed.reason !== "string") return null;
    if (!Array.isArray(parsed.candidateFactIds) || !parsed.candidateFactIds.every((id) => typeof id === "string")) return null;
    if (typeof parsed.requiresReview !== "boolean") return null;
    return parsed as unknown as ApplicationAnswerPlan;
  } catch {
    return null;
  }
}

function parseDecision(value: string | null): ApplicationAnswerDecision | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.status !== "string" || typeof parsed.fieldKey !== "string") return null;
    if (parsed.status === "resolved" && parseAnswerObject(parsed.answer) && Array.isArray(parsed.provenanceIds)) {
      return parsed as unknown as ApplicationAnswerDecision;
    }
    if (["needs_user_input", "unsupported"].includes(parsed.status) && typeof parsed.reason === "string") {
      return parsed as unknown as ApplicationAnswerDecision;
    }
  } catch {
    // Invalid persisted decisions are ignored rather than sent to a browser.
  }
  return null;
}

function parseAnswer(value: string | null): ApplicationAnswerValue | null {
  if (!value) return null;
  try {
    return parseAnswerObject(JSON.parse(value));
  } catch {
    return null;
  }
}

function parseAnswerObject(value: unknown): ApplicationAnswerValue | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "text" && typeof value.text === "string") return { type: "text", text: value.text };
  if (value.type === "checked" && typeof value.checked === "boolean") return { type: "checked", checked: value.checked };
  if (value.type === "options" && Array.isArray(value.optionIds) && value.optionIds.every((id) => typeof id === "string")) {
    return { type: "options", optionIds: value.optionIds };
  }
  return null;
}

function asInterventionStatus(value: string): ApplicationInterventionStatus | null {
  return ["pending", "answered", "deferred", "applied", "skipped"].includes(value)
    ? value as ApplicationInterventionStatus
    : null;
}

function isFieldKind(value: unknown): value is ApplicationFieldDescriptor["kind"] {
  return ["text", "textarea", "number", "single_select", "multi_select", "radio", "checkbox"].includes(String(value));
}

function isQuestionCategory(value: unknown): value is ApplicationQuestionCategory {
  return (APPLICATION_QUESTION_CATEGORIES as readonly string[]).includes(String(value));
}

function isOption(value: unknown): value is ApplicationFieldDescriptor["options"][number] {
  return isRecord(value) && typeof value.id === "string" && typeof value.label === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
