import { clickElementAndWait, waitForCondition } from "../../interactions/dom";
import { findLinkedInApplicationContainer, isLinkedInElementVisible } from "./application-container";

export type ReviewOnlyAdvanceResult = "application_opened" | "advanced" | "review_ready";
export type LinkedInSubmissionResult = "application_submitted";
export type LinkedInApplicationOpenErrorCode = "easy_apply_unavailable" | "easy_apply_open_failed";

export class LinkedInApplicationOpenError extends Error {
  readonly code: LinkedInApplicationOpenErrorCode;

  constructor(code: LinkedInApplicationOpenErrorCode, message: string) {
    super(message);
    this.name = "LinkedInApplicationOpenError";
    this.code = code;
  }
}

/** Opens the Easy Apply dialog but never interacts with the final submission action. */
export async function openLinkedInEasyApply(document: Document): Promise<ReviewOnlyAdvanceResult> {
  const existingDialog = applicationDialog(document);
  if (existingDialog) return "application_opened";

  // Preserve the useful part of the legacy helper's page-settle loop without
  // carrying forward its indefinite polling. LinkedIn can finish replacing the
  // top-card controls shortly after document_idle, so wait briefly for the
  // visible, enabled Easy Apply action before treating the listing as
  // unavailable.
  await waitForCondition(
    () => findAction(document, (name) => name.includes("easy apply")) ?? undefined,
    {
      timeoutMs: 3_000,
      pollIntervalMs: 100,
      description: "visible LinkedIn Easy Apply control",
    },
  ).catch(() => {
    throw new LinkedInApplicationOpenError(
      "easy_apply_unavailable",
      "RapidApply could not locate a visible Easy Apply control.",
    );
  });

  try {
    await clickElementAndWait(
      () => findAction(document, (name) => name.includes("easy apply")),
      () => {
        const dialog = applicationDialog(document);
        return dialog !== null && dialog !== existingDialog;
      },
      { postconditionTimeoutMs: 5_000 },
    );
  } catch (error) {
    throw new LinkedInApplicationOpenError(
      "easy_apply_open_failed",
      error instanceof Error ? error.message : "RapidApply could not open LinkedIn Easy Apply.",
    );
  }
  return "application_opened";
}

/**
 * Advance one non-consequential application step. Review is allowed because it
 * only reveals the final submit action; submit itself is rejected outright.
 */
export async function advanceLinkedInReviewOnlyStep(document: Document): Promise<ReviewOnlyAdvanceResult> {
  const currentDialog = applicationDialog(document);
  if (!currentDialog) throw new Error("RapidApply could not find the active application dialog.");
  if (hasSubmitAction(currentDialog)) return "review_ready";
  const next = findAction(currentDialog, (name) => name.includes("continue") || name === "next" || name.includes("review"));
  if (!next) throw new Error("RapidApply could not find a safe non-submit application action.");

  const startingSignature = dialogSignature(currentDialog);
  await clickElementAndWait(
    () => findAction(applicationDialog(document) ?? document, (name) =>
      name.includes("continue") || name === "next" || name.includes("review")),
    () => {
      const dialog = applicationDialog(document);
      if (dialog && hasSubmitAction(dialog)) return true;
      return dialog !== null && dialogSignature(dialog) !== startingSignature;
    },
    { maxAttempts: 1, postconditionTimeoutMs: 10_000 },
  );
  const activeDialog = applicationDialog(document);
  return activeDialog && hasSubmitAction(activeDialog) ? "review_ready" : "advanced";
}

/**
 * Submit only an explicitly enabled, already-reviewed application and require
 * LinkedIn's confirmation surface as the postcondition. The background
 * controller calls this only for a policy-authorized execution plan.
 */
export async function submitLinkedInApplication(
  document: Document,
  { confirmationTimeoutMs = 8_000 }: { confirmationTimeoutMs?: number } = {},
): Promise<LinkedInSubmissionResult> {
  const dialog = applicationDialog(document);
  if (!dialog) throw new Error("RapidApply could not find the active application dialog.");
  if (!hasSubmitAction(dialog)) {
    throw new Error("RapidApply could not verify a visible LinkedIn submission action.");
  }
  const priorConfirmations = new Map(
    submissionConfirmationSurfaces(document)
      .map((element) => [element, normalizedElementText(element)] as const),
  );

  await clickElementAndWait(
    () => findAction(applicationDialog(document) ?? document, (name) => name.includes("submit")),
    () => submissionConfirmationSurfaces(document).some((element) =>
      !priorConfirmations.has(element) ||
      priorConfirmations.get(element) !== normalizedElementText(element)
    ),
    { postconditionTimeoutMs: confirmationTimeoutMs },
  );
  // LinkedIn leaves a second post-apply "Next best action" modal above the
  // job page after the success text appears. The legacy helper explicitly
  // dismissed `.artdeco-modal__dismiss` before advancing its job queue. Keep
  // this cleanup separate from submission proof: a confirmed submission must
  // remain successful even if LinkedIn changes or delays the optional modal.
  await dismissLinkedInSubmissionConfirmation(document);
  return "application_submitted";
}

/** Dismisses LinkedIn's optional post-apply recommendation modal, if present. */
export async function dismissLinkedInSubmissionConfirmation(document: Document): Promise<void> {
  const modal = findPostApplyConfirmationModal(document);
  if (!modal) return;

  const dismiss = () => findAction(modal, (name) => name.includes("dismiss") || name.includes("close"));
  if (!dismiss()) return;

  try {
    await clickElementAndWait(
      dismiss,
      () => {
        const current = findPostApplyConfirmationModal(document);
        return !current || !isLinkedInElementVisible(current);
      },
      { maxAttempts: 1, postconditionTimeoutMs: 2_000 },
    );
  } catch {
    // Submission has already been independently confirmed. Modal cleanup is
    // intentionally non-fatal so a LinkedIn UI variation cannot turn a real
    // submission into a false failure.
  }
}

export async function waitForApplicationDialog(document: Document): Promise<void> {
  await waitForCondition(() => applicationDialog(document) ?? undefined, {
    timeoutMs: 5_000,
    description: "LinkedIn Easy Apply dialog",
  });
}

function applicationDialog(document: Document): Element | null {
  return findLinkedInApplicationContainer(document);
}

function findAction(root: ParentNode, matches: (name: string) => boolean): HTMLElement | null {
  const matching = [...root.querySelectorAll<HTMLElement>("button, [role='button'], input[type='button'], a.jobs-apply-button")]
    .filter((element) => {
      const name = actionName(element);
      return Boolean(name) && !isDisabled(element) && matches(name);
    });

  return matching.find(isLinkedInElementVisible) ?? matching[0] ?? null;
}



function hasSubmitAction(root: ParentNode): boolean {
  return findAction(root, (name) => name.includes("submit")) !== null;
}

function submissionConfirmationSurfaces(document: Document): Element[] {
  return [...document.querySelectorAll(
    "h1, h2, h3, [role='heading'], [role='alert'], [role='status'], .artdeco-modal__content, .jobs-easy-apply-content",
  )].filter((element) =>
    isLinkedInElementVisible(element) &&
    isSubmissionConfirmationText(normalizedElementText(element))
  );
}

function findPostApplyConfirmationModal(document: Document): Element | null {
  const confirmation = submissionConfirmationSurfaces(document)[0];
  if (!confirmation) return null;
  return confirmation.closest(
    "[data-test-modal], .artdeco-modal, [role='dialog'], [aria-modal='true']",
  ) ?? null;
}

function isSubmissionConfirmationText(text: string): boolean {
  return /\bapplication\b.{0,60}\b(submitted|sent)\b/.test(text) ||
    /\b(submitted|sent)\b.{0,60}\bapplication\b/.test(text);
}

function normalizedElementText(element: Element): string {
  const rendered = "innerText" in element ? (element as HTMLElement).innerText : undefined;
  return (rendered ?? element.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function actionName(element: HTMLElement): string {
  const raw = element.getAttribute("aria-label") ||
    (element instanceof HTMLInputElement ? element.value : "") ||
    element.textContent ||
    element.getAttribute("title") || "";
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

function isDisabled(element: HTMLElement): boolean {
  return (element instanceof HTMLButtonElement || element instanceof HTMLInputElement)
    ? element.disabled || element.getAttribute("aria-disabled") === "true"
    : element.getAttribute("aria-disabled") === "true";
}

function dialogSignature(dialog: Element): string {
  return [
    dialog.querySelector("h1, h2, h3, [role='heading']")?.textContent?.trim() ?? "",
    [...dialog.querySelectorAll("input, select, textarea")]
      .map((element) => `${element.tagName}:${element.getAttribute("name") ?? element.getAttribute("id") ?? ""}`)
      .join("|"),
  ].join("::");
}
