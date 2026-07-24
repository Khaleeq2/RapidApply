import type {
  ApplicationIntervention,
  ApplicationInterventionResponse,
} from "@rapidapply/contracts";

export interface ShowApplicationInterventionCommand {
  type: "rapidapply.show-application-intervention";
  intervention: ApplicationIntervention;
}

export interface AnswerApplicationInterventionMessage {
  type: "rapidapply.answer-application-intervention";
  interventionId: string;
  response: ApplicationInterventionResponse;
}

export interface DeferApplicationInterventionMessage {
  type: "rapidapply.defer-application-intervention";
  interventionId: string;
}

export interface TouchApplicationInterventionMessage {
  type: "rapidapply.touch-application-intervention";
  interventionId: string;
}

export function isShowApplicationInterventionCommand(value: unknown): value is ShowApplicationInterventionCommand {
  return isRecord(value) && onlyKeys(value, ["type", "intervention"]) &&
    value.type === "rapidapply.show-application-intervention" && isIntervention(value.intervention);
}

export function isAnswerApplicationInterventionMessage(value: unknown): value is AnswerApplicationInterventionMessage {
  return isRecord(value) && onlyKeys(value, ["type", "interventionId", "response"]) &&
    value.type === "rapidapply.answer-application-intervention" && isId(value.interventionId) &&
    isResponse(value.response);
}

export function isDeferApplicationInterventionMessage(value: unknown): value is DeferApplicationInterventionMessage {
  return isRecord(value) && onlyKeys(value, ["type", "interventionId"]) &&
    value.type === "rapidapply.defer-application-intervention" && isId(value.interventionId);
}

export function isTouchApplicationInterventionMessage(value: unknown): value is TouchApplicationInterventionMessage {
  return isRecord(value) && onlyKeys(value, ["type", "interventionId"]) &&
    value.type === "rapidapply.touch-application-intervention" && isId(value.interventionId);
}

function isIntervention(value: unknown): value is ApplicationIntervention {
  return isRecord(value) && isId(value.id) && isId(value.runId) && typeof value.jobExternalId === "string" &&
    typeof value.jobUrl === "string" && typeof value.observationFingerprint === "string" &&
    ["pending", "answered", "deferred", "applied", "skipped"].includes(String(value.status)) &&
    isRecord(value.field) && typeof value.field.key === "string" && typeof value.field.question === "string" &&
    typeof value.field.kind === "string" && typeof value.field.category === "string" &&
    typeof value.field.required === "boolean" && Array.isArray(value.field.options);
}

function isResponse(value: unknown): value is ApplicationInterventionResponse {
  if (!isRecord(value) || !onlyKeys(value, ["answer", "rememberScope", "autoUse"]) || !isRecord(value.answer)) return false;
  const answer = value.answer;
  const validAnswer = (answer.type === "text" && typeof answer.text === "string" && answer.text.length <= 4_000) ||
    (answer.type === "checked" && typeof answer.checked === "boolean") ||
    (answer.type === "options" && Array.isArray(answer.optionIds) && answer.optionIds.length <= 20 && answer.optionIds.every(isFieldKey));
  return validAnswer &&
    (value.rememberScope === undefined || value.rememberScope === "global" || value.rememberScope === "campaign") &&
    (value.autoUse === undefined || typeof value.autoUse === "boolean");
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{8,64}$/i.test(value);
}

function isFieldKey(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}
