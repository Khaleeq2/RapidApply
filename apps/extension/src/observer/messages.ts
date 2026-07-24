import {
  ADAPTER_PAGE_TYPES,
  APPLICATION_STEP_KINDS,
  OBSERVED_ACTION_KINDS,
  OBSERVED_CONTROL_KINDS,
  type AdapterObservation,
} from "../adapters/types";
import type { DiscoveredJobReference } from "@rapidapply/contracts";

export interface AdapterObservationMessage {
  type: "rapidapply.adapter-observation";
  observation: AdapterObservation;
}

export interface LinkedInSearchDiscoveryCommand {
  type: "rapidapply.discover-linkedin-search";
  runId: string;
  pageIndex: number;
  poolTarget: number;
}

export interface AdapterObservationResponse {
  ok: boolean;
  recorded?: boolean;
  reason?: string;
  command?: LinkedInSearchDiscoveryCommand;
  recoveredNavigationRace?: boolean;
}

export interface LinkedInSearchDiscoveryResultMessage {
  type: "rapidapply.linkedin-search-discovery";
  runId: string;
  pageIndex: number;
  cycles: number;
  jobs: DiscoveredJobReference[];
}

export interface RecordingStatusRequest {
  type: "rapidapply.recording-status";
}

export interface RecordingExportRequest {
  type: "rapidapply.recording-export";
  runId: string;
}

export interface RecordingClearRequest {
  type: "rapidapply.recording-clear";
  runId: string;
}

export function isAdapterObservationMessage(value: unknown): value is AdapterObservationMessage {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type", "observation"]) ||
    value.type !== "rapidapply.adapter-observation"
  ) return false;
  return isAdapterObservation(value.observation);
}

export function isLinkedInSearchDiscoveryCommand(
  value: unknown,
): value is LinkedInSearchDiscoveryCommand {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "runId", "pageIndex", "poolTarget"]) &&
    value.type === "rapidapply.discover-linkedin-search" &&
    isBoundedString(value.runId, 100) &&
    isBoundedInteger(value.pageIndex, 0, 7) &&
    isBoundedInteger(value.poolTarget, 1, 120)
  );
}

export function isLinkedInSearchDiscoveryResultMessage(
  value: unknown,
): value is LinkedInSearchDiscoveryResultMessage {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "runId", "pageIndex", "cycles", "jobs"]) &&
    value.type === "rapidapply.linkedin-search-discovery" &&
    isBoundedString(value.runId, 100) &&
    isBoundedInteger(value.pageIndex, 0, 7) &&
    isBoundedInteger(value.cycles, 0, 24) &&
    Array.isArray(value.jobs) &&
    value.jobs.length <= 100 &&
    value.jobs.every(isDiscoveredJobReference)
  );
}

export function isRecordingStatusRequest(value: unknown): value is RecordingStatusRequest {
  return isRecord(value) && value.type === "rapidapply.recording-status";
}

export function isRecordingExportRequest(value: unknown): value is RecordingExportRequest {
  return isRecord(value) && value.type === "rapidapply.recording-export" && isBoundedString(value.runId, 100);
}

export function isRecordingClearRequest(value: unknown): value is RecordingClearRequest {
  return isRecord(value) && value.type === "rapidapply.recording-clear" && isBoundedString(value.runId, 100);
}

function isAdapterObservation(value: unknown): value is AdapterObservation {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "adapterId",
      "adapterVersion",
      "observedAt",
      "pageType",
      "path",
      "queryKeys",
      "title",
      "fingerprint",
      "heading",
      "blockingReason",
      "applicationStep",
      "job",
      "fields",
      "actions",
      "validationMessages",
    ])
  ) return false;

  return (
    isBoundedString(value.adapterId, 60) &&
    isBoundedString(value.adapterVersion, 60) &&
    isIsoDate(value.observedAt) &&
    typeof value.pageType === "string" &&
    (ADAPTER_PAGE_TYPES as readonly string[]).includes(value.pageType) &&
    isBoundedString(value.path, 500) &&
    Array.isArray(value.queryKeys) &&
    value.queryKeys.length <= 40 &&
    value.queryKeys.every((key) => isBoundedString(key, 100)) &&
    typeof value.title === "string" && value.title.length <= 180 &&
    /^[a-f0-9]{8}$/.test(String(value.fingerprint)) &&
    (value.heading === undefined || isBoundedString(value.heading, 240)) &&
    (value.blockingReason === undefined || isBoundedString(value.blockingReason, 300)) &&
    (value.applicationStep === undefined ||
      (typeof value.applicationStep === "string" &&
        (APPLICATION_STEP_KINDS as readonly string[]).includes(value.applicationStep))) &&
    (value.job === undefined || isObservedJob(value.job)) &&
    Array.isArray(value.fields) && value.fields.length <= 80 &&
    value.fields.every(isObservedField) &&
    Array.isArray(value.actions) && value.actions.length <= 30 &&
    value.actions.every(isObservedAction) &&
    Array.isArray(value.validationMessages) &&
    value.validationMessages.length <= 20 &&
    value.validationMessages.every((message) => isBoundedString(message, 300))
  );
}

function isObservedField(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "key",
      "label",
      "control",
      "required",
      "disabled",
      "hasValue",
      "multiple",
      "constraints",
      "options",
      "validationMessage",
    ])
  ) return false;
  return (
    isBoundedString(value.key, 60) &&
    isBoundedString(value.label, 240) &&
    typeof value.control === "string" &&
    (OBSERVED_CONTROL_KINDS as readonly string[]).includes(value.control) &&
    typeof value.required === "boolean" &&
    typeof value.disabled === "boolean" &&
    typeof value.hasValue === "boolean" &&
    (value.multiple === undefined || typeof value.multiple === "boolean") &&
    (value.constraints === undefined || isObservedFieldConstraints(value.constraints)) &&
    (value.options === undefined ||
      (Array.isArray(value.options) &&
        value.options.length <= 300 &&
        value.options.every(isObservedOption))) &&
    (value.validationMessage === undefined || isBoundedString(value.validationMessage, 300))
  );
}

function isObservedFieldConstraints(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["minLength", "maxLength", "minimum", "maximum", "maxSelections"])
  ) return false;
  return (
    (value.minLength === undefined || isBoundedNonNegativeInteger(value.minLength)) &&
    (value.maxLength === undefined || isBoundedNonNegativeInteger(value.maxLength)) &&
    (value.minimum === undefined || isFiniteNumber(value.minimum)) &&
    (value.maximum === undefined || isFiniteNumber(value.maximum)) &&
    (value.maxSelections === undefined ||
      (Number.isInteger(value.maxSelections) && Number(value.maxSelections) >= 1 && Number(value.maxSelections) <= 100))
  );
}

function isBoundedNonNegativeInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100_000;
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function isObservedOption(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "label"]) &&
    /^[a-f0-9]{8}$/.test(String(value.id)) &&
    isBoundedString(value.label, 120)
  );
}

function isObservedAction(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["key", "name", "kind", "disabled"])
  ) return false;
  return (
    isBoundedString(value.key, 60) &&
    isBoundedString(value.name, 160) &&
    typeof value.kind === "string" &&
    (OBSERVED_ACTION_KINDS as readonly string[]).includes(value.kind) &&
    typeof value.disabled === "boolean"
  );
}

function isObservedJob(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["externalId", "title", "company", "location", "description"])) {
    return false;
  }
  return [value.externalId, value.title, value.company, value.location]
    .every((field) => field === undefined || isBoundedString(field, 240)) &&
    (value.description === undefined || isBoundedString(value.description, 8_000));
}

function isDiscoveredJobReference(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["externalId", "url", "title", "company", "location"]) ||
    !isBoundedString(value.externalId, 30) ||
    !/^\d+$/.test(value.externalId) ||
    !isLinkedInJobUrl(value.url, value.externalId)
  ) return false;

  return [value.title, value.company, value.location]
    .every((field) => field === undefined || isBoundedString(field, 240));
}

function isLinkedInJobUrl(value: unknown, externalId: string): boolean {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "www.linkedin.com" &&
      url.pathname === `/jobs/view/${externalId}/`
    );
  } catch {
    return false;
  }
}

function isIsoDate(value: unknown): boolean {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}
