import type {
  ApplicationAnswerPlanRecord,
  ApplicationIntervention,
  ApplicationInterventionResponse,
  ExtensionExecutionSession,
} from "@rapidapply/contracts";

interface InterventionBaseInput {
  session: ExtensionExecutionSession;
  interventionId: string;
}

export async function requestApplicationInterventions(input: {
  session: ExtensionExecutionSession;
  jobExternalId: string;
  observationFingerprint: string;
  jobUrl: string;
  jobTitle?: string;
  company?: string;
}): Promise<{ interventions: ApplicationIntervention[]; active?: ApplicationIntervention }> {
  const response = await fetch(new URL("/api/executor/interventions", input.session.controllerOrigin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: input.session.runId,
      executorSessionId: input.session.executorSessionId,
      executorEventToken: input.session.executorEventCapability.token,
      jobExternalId: input.jobExternalId,
      observationFingerprint: input.observationFingerprint,
      jobUrl: input.jobUrl,
      jobTitle: input.jobTitle,
      company: input.company,
    }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isInterventionListResponse(payload)) {
    throw new Error("RapidApply could not save this application question.");
  }
  return payload;
}

export async function deferExecutorJob(input: {
  session: ExtensionExecutionSession;
  jobExternalId: string;
  url: string;
  title: string;
  company: string;
  reasonCode: string;
  reasonDetails?: string;
}): Promise<void> {
  const response = await fetch(new URL("/api/executor/defer-job", input.session.controllerOrigin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: input.session.runId,
      executorSessionId: input.session.executorSessionId,
      executorEventToken: input.session.executorEventCapability.token,
      jobExternalId: input.jobExternalId,
      url: input.url,
      title: input.title,
      company: input.company,
      reasonCode: input.reasonCode,
      reasonDetails: input.reasonDetails,
    }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(payload) || payload.ok !== true) {
    throw new Error("RapidApply could not add this application to the finish-later queue.");
  }
}

export async function answerApplicationIntervention(
  input: InterventionBaseInput & { response: ApplicationInterventionResponse },
): Promise<{ intervention: ApplicationIntervention; plan: ApplicationAnswerPlanRecord; next?: ApplicationIntervention }> {
  const payload = await postInterventionAction(input, { action: "answer", response: input.response });
  if (!isAnsweredInterventionResponse(payload)) {
    throw new Error("RapidApply could not save that application answer.");
  }
  return payload;
}

export async function deferApplicationIntervention(
  input: InterventionBaseInput,
): Promise<{ intervention: ApplicationIntervention; next?: ApplicationIntervention }> {
  const payload = await postInterventionAction(input, { action: "defer" });
  if (!isDeferredInterventionResponse(payload)) {
    throw new Error("RapidApply could not defer that application question.");
  }
  return payload;
}

export async function touchApplicationIntervention(
  input: InterventionBaseInput,
): Promise<ApplicationIntervention> {
  const payload = await postInterventionAction(input, { action: "touch" });
  if (!isTouchInterventionResponse(payload)) {
    throw new Error("RapidApply could not extend the application question timer.");
  }
  return payload.intervention;
}

async function postInterventionAction(
  input: InterventionBaseInput,
  action: { action: "answer"; response: ApplicationInterventionResponse } | { action: "defer" | "touch" },
): Promise<unknown> {
  const response = await fetch(
    new URL(`/api/executor/interventions/${encodeURIComponent(input.interventionId)}`, input.session.controllerOrigin),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: input.session.runId,
        executorSessionId: input.session.executorSessionId,
        executorEventToken: input.session.executorEventCapability.token,
        ...action,
      }),
    },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error("RapidApply could not update that application question.");
  return payload;
}

function isInterventionListResponse(value: unknown): value is {
  interventions: ApplicationIntervention[];
  active?: ApplicationIntervention;
} {
  return isRecord(value) && Array.isArray(value.interventions) && value.interventions.every(isApplicationIntervention) &&
    (value.active === undefined || isApplicationIntervention(value.active));
}

function isAnsweredInterventionResponse(value: unknown): value is {
  intervention: ApplicationIntervention;
  plan: ApplicationAnswerPlanRecord;
  next?: ApplicationIntervention;
} {
  return isRecord(value) && isApplicationIntervention(value.intervention) && isApplicationAnswerPlanRecord(value.plan) &&
    (value.next === undefined || isApplicationIntervention(value.next));
}

function isDeferredInterventionResponse(value: unknown): value is {
  intervention: ApplicationIntervention;
  next?: ApplicationIntervention;
} {
  return isRecord(value) && isApplicationIntervention(value.intervention) &&
    (value.next === undefined || isApplicationIntervention(value.next));
}

function isTouchInterventionResponse(value: unknown): value is { intervention: ApplicationIntervention } {
  return isRecord(value) && isApplicationIntervention(value.intervention);
}

function isApplicationIntervention(value: unknown): value is ApplicationIntervention {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.runId !== "string" ||
    typeof value.jobExternalId !== "string" || typeof value.jobUrl !== "string" ||
    typeof value.observationFingerprint !== "string" || typeof value.status !== "string" ||
    !isField(value.field)) return false;
  return ["pending", "answered", "deferred", "applied", "skipped"].includes(value.status);
}

function isApplicationAnswerPlanRecord(value: unknown): value is ApplicationAnswerPlanRecord {
  return isRecord(value) && typeof value.id === "string" && typeof value.runId === "string" &&
    typeof value.jobExternalId === "string" && typeof value.observationFingerprint === "string" &&
    isField(value.field) && isRecord(value.plan);
}

function isField(value: unknown): boolean {
  return isRecord(value) && typeof value.key === "string" && typeof value.question === "string" &&
    typeof value.kind === "string" && typeof value.category === "string" && typeof value.required === "boolean" &&
    Array.isArray(value.options);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
