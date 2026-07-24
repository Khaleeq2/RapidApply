/**
 * A deliberately narrow bridge to Chrome's debugger transport for the rare
 * cases where a page ignores a content script's synthetic DOM click. It is
 * not a general browser-driving API: callers can only choose from the static,
 * non-submitting actions declared below, and the debugger is detached after
 * each verified input sequence.
 */

export type TrustedLinkedInAction = "open_easy_apply";

export interface TrustedInputResult {
  ok: boolean;
  reason?: string;
}

export interface TrustedResumeAttachmentResult extends TrustedInputResult {
  fileName?: string;
}

export interface TrustedInputTransport {
  activateTab(tabId: number): Promise<void>;
  attach(tabId: number): Promise<void>;
  detach(tabId: number): Promise<void>;
  sendCommand(tabId: number, method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface TrustedInputOptions {
  /** Injectable only for focused verification; production uses the safe default. */
  timeoutMs?: number;
}

interface ClickPoint {
  x: number;
  y: number;
}

interface RuntimeEvaluationResult {
  result?: {
    value?: unknown;
    objectId?: string;
  };
  exceptionDetails?: unknown;
}

const DEBUGGER_PROTOCOL_VERSION = "1.3";
const DEFAULT_COMMAND_TIMEOUT_MS = 4_000;
const DETACH_TIMEOUT_MS = 1_000;

class TrustedInputTimeoutError extends Error {
  constructor() {
    super("RapidApply's trusted browser input timed out.");
    this.name = "TrustedInputTimeoutError";
  }
}

/**
 * Checks whether the installed helper currently has its declared debugger
 * permission. It never prompts, and a campaign cannot elevate permissions
 * from a dashboard message or server instruction.
 */
export async function hasTrustedInputPermission(): Promise<boolean> {
  return chrome.permissions.contains({ permissions: ["debugger"] });
}

export async function clickTrustedLinkedInAction(
  action: TrustedLinkedInAction,
  tabId: number,
  transport: TrustedInputTransport = chromeTrustedInputTransport,
  options: TrustedInputOptions = {},
): Promise<TrustedInputResult> {
  if (action !== "open_easy_apply") {
    return { ok: false, reason: "RapidApply rejected an unsupported trusted-input action." };
  }

  let attached = false;
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  try {
    // Input events target the visible browser surface. Selecting the one
    // executor tab first also makes the action visible and auditable to the
    // candidate rather than running it in a hidden background tab.
    await withTimeout(transport.activateTab(tabId), timeoutMs);
    await withTimeout(transport.attach(tabId), timeoutMs);
    attached = true;

    const point = await resolveOpenEasyApplyPoint(tabId, transport, timeoutMs);
    if (!point) {
      return { ok: false, reason: "RapidApply could not locate a visible Easy Apply control." };
    }

    await withTimeout(transport.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "none",
      buttons: 0,
      pointerType: "mouse",
    }), timeoutMs);
    await withTimeout(transport.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
      pointerType: "mouse",
    }), timeoutMs);
    await withTimeout(transport.sendCommand(tabId, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
      pointerType: "mouse",
    }), timeoutMs);

    // LinkedIn's current top-card implementation sometimes receives the
    // trusted pointer sequence without activating the React button. The old
    // helper's successful path effectively combined pointer targeting with
    // native keyboard activation. Preserve that resilience without exposing a
    // generic keypress primitive: the static probe focuses only the verified
    // Easy Apply control, and Enter is used only for this non-submit action.
    await withTimeout(transport.sendCommand(tabId, "Runtime.evaluate", {
      expression: FOCUS_OPEN_EASY_APPLY_EXPRESSION,
      returnByValue: true,
    }), timeoutMs);
    await withTimeout(transport.sendCommand(tabId, "Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }), timeoutMs);
    await withTimeout(transport.sendCommand(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    }), timeoutMs);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof TrustedInputTimeoutError
        ? "RapidApply's trusted browser input timed out before LinkedIn confirmed the action."
        : classifyTrustedInputFailure(error),
    };
  } finally {
    if (attached) {
      await withTimeout(transport.detach(tabId), DETACH_TIMEOUT_MS).catch(() => undefined);
    }
  }
}

/**
 * Attaches exactly one PDF downloaded by RapidApply to LinkedIn's active Easy
 * Apply file input. The caller cannot provide selectors or executable source;
 * both the target probe and event sequence are static extension code.
 */
export async function attachTrustedLinkedInResume(
  tabId: number,
  absolutePath: string,
  expectedFileName: string,
  transport: TrustedInputTransport = chromeTrustedInputTransport,
  options: TrustedInputOptions = {},
): Promise<TrustedResumeAttachmentResult> {
  const validationFailure = validateManagedResumePath(absolutePath, expectedFileName);
  if (validationFailure) return { ok: false, reason: validationFailure };

  let attached = false;
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  try {
    await withTimeout(transport.activateTab(tabId), timeoutMs);
    await withTimeout(transport.attach(tabId), timeoutMs);
    attached = true;

    const response = await withTimeout(transport.sendCommand(tabId, "Runtime.evaluate", {
      expression: LINKEDIN_RESUME_FILE_INPUT_EXPRESSION,
      returnByValue: false,
      awaitPromise: true,
    }), timeoutMs) as RuntimeEvaluationResult;
    const objectId = response.exceptionDetails ? undefined : response.result?.objectId;
    if (!objectId) {
      return { ok: false, reason: "RapidApply could not locate LinkedIn's active resume file input." };
    }

    await withTimeout(transport.sendCommand(tabId, "DOM.setFileInputFiles", {
      files: [absolutePath],
      objectId,
    }), timeoutMs);
    await withTimeout(transport.sendCommand(tabId, "Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: RESUME_CHANGE_EVENT_FUNCTION,
      returnByValue: true,
    }), timeoutMs);
    return { ok: true, fileName: expectedFileName };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof TrustedInputTimeoutError
        ? "RapidApply's trusted resume attachment timed out before LinkedIn accepted the file."
        : classifyTrustedInputFailure(error),
    };
  } finally {
    if (attached) {
      await withTimeout(transport.detach(tabId), DETACH_TIMEOUT_MS).catch(() => undefined);
    }
  }
}

function classifyTrustedInputFailure(error: unknown): string {
  const message = error instanceof Error ? error.message.toLocaleLowerCase() : "";
  if (message.includes("another debugger is already attached")) {
    return "RapidApply could not use trusted browser input because this LinkedIn tab is already being inspected. Close that tab's developer tools and retry.";
  }
  if (message.includes("cannot attach") || message.includes("target closed")) {
    return "RapidApply could not attach its reviewed browser input to the active LinkedIn tab. Keep the tab open and retry.";
  }
  return "RapidApply could not send the reviewed browser input to LinkedIn.";
}

async function resolveOpenEasyApplyPoint(
  tabId: number,
  transport: TrustedInputTransport,
  timeoutMs: number,
): Promise<ClickPoint | null> {
  const response = await withTimeout(transport.sendCommand(tabId, "Runtime.evaluate", {
    expression: OPEN_EASY_APPLY_POINT_EXPRESSION,
    returnByValue: true,
  }), timeoutMs) as RuntimeEvaluationResult;

  if (response.exceptionDetails) return null;
  return parseClickPoint(response.result?.value);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new TrustedInputTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function parseClickPoint(value: unknown): ClickPoint | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const x = value.x;
  const y = value.y;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  if (x < 0 || y < 0) return null;
  return { x, y };
}

function validateManagedResumePath(absolutePath: string, expectedFileName: string): string | null {
  if (!expectedFileName.endsWith(".pdf") || !expectedFileName.includes("_Resume_v")) {
    return "RapidApply rejected an invalid generated resume filename.";
  }
  const isAbsolute = absolutePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(absolutePath);
  const pathParts = absolutePath.split(/[\\/]+/).filter(Boolean);
  if (!isAbsolute || pathParts.at(-1) !== expectedFileName || !pathParts.includes("RapidApply")) {
    return "RapidApply rejected a resume outside its managed download folder.";
  }
  return null;
}

const chromeTrustedInputTransport: TrustedInputTransport = {
  activateTab: async (tabId) => {
    await chrome.tabs.update(tabId, { active: true });
  },
  attach: async (tabId) => {
    await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
  },
  detach: async (tabId) => {
    await chrome.debugger.detach({ tabId });
  },
  sendCommand: async (tabId, method, params) => {
    return chrome.debugger.sendCommand({ tabId }, method, params);
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// This source is static and local to the extension. It accepts no server- or
// page-provided selector, which prevents the privileged channel from becoming
// arbitrary remote code execution or a generic click primitive.
const OPEN_EASY_APPLY_POINT_EXPRESSION = `
  (() => {
    // Auto-dismiss LinkedIn's "Job search safety reminder" modal if present
    const safetyDialog = [...document.querySelectorAll("dialog, [data-testid='dialog'], [role='dialog']")]
      .find((d) => (d.textContent || "").toLowerCase().includes("job search safety reminder"));
    if (safetyDialog) {
      const continueBtn = [...safetyDialog.querySelectorAll("a, button, [role='button']")]
        .find((el) => (el.innerText || el.textContent || "").toLowerCase().trim().includes("continue applying"));
      if (continueBtn) {
        continueBtn.click();
      } else {
        const closeBtn = safetyDialog.querySelector("button[aria-label='Dismiss'], button[aria-label='Close'], button");
        if (closeBtn) closeBtn.click();
      }
    }

    const actionName = (element) => (
      element.getAttribute("aria-label") ||
      (element instanceof HTMLInputElement ? element.value : "") ||
      element.innerText ||
      element.textContent ||
      element.getAttribute("title") || ""
    ).trim().replace(/\\s+/g, " ").toLowerCase();
    const visible = (element) => {
      if (!element.isConnected) return false;
      for (let current = element; current; current = current.parentElement) {
        if (current.getAttribute("aria-hidden") === "true") return false;
      }
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const candidates = [...document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit'], a[role='button']")]
      .filter((element) => visible(element) && !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true" && actionName(element).includes("easy apply"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const isInJobTopCard = Boolean(element.closest(".jobs-unified-top-card, .job-details-jobs-unified-top-card, [data-job-id]"));
        const isInsideDialog = Boolean(element.closest("[role='dialog'], [aria-modal='true']"));
        const isInViewport = rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth;
        const exactName = actionName(element) === "easy apply" || actionName(element).startsWith("easy apply ");
        const score = (isInJobTopCard ? 100 : 0) + (isInViewport ? 20 : 0) + (exactName ? 10 : 0) - (isInsideDialog ? 100 : 0);
        return { element, score };
      })
      .sort((left, right) => right.score - left.score);
    const target = candidates[0]?.element;
    if (!target) return { ok: false };
    target.scrollIntoView({ block: "center", inline: "center" });
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit !== target && !target.contains(hit))) return { ok: false };
    return { ok: true, x, y };
  })()
`;

const FOCUS_OPEN_EASY_APPLY_EXPRESSION = `
  (() => {
    const safetyDialog = [...document.querySelectorAll("dialog, [data-testid='dialog'], [role='dialog']")]
      .find((d) => (d.textContent || "").toLowerCase().includes("job search safety reminder"));
    if (safetyDialog) {
      const continueBtn = [...safetyDialog.querySelectorAll("a, button, [role='button']")]
        .find((el) => (el.innerText || el.textContent || "").toLowerCase().trim().includes("continue applying"));
      if (continueBtn) {
        continueBtn.click();
      } else {
        const closeBtn = safetyDialog.querySelector("button[aria-label='Dismiss'], button[aria-label='Close'], button");
        if (closeBtn) closeBtn.click();
      }
    }

    const actionName = (element) => (
      element.getAttribute("aria-label") ||
      (element instanceof HTMLInputElement ? element.value : "") ||
      element.innerText ||
      element.textContent ||
      element.getAttribute("title") || ""
    ).trim().replace(/\\s+/g, " ").toLowerCase();
    const visible = (element) => {
      if (!element.isConnected) return false;
      for (let current = element; current; current = current.parentElement) {
        if (current.getAttribute("aria-hidden") === "true") return false;
      }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" &&
        style.pointerEvents !== "none" && rect.width > 0 && rect.height > 0;
    };
    const target = [...document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit'], a[role='button']")]
      .filter((element) => visible(element) && !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true" && actionName(element).includes("easy apply"))
      .find((element) => !element.closest("[role='dialog'], [aria-modal='true']"));
    if (!target) return { ok: false };
    target.focus();
    return { ok: document.activeElement === target };
  })()
`;

const LINKEDIN_RESUME_FILE_INPUT_EXPRESSION = `
  (() => {
    function findInputInNode(root) {
      if (!root) return null;
      const direct = [...root.querySelectorAll("input[type='file'], input[accept*='pdf']")];
      if (direct.length > 0) return direct[0];

      const inputs = [...root.querySelectorAll("input")].filter(i => i.type === "file" || (i.getAttribute("accept") || "").includes("pdf"));
      if (inputs.length > 0) return inputs[0];

      const all = [...root.querySelectorAll("*")];
      for (const el of all) {
        if (el.shadowRoot) {
          const found = findInputInNode(el.shadowRoot);
          if (found) return found;
        }
      }
      return null;
    }

    let input = findInputInNode(document);
    if (input) return input;

    const uploadBtn = [...document.querySelectorAll("button, [role='button'], label, [data-test-document-upload]")]
      .find((el) => {
        const text = (el.innerText || el.textContent || "").toLowerCase();
        return text.includes("upload resume") || text.includes("upload cv");
      });

    if (uploadBtn) {
      uploadBtn.click();
      input = findInputInNode(document);
      if (input) return input;
    }

    return null;
  })()
`;

const RESUME_CHANGE_EVENT_FUNCTION = `function () {
  this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  if (typeof this.blur === "function") this.blur();
  if (typeof window.focus === "function") window.focus();
  return { ok: true, fileName: this.files && this.files[0] ? this.files[0].name : null };
}`;;
