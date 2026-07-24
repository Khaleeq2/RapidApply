import type {
  ApplicationFieldConstraints,
  ExecutionCheckpoint,
} from "@rapidapply/contracts";

export const ADAPTER_PAGE_TYPES = [
  "login_required",
  "security_challenge",
  "search_results",
  "job_detail",
  "application_form",
  "application_review",
  "application_confirmation",
  "unsupported",
] as const;

export type AdapterPageType = (typeof ADAPTER_PAGE_TYPES)[number];

export const APPLICATION_STEP_KINDS = [
  "contact",
  "resume",
  "screening",
  "review",
  "unknown",
] as const;

export type ApplicationStepKind = (typeof APPLICATION_STEP_KINDS)[number];

export const OBSERVED_CONTROL_KINDS = [
  "text",
  "email",
  "tel",
  "number",
  "textarea",
  "select",
  "radio",
  "checkbox",
  "file",
  "other",
] as const;

export type ObservedControlKind = (typeof OBSERVED_CONTROL_KINDS)[number];

export interface ObservedOption {
  /** Opaque, deterministic ID used for constrained decisions; never the raw DOM value. */
  id: string;
  label: string;
}

export interface ObservedField {
  key: string;
  label: string;
  control: ObservedControlKind;
  required: boolean;
  disabled: boolean;
  hasValue: boolean;
  multiple?: boolean;
  constraints?: ApplicationFieldConstraints;
  options?: ObservedOption[];
  validationMessage?: string;
}

export const OBSERVED_ACTION_KINDS = [
  "open_application",
  "continue",
  "review",
  "submit",
  "dismiss",
  "other",
] as const;

export type ObservedActionKind = (typeof OBSERVED_ACTION_KINDS)[number];

export interface ObservedAction {
  key: string;
  name: string;
  kind: ObservedActionKind;
  disabled: boolean;
}

export interface ObservedJob {
  externalId?: string;
  title?: string;
  company?: string;
  location?: string;
  /** Bounded visible posting text used only as untrusted grounding evidence. */
  description?: string;
}

export interface AdapterObservation {
  adapterId: string;
  adapterVersion: string;
  observedAt: string;
  pageType: AdapterPageType;
  path: string;
  queryKeys: string[];
  title: string;
  fingerprint: string;
  heading?: string;
  blockingReason?: string;
  applicationStep?: ApplicationStepKind;
  job?: ObservedJob;
  fields: ObservedField[];
  actions: ObservedAction[];
  validationMessages: string[];
}

export interface AdapterInspectionContext {
  document: Document;
  url: URL;
  observedAt?: string;
}

export interface SiteAdapter {
  id: string;
  version: string;
  matches(url: URL): boolean;
  inspect(context: AdapterInspectionContext): AdapterObservation;
  checkpoint(observation: AdapterObservation): ExecutionCheckpoint;
}
