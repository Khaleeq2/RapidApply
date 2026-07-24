import { normalizeText, stableFingerprint } from "../fingerprint";
import {
  findLinkedInApplicationContainer,
  findLinkedInApplicationControls,
  isLinkedInElementVisible,
} from "./application-container";
import type {
  AdapterInspectionContext,
  AdapterObservation,
  AdapterPageType,
  ApplicationStepKind,
  ObservedAction,
  ObservedActionKind,
  ObservedControlKind,
  ObservedField,
  ObservedJob,
  ObservedOption,
  SiteAdapter,
} from "../types";

const ADAPTER_ID = "linkedin";
const ADAPTER_VERSION = "observer-2";
const MAX_FIELDS = 80;
const MAX_ACTIONS = 30;
// Country, dialing-code, and location selects commonly exceed 200 entries.
// Keep the payload bounded while preserving a complete country-scale control.
const MAX_OPTIONS = 300;

type LinkedInApplicationControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export interface LinkedInObservedFieldBinding {
  field: ObservedField;
  controls: LinkedInApplicationControl[];
}

export const linkedinObserverAdapter: SiteAdapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,
  matches(url) {
    return url.protocol === "https:" && url.hostname === "www.linkedin.com";
  },
  inspect(context) {
    return inspectLinkedInPage(context);
  },
  checkpoint(observation) {
    return {
      name: `${observation.adapterId}:${observation.pageType}:${observation.fingerprint}`,
      attempt: 1,
      updatedAt: observation.observedAt,
    };
  },
};

export function inspectLinkedInPage({
  document,
  url,
  observedAt = new Date().toISOString(),
}: AdapterInspectionContext): AdapterObservation {
  const bodyText = normalizeText(document.body?.innerText ?? document.body?.textContent, 20_000).toLowerCase();
  const dialog = findLinkedInApplicationContainer(document);
  const dialogText = dialog
    ? normalizeText((dialog as HTMLElement).innerText ?? dialog.textContent, 20_000).toLowerCase()
    : "";
  const pageType = detectPageType(document, url, bodyText, dialog, dialogText);
  const fields = dialog ? observeFields(dialog) : [];
  const actions = observeActions(dialog ?? document);
  const validationMessages = dialog ? observeValidationMessages(dialog) : [];
  const heading = findHeading(dialog ?? document);
  const applicationStep = dialog ? detectApplicationStep(heading, dialogText, actions) : undefined;
  const job = [
    "job_detail",
    "search_results",
    "application_form",
    "application_review",
    "application_confirmation",
  ].includes(pageType)
    ? observeJob(document, url)
    : {};
  const blockingReason = detectBlockingReason(pageType);
  const queryKeys = [...new Set(url.searchParams.keys())].sort().slice(0, 40);

  const fingerprint = stableFingerprint({
    pageType,
    path: url.pathname,
    heading,
    applicationStep,
    job,
    fields: fields.map(({ key, required, disabled, hasValue, multiple, constraints, validationMessage }) => ({
      key,
      required,
      disabled,
      hasValue,
      multiple,
      constraints,
      validationMessage,
    })),
    actions: actions.map(({ key, disabled }) => ({ key, disabled })),
    validationMessages,
  });

  return {
    adapterId: ADAPTER_ID,
    adapterVersion: ADAPTER_VERSION,
    observedAt,
    pageType,
    path: url.pathname,
    queryKeys,
    title: normalizeText(document.title, 180),
    fingerprint,
    heading: heading || undefined,
    blockingReason,
    applicationStep,
    job: hasJobData(job) ? job : undefined,
    fields,
    actions,
    validationMessages,
  };
}

function detectPageType(
  document: Document,
  url: URL,
  bodyText: string,
  dialog: Element | null,
  dialogText: string,
): AdapterPageType {
  if (
    url.pathname.startsWith("/checkpoint/") ||
    url.pathname.startsWith("/authwall") ||
    bodyText.includes("security verification") ||
    bodyText.includes("verify it’s you") ||
    bodyText.includes("verify it's you")
  ) {
    return "security_challenge";
  }

  if (
    url.pathname.startsWith("/login") ||
    document.querySelector("input[type='password'], input[autocomplete='current-password']")
  ) {
    return "login_required";
  }

  if (
    bodyText.includes("application submitted") ||
    bodyText.includes("application was sent") ||
    bodyText.includes("your application was sent")
  ) {
    return "application_confirmation";
  }

  if (dialog) {
    const actions = observeActions(dialog);
    const heading = findHeading(dialog);
    const step = detectApplicationStep(heading, dialogText, actions);
    // LinkedIn can render the final Submit button on the same surface as
    // required contact/resume controls. A Submit button alone is not proof
    // that the application is ready for review: keep the surface in the form
    // phase until every required control and the resume input are satisfied.
    return step === "review" && !hasUnfilledRequiredApplicationControl(dialog)
      ? "application_review"
      : "application_form";
  }

  if (url.pathname.startsWith("/jobs/search")) return "search_results";

  if (
    url.pathname.startsWith("/jobs/view/") ||
    document.querySelector("[data-job-id], .jobs-unified-top-card, .job-details-jobs-unified-top-card")
  ) {
    return "job_detail";
  }

  return "unsupported";
}

function hasUnfilledRequiredApplicationControl(root: Element): boolean {
  return findLinkedInApplicationControls(root).some((element) => {
    if (element.disabled || element.getAttribute("aria-disabled") === "true") return false;
    const required = element.required || element.getAttribute("aria-required") === "true";
    const isResumeInput = element instanceof HTMLInputElement && element.type === "file";
    return (required || isResumeInput) && !controlHasValue(element);
  });
}

function observeFields(root: Element): ObservedField[] {
  return observeLinkedInApplicationFieldBindings(root).map((binding) => binding.field);
}

/**
 * Produces the semantic field and its exact live controls in one pass. The
 * executor consumes this binding instead of attempting to reconstruct a
 * relationship from two independently indexed arrays.
 */
export function observeLinkedInApplicationFieldBindings(
  root: Element,
): LinkedInObservedFieldBinding[] {
  const controls = findLinkedInApplicationControls(root);
  const bindings: LinkedInObservedFieldBinding[] = [];
  const processedGroupedControls = new Set<HTMLInputElement>();

  for (let index = 0; index < controls.length && bindings.length < MAX_FIELDS; index += 1) {
    const element = controls[index];
    if (!element) continue;

    if (element instanceof HTMLInputElement && ["radio", "checkbox"].includes(element.type)) {
      if (processedGroupedControls.has(element)) continue;
      const groupName = element.getAttribute("name") ?? "";
      const fieldset = element.closest("fieldset, [role='radiogroup'], .jobs-easy-apply-form-element, .fb-dash-form-element");
      const groupInputs = groupName
        ? [...root.querySelectorAll<HTMLInputElement>("input[type='radio'], input[type='checkbox']")]
          .filter((input) => input.name === groupName && input.type === element.type)
        : fieldset
        ? [...fieldset.querySelectorAll<HTMLInputElement>(`input[type='${element.type}']`)]
        : [element];
      groupInputs.forEach((input) => processedGroupedControls.add(input));

      const label = findControlLabel(root, (fieldset ?? element) as HTMLElement) ||
        `${controlKind(element)} field ${bindings.length + 1}`;
      const validationMessage = findValidationMessage(element);
      const identity = groupName ||
        fieldset?.getAttribute("id") ||
        fieldset?.getAttribute("data-test-form-element") ||
        label.toLowerCase();
      const key = stableFingerprint({
        label: label.toLowerCase(),
        control: controlKind(element),
        identity,
      });

      const options = groupInputs.map((input, optionIndex) => {
        // Do not fall back to the field/group label here. On LinkedIn's
        // custom radio markup that fallback is the question text, which makes
        // every sibling option appear to have the same label and causes the
        // executor to reject an otherwise precise answer as ambiguous.
        const optLabel = findOptionLabel(root, input) || input.value || `Option ${optionIndex + 1}`;
        return {
          id: stableFingerprint({
            fieldKey: key,
            optionLabel: optLabel.toLowerCase(),
            value: input.value,
          }),
          label: optLabel,
        };
      });

      const required = groupInputs.some((input) => input.required || input.getAttribute("aria-required") === "true") ||
        fieldset?.getAttribute("aria-required") === "true";
      const hasValue = groupInputs.some((input) => input.checked);

      bindings.push({
        field: {
          key,
          label,
          control: controlKind(element),
          required: Boolean(required),
          disabled: groupInputs.every((input) => input.disabled || input.getAttribute("aria-disabled") === "true"),
          hasValue,
          options: options.length > 0 ? options : undefined,
          validationMessage: validationMessage || undefined,
        },
        controls: groupInputs,
      });
      continue;
    }

    const label = findControlLabel(root, element) || `${controlKind(element)} field ${bindings.length + 1}`;
    const validationMessage = findValidationMessage(element);
    const key = stableFingerprint({
      label: label.toLowerCase(),
      control: controlKind(element),
      identity: element.getAttribute("name") || element.getAttribute("id") || label.toLowerCase(),
    });
    const options = observeOptions(root, element, key);

    bindings.push({
      field: {
        key,
        label,
        control: controlKind(element),
        required: element.required || element.getAttribute("aria-required") === "true",
        disabled: element.disabled || element.getAttribute("aria-disabled") === "true",
        hasValue: controlHasValue(element),
        ...(element instanceof HTMLSelectElement && element.multiple ? { multiple: true } : {}),
        constraints: observeFieldConstraints(element),
        options: options.length > 0 ? options : undefined,
        validationMessage: validationMessage || undefined,
      },
      controls: [element],
    });
  }

  return bindings;
}

function observeActions(root: ParentNode): ObservedAction[] {
  const elements = [...root.querySelectorAll<HTMLElement>(
    "button, [role='button'], input[type='submit'], input[type='button'], a.jobs-apply-button",
  )].filter((element) => element.isConnected && (isLinkedInElementVisible(element) || element.classList.contains("jobs-apply-button")));

  return elements
    .map((element, index) => {
      const name = accessibleName(element);
      if (!name) return null;
      const kind = actionKind(name);
      return {
        key: stableFingerprint({ name: name.toLowerCase(), kind, index }),
        name,
        kind,
        disabled:
          (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && element.disabled ||
          element.getAttribute("aria-disabled") === "true",
      } satisfies ObservedAction;
    })
    .filter((value): value is ObservedAction => value !== null)
    .slice(0, MAX_ACTIONS);
}

function observeValidationMessages(root: Element): string[] {
  const candidates = root.querySelectorAll(
    "[role='alert'], .artdeco-inline-feedback__message, .fb-form-element__error-text",
  );
  return [...new Set([...candidates]
    .filter(isLinkedInElementVisible)
    .map((element) => normalizeText(element.textContent, 300))
    .filter(Boolean))]
    .slice(0, 20);
}

function observeJob(document: Document, url: URL): ObservedJob {
  const externalId = url.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] ??
    digitsOnly(url.searchParams.get("currentJobId")) ??
    document.querySelector<HTMLElement>("[data-job-id]")?.dataset.jobId;

  return {
    externalId,
    title: findText(document, [
      ".job-details-jobs-unified-top-card__job-title h1",
      ".jobs-unified-top-card__job-title",
      "h1",
    ]),
    company: findText(document, [
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name",
    ]),
    location: findText(document, [
      ".job-details-jobs-unified-top-card__primary-description-container",
      ".jobs-unified-top-card__bullet",
    ]),
    description: findText(document, [
      ".jobs-description__content",
      ".jobs-box__html-content",
      "#job-details",
      "[data-test-job-description]",
    ], 8_000),
  };
}

function digitsOnly(value: string | null): string | undefined {
  return value && /^\d+$/.test(value) ? value : undefined;
}

function detectApplicationStep(
  heading: string,
  bodyText: string,
  actions: ObservedAction[],
): ApplicationStepKind {
  const normalizedHeading = heading.toLowerCase();
  const text = `${heading} ${bodyText}`.toLowerCase();
  if (
    actions.some((action) => action.kind === "submit") ||
    normalizedHeading.includes("review your application")
  ) {
    return "review";
  }
  if (text.includes("resume") || text.includes("cv")) return "resume";
  if (text.includes("contact info") || text.includes("contact information")) return "contact";
  if (actions.some((action) => action.kind === "continue" || action.kind === "review")) {
    return "screening";
  }
  return "unknown";
}

function findControlLabel(root: Element, element: Element, includeGroupLabel = true): string {
  const ariaLabel = normalizeText(element.getAttribute("aria-label"), 240);
  if (ariaLabel) return ariaLabel;

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const value = labelledBy
      .split(/\s+/)
      .map((id) => normalizeText(root.ownerDocument.getElementById(id)?.textContent, 240))
      .filter(Boolean)
      .join(" ");
    if (value) return value;
  }

  if (element.id) {
    const explicit = [...root.ownerDocument.querySelectorAll<HTMLLabelElement>("label[for]")]
      .find((label) => label.htmlFor === element.id);
    const text = labelText(explicit);
    if (text) return text;
  }

  const wrappingLabel = element.closest("label");
  const wrapped = labelText(wrappingLabel);
  if (wrapped) return wrapped;

  if (!includeGroupLabel) return "";

  const group = element.closest(
    ".jobs-easy-apply-form-element, fieldset, .fb-dash-form-element, [data-test-form-element]",
  );
  const groupLabel = labelText(group?.querySelector("legend, label, .artdeco-text-input--label"));
  return groupLabel || normalizeText(element.getAttribute("placeholder"), 240);
}

/**
 * Resolve only an individual choice label. A radio/checkbox option must not
 * inherit the enclosing question label, because that label is shared by every
 * sibling control in the group.
 */
function findOptionLabel(root: Element, element: Element): string {
  const directLabel = findControlLabel(root, element, false);
  if (directLabel) return directLabel;

  // Current LinkedIn SDUI radio markup renders an empty <label> beside the
  // input and places the visible choice text in a sibling <p> inside the
  // [role="radio"] container. Read only that option container so the answer
  // does not inherit the enclosing question label.
  const optionContainer = element.closest("[role='radio'], [role='checkbox']");
  const visibleChoice = optionContainer?.querySelector("p, [data-test-option-label], [aria-label]");
  return normalizeText(visibleChoice?.textContent ?? visibleChoice?.getAttribute("aria-label"), 120);
}

function labelText(element: Element | null | undefined): string {
  if (!element) return "";
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll("input, select, textarea, button, [role='button']").forEach((control) => control.remove());
  return normalizeText(clone.textContent, 240);
}

function observeOptions(
  root: Element,
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  fieldKey: string,
): ObservedOption[] {
  if (element instanceof HTMLSelectElement) {
    return [...element.options]
      .filter((option) => !isPlaceholderSelectOption(option))
      .map((option) => ({
        id: stableFingerprint({
          fieldKey,
          value: option.value,
          label: normalizeText(option.textContent, 120).toLowerCase(),
        }),
        label: normalizeText(option.textContent, 120),
      }))
      .filter((option) => option.label.length > 0)
      .slice(0, MAX_OPTIONS);
  }

  if (element instanceof HTMLInputElement && ["radio", "checkbox"].includes(element.type)) {
    const label = findControlLabel(root, element);
    return label
      ? [{ id: stableFingerprint({ fieldKey, value: element.value || "checked" }), label }]
      : [];
  }

  return [];
}

function controlKind(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): ObservedControlKind {
  if (element instanceof HTMLTextAreaElement) return "textarea";
  if (element instanceof HTMLSelectElement) return "select";
  if (["text", "email", "tel", "number", "radio", "checkbox", "file"].includes(element.type)) {
    return element.type as ObservedControlKind;
  }
  return "other";
}

function controlHasValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean {
  if (element instanceof HTMLInputElement && ["radio", "checkbox"].includes(element.type)) {
    return element.checked;
  }
  if (element instanceof HTMLInputElement && element.type === "file") {
    return (element.files?.length ?? 0) > 0 || Boolean(element.value);
  }
  if (element instanceof HTMLSelectElement) {
    return [...element.options].some((option) => option.selected && !isPlaceholderSelectOption(option));
  }
  return element.value.trim().length > 0;
}

function observeFieldConstraints(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): ObservedField["constraints"] {
  const constraints: NonNullable<ObservedField["constraints"]> = {};
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.hasAttribute("minlength") && element.minLength >= 0) {
      constraints.minLength = element.minLength;
    }
    if (element.hasAttribute("maxlength") && element.maxLength >= 0) {
      constraints.maxLength = element.maxLength;
    }
  }
  if (element instanceof HTMLInputElement && element.type === "number") {
    const minimum = parseFiniteNumber(element.min);
    const maximum = parseFiniteNumber(element.max);
    if (minimum !== undefined) constraints.minimum = minimum;
    if (maximum !== undefined) constraints.maximum = maximum;
  }
  return Object.keys(constraints).length > 0 ? constraints : undefined;
}

function parseFiniteNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isPlaceholderSelectOption(option: HTMLOptionElement): boolean {
  const label = normalizeText(option.textContent, 160).toLowerCase();
  const value = option.value.trim().toLowerCase();
  if (label.length === 0) return true;
  if (/^(select|choose|pick)( an?| the)?( option| value)?$/.test(label)) return true;
  if (/^(please )?(select|choose|pick)\b/.test(label)) return true;
  if (/^[-–—\s]+$/.test(label)) return true;
  return option.disabled && value.length === 0;
}

function findValidationMessage(element: HTMLElement): string {
  const describedBy = element.getAttribute("aria-describedby");
  if (describedBy) {
    const value = describedBy
      .split(/\s+/)
      .map((id) => normalizeText(element.ownerDocument.getElementById(id)?.textContent, 300))
      .filter(Boolean)
      .join(" ");
    if (value) return value;
  }

  const group = element.closest(
    ".jobs-easy-apply-form-element, fieldset, .fb-dash-form-element, [data-test-form-element]",
  );
  return normalizeText(
    group?.querySelector("[role='alert'], .artdeco-inline-feedback__message, .fb-form-element__error-text")?.textContent,
    300,
  );
}

function accessibleName(element: HTMLElement): string {
  return normalizeText(
    element.getAttribute("aria-label") ||
      (element instanceof HTMLInputElement ? element.value : "") ||
      element.textContent ||
      element.getAttribute("title"),
    160,
  );
}

function actionKind(name: string): ObservedActionKind {
  const normalized = name.toLowerCase();
  if (normalized.includes("easy apply")) return "open_application";
  if (normalized.includes("submit")) return "submit";
  if (normalized.includes("review")) return "review";
  if (normalized.includes("continue") || normalized === "next") return "continue";
  if (normalized.includes("dismiss") || normalized.includes("close")) return "dismiss";
  return "other";
}

function findHeading(root: ParentNode): string {
  return normalizeText(
    root.querySelector("h1, h2, h3, [role='heading']")?.textContent,
    240,
  );
}

function findText(document: Document, selectors: string[], maxLength = 240): string | undefined {
  for (const selector of selectors) {
    const value = normalizeText(document.querySelector(selector)?.textContent, maxLength);
    if (value) return value;
  }
  return undefined;
}

function detectBlockingReason(pageType: AdapterPageType): string | undefined {
  if (pageType === "login_required") return "Manual LinkedIn sign-in is required.";
  if (pageType === "security_challenge") return "Manual LinkedIn security verification is required.";
  if (pageType === "unsupported") return "The current LinkedIn page is not yet a supported execution state.";
  return undefined;
}

function hasJobData(job: ObservedJob): boolean {
  return Boolean(job.externalId || job.title || job.company || job.location);
}
