export type FillableElement = HTMLInputElement | HTMLTextAreaElement;
export type CheckableElement = HTMLInputElement;

export type ElementResolver<T extends Element> = T | (() => T | null);

export interface WaitForElementOptions {
  root?: ParentNode;
  timeoutMs?: number;
}

export interface WaitForConditionOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  description?: string;
  signal?: AbortSignal;
}

export interface RetryOptions {
  maxAttempts?: number;
  settleMs?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
}

export interface InteractionResult {
  attempts: number;
}

export interface ClickAndWaitOptions extends RetryOptions {
  postconditionTimeoutMs?: number;
}

export interface SelectOptionChoice {
  value?: string;
  label?: string;
}

/**
 * Waits for a DOM element without relying on arbitrary sleeps. Site adapters
 * own the selector and decide what a successful match means.
 */
export function waitForElement<T extends Element>(
  selector: string,
  { root = document, timeoutMs = 10_000 }: WaitForElementOptions = {},
): Promise<T> {
  const current = root.querySelector<T>(selector);
  if (current) return Promise.resolve(current);

  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const match = root.querySelector<T>(selector);
      if (!match) return;

      window.clearTimeout(timeout);
      observer.disconnect();
      resolve(match);
    });

    const timeout = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timed out waiting for selector: ${selector}`));
    }, timeoutMs);

    observer.observe(root, { childList: true, subtree: true });
  });
}

/**
 * Bounded condition polling for state changes that are not reliably exposed by
 * one mutation target (for example SPA navigation or a modal being replaced).
 */
export async function waitForCondition<T>(
  probe: () => T | false | null | undefined | Promise<T | false | null | undefined>,
  {
    timeoutMs = 10_000,
    pollIntervalMs = 50,
    description = "condition",
    signal,
  }: WaitForConditionOptions = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    throwIfAborted(signal);
    const result = await probe();
    if (result !== false && result !== null && result !== undefined) return result;
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())), signal);
  }

  throw new Error(`Timed out waiting for ${description}.`);
}

/**
 * Uses the browser's native value setter and dispatches the events controlled
 * form libraries listen for. This preserves a key technique from the legacy
 * implementation without coupling it to any individual site.
 */
export function setNativeValue(element: FillableElement, value: string): void {
  setNativeProperty(element, "value", value);
  dispatchFormEvents(element);
}

export function clickElement(element: HTMLElement): void {
  if (!element.isConnected) throw new Error("The target element is no longer attached to the page.");
  if (isDisabled(element)) throw new Error("The target element is disabled.");

  element.scrollIntoView({ block: "center", inline: "nearest" });
  element.focus({ preventScroll: true });
  dispatchPointerPrelude(element);
  element.click();
}

/**
 * Re-resolves and refills a control after framework rerenders. This is the
 * modern, bounded equivalent of the legacy extension's repeated fill loops.
 */
export async function setNativeValueVerified(
  target: ElementResolver<FillableElement>,
  value: string,
  options: RetryOptions = {},
): Promise<InteractionResult> {
  return retryVerifiedInteraction(
    target,
    (element) => setNativeValue(element, value),
    (element) => element.value === value,
    { maxAttempts: 3, settleMs: 40, retryDelayMs: 80, ...options },
    "text value",
  );
}

/** Uses the native checked setter so React-style controlled inputs observe it. */
export function setNativeChecked(element: CheckableElement, checked: boolean): void {
  if (!["checkbox", "radio"].includes(element.type)) {
    throw new Error("Only checkbox and radio controls expose a checked state.");
  }
  setNativeProperty(element, "checked", checked);
  dispatchFormEvents(element);
}

export async function setNativeCheckedVerified(
  target: ElementResolver<CheckableElement>,
  checked: boolean,
  options: RetryOptions = {},
): Promise<InteractionResult> {
  return retryVerifiedInteraction(
    target,
    (element) => setNativeChecked(element, checked),
    (element) => element.checked === checked,
    { maxAttempts: 3, settleMs: 40, retryDelayMs: 80, ...options },
    "checked state",
  );
}

/** Selects by stable value or normalized visible label and emits both events. */
export function selectNativeOption(element: HTMLSelectElement, choice: SelectOptionChoice): HTMLOptionElement {
  if (!choice.value && !choice.label) throw new Error("An option value or label is required.");
  const normalizedLabel = normalizeForComparison(choice.label ?? "");
  const option = [...element.options].find((candidate) =>
    (choice.value !== undefined && candidate.value === choice.value) ||
    (choice.label !== undefined && normalizeForComparison(candidate.textContent ?? "") === normalizedLabel)
  );
  if (!option) throw new Error("The requested option is not available.");

  setNativeProperty(element, "value", option.value);
  dispatchFormEvents(element);
  return option;
}

export async function selectNativeOptionVerified(
  target: ElementResolver<HTMLSelectElement>,
  choice: SelectOptionChoice,
  options: RetryOptions = {},
): Promise<InteractionResult> {
  let selectedValue: string | null = null;
  return retryVerifiedInteraction(
    target,
    (element) => {
      selectedValue = selectNativeOption(element, choice).value;
    },
    (element) => selectedValue !== null && element.value === selectedValue,
    { maxAttempts: 3, settleMs: 40, retryDelayMs: 80, ...options },
    "selected option",
  );
}

/** Selects an exact set of visible options on a native multiple select. */
export async function selectNativeOptionsVerified(
  target: ElementResolver<HTMLSelectElement>,
  labels: readonly string[],
  options: RetryOptions = {},
): Promise<InteractionResult> {
  const normalizedTargets = new Set(labels.map(normalizeForComparison));
  return retryVerifiedInteraction(
    target,
    (element) => {
      if (!element.multiple) throw new Error("The target is not a multiple select.");
      const available = new Set(
        [...element.options].map((option) => normalizeForComparison(option.textContent ?? "")),
      );
      if ([...normalizedTargets].some((label) => !available.has(label))) {
        throw new Error("A requested option is not available.");
      }
      for (const option of element.options) {
        option.selected = normalizedTargets.has(
          normalizeForComparison(option.textContent ?? ""),
        );
      }
      dispatchFormEvents(element);
    },
    (element) => {
      const selected = new Set(
        [...element.options]
          .filter((option) => option.selected)
          .map((option) => normalizeForComparison(option.textContent ?? "")),
      );
      return selected.size === normalizedTargets.size &&
        [...normalizedTargets].every((label) => selected.has(label));
    },
    { maxAttempts: 3, settleMs: 40, retryDelayMs: 80, ...options },
    "selected options",
  );
}

/**
 * Clicks and verifies a caller-defined result. It defaults to one attempt so a
 * consequential action cannot be duplicated accidentally; adapters may opt
 * into retries only for actions they know are idempotent.
 */
export async function clickElementAndWait(
  target: ElementResolver<HTMLElement>,
  postcondition: () => boolean | Promise<boolean>,
  {
    maxAttempts = 1,
    settleMs = 0,
    retryDelayMs = 100,
    postconditionTimeoutMs = 2_000,
    signal,
  }: ClickAndWaitOptions = {},
): Promise<InteractionResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(signal);
    const element = resolveElement(target);
    if (!element) throw new Error("The target element could not be resolved.");

    try {
      clickElement(element);
      if (settleMs > 0) await delay(settleMs, signal);
      await waitForCondition(
        async () => await postcondition() || undefined,
        {
          timeoutMs: postconditionTimeoutMs,
          pollIntervalMs: 50,
          description: "click postcondition",
          signal,
        },
      );
      return { attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await delay(retryDelayMs, signal);
    }
  }

  throw interactionFailure("click postcondition", maxAttempts, lastError);
}

async function retryVerifiedInteraction<T extends Element>(
  target: ElementResolver<T>,
  mutate: (element: T) => void,
  verify: (element: T) => boolean,
  {
    maxAttempts = 3,
    settleMs = 40,
    retryDelayMs = 80,
    signal,
  }: RetryOptions,
  description: string,
): Promise<InteractionResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(signal);
    const element = resolveElement(target);
    if (!element) {
      lastError = new Error("The target element could not be resolved.");
    } else {
      try {
        mutate(element);
        if (settleMs > 0) await delay(settleMs, signal);
        const current = resolveElement(target);
        if (current && verify(current)) return { attempts: attempt };
        lastError = new Error(`The ${description} did not persist.`);
      } catch (error) {
        lastError = error;
      }
    }

    if (attempt < maxAttempts) await delay(retryDelayMs, signal);
  }

  throw interactionFailure(description, maxAttempts, lastError);
}

function resolveElement<T extends Element>(target: ElementResolver<T>): T | null {
  return typeof target === "function" ? target() : target;
}

function setNativeProperty<T extends Element, K extends "value" | "checked">(
  element: T,
  property: K,
  value: K extends "checked" ? boolean : string,
): void {
  let prototype: object | null = Object.getPrototypeOf(element);
  while (prototype) {
    const setter = Object.getOwnPropertyDescriptor(prototype, property)?.set;
    if (setter) {
      setter.call(element, value);
      return;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  throw new Error(`The target element does not expose a native ${property} setter.`);
}

function dispatchFormEvents(element: HTMLElement): void {
  element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

function dispatchPointerPrelude(element: HTMLElement): void {
  const pointerEvent = typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
  element.dispatchEvent(new pointerEvent("pointerover", { bubbles: true, composed: true }));
  element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, composed: true }));
  element.dispatchEvent(new pointerEvent("pointerdown", { bubbles: true, composed: true }));
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
  element.dispatchEvent(new pointerEvent("pointerup", { bubbles: true, composed: true }));
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
}

function isDisabled(element: HTMLElement): boolean {
  return (
    ((element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && element.disabled) ||
    element.getAttribute("aria-disabled") === "true"
  );
}

function normalizeForComparison(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function interactionFailure(description: string, attempts: number, cause: unknown): Error {
  const detail = cause instanceof Error ? ` ${cause.message}` : "";
  return new Error(`Unable to verify ${description} after ${attempts} attempt(s).${detail}`);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("The interaction was aborted.");
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      globalThis.clearTimeout(timeout);
      reject(new Error("The interaction was aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
