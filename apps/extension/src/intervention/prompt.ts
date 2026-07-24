import type {
  ApplicationAnswerMemoryScope,
  ApplicationAnswerValue,
  ApplicationFieldDescriptor,
  ApplicationIntervention,
  ApplicationInterventionResponse,
} from "@rapidapply/contracts";

const HOST_ID = "rapidapply-application-helper";
const TOUCH_INTERVAL_MS = 4_000;

export interface ApplicationInterventionPromptHandlers {
  onAnswer: (response: ApplicationInterventionResponse) => Promise<ApplicationIntervention | undefined>;
  onDefer: () => Promise<ApplicationIntervention | undefined>;
  /** Extends the durable server deadline while a candidate is actively using the helper. */
  onTouch: () => Promise<ApplicationIntervention | undefined>;
}

export interface ApplicationInterventionPromptHandle {
  show(intervention: ApplicationIntervention): void;
  destroy(): void;
}

/**
 * A deliberately isolated answer prompt. It never reads form values from the
 * host page and never lets host-page CSS alter the candidate's controls.
 */
export function createApplicationInterventionPrompt(
  document: Document,
  handlers: ApplicationInterventionPromptHandlers,
): ApplicationInterventionPromptHandle {
  const existing = document.getElementById(HOST_ID);
  existing?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-rapidapply-owned", "true");
  host.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "closed" });

  const dialogEl = document.createElement("dialog");
  dialogEl.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:none;background:transparent;pointer-events:auto;";

  const style = document.createElement("style");
  style.textContent = PROMPT_STYLE;
  shadow.append(style, dialogEl);
  document.documentElement.append(host);

  let current: ApplicationIntervention | null = null;
  let timer: number | undefined;
  let touchTimer: number | undefined;
  let isInteracting = false;
  let isActionPending = false;
  let lastTouchedAt = 0;

  function clearTimers(): void {
    if (timer !== undefined) window.clearInterval(timer);
    if (touchTimer !== undefined) window.clearInterval(touchTimer);
    timer = undefined;
    touchTimer = undefined;
  }

  function show(intervention: ApplicationIntervention): void {
    clearTimers();
    current = intervention;
    isInteracting = false;
    isActionPending = false;
    lastTouchedAt = 0;
    if (!dialogEl.open) {
      try {
        dialogEl.showModal();
      } catch {
        // Preserve visibility in constrained document contexts. Chromium's
        // normal path above promotes the dialog to the browser top layer.
        dialogEl.setAttribute("open", "");
      }
    }
    render();
    startCountdown();
  }

  function destroy(): void {
    clearTimers();
    if (dialogEl.open) dialogEl.close();
    host.remove();
  }

  function startCountdown(): void {
    timer = window.setInterval(() => {
      void refreshTimer();
    }, 250);
    touchTimer = window.setInterval(() => {
      if (isInteracting) void touchDeadline();
    }, TOUCH_INTERVAL_MS);
    void refreshTimer();
  }

  async function refreshTimer(): Promise<void> {
    const root = shadow.querySelector<HTMLElement>("[data-timer]");
    if (!current || !root) return;
    if (!current.deadlineAt) {
      root.textContent = "Your answer is saved when you are ready.";
      return;
    }
    const remaining = Math.max(0, Date.parse(current.deadlineAt) - Date.now());
    if (isInteracting) {
      root.textContent = "Timer paused while you are answering.";
      root.dataset.state = "paused";
      return;
    }
    root.dataset.state = remaining <= 5_000 ? "urgent" : "running";
    root.textContent = `${Math.ceil(remaining / 1_000)}s to answer or save for later`;
    if (remaining <= 0 && !isActionPending) await defer("Time elapsed — saved for later.");
  }

  async function touchDeadline(): Promise<void> {
    if (!current || isActionPending || Date.now() - lastTouchedAt < TOUCH_INTERVAL_MS - 300) return;
    lastTouchedAt = Date.now();
    try {
      const refreshed = await handlers.onTouch();
      if (refreshed?.id === current?.id) current = refreshed;
    } catch {
      // Preserve the local prompt. A transient network issue must not make a
      // candidate lose the answer they are currently writing.
    }
  }

  function render(): void {
    if (!current) return;
    const field = current.field;
    const root = document.createElement("section");
    root.className = "shell";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "RapidApply needs one answer");

    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    const panel = document.createElement("div");
    panel.className = "panel";
    backdrop.append(panel);
    root.append(backdrop);

    const eyebrow = document.createElement("div");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "RapidApply needs one quick answer";
    panel.append(eyebrow);

    const title = document.createElement("h2");
    title.textContent = field.question;
    panel.append(title);

    const context = document.createElement("p");
    context.className = "context";
    context.textContent = compactJobContext(current);
    panel.append(context);

    const timerLabel = document.createElement("div");
    timerLabel.className = "timer";
    timerLabel.setAttribute("data-timer", "true");
    panel.append(timerLabel);

    const form = document.createElement("form");
    form.noValidate = true;
    form.className = "answer-form";
    const control = createAnswerControl(document, field);
    form.append(control.element);

    const memoryRow = document.createElement("div");
    memoryRow.className = "memory";
    const rememberToggle = document.createElement("input");
    rememberToggle.type = "checkbox";
    rememberToggle.checked = true;
    rememberToggle.id = "rapidapply-remember";
    const rememberLabel = document.createElement("label");
    rememberLabel.htmlFor = rememberToggle.id;
    rememberLabel.textContent = "Remember this answer";
    const scope = document.createElement("select");
    scope.setAttribute("aria-label", "Where to remember this answer");
    appendOption(document, scope, "campaign", "For this job search");
    appendOption(document, scope, "global", "For future job searches");
    scope.value = "campaign";
    memoryRow.append(rememberToggle, rememberLabel, scope);
    form.append(memoryRow);

    const status = document.createElement("p");
    status.className = "status";
    status.setAttribute("aria-live", "polite");
    form.append(status);

    const actions = document.createElement("div");
    actions.className = "actions";
    const deferButton = document.createElement("button");
    deferButton.type = "button";
    deferButton.className = "secondary";
    deferButton.textContent = field.required ? "Answer later" : "Skip for now";
    const submitButton = document.createElement("button");
    submitButton.type = "submit";
    submitButton.className = "primary";
    submitButton.textContent = "Use this answer";
    actions.append(deferButton, submitButton);
    form.append(actions);
    panel.append(form);

    const footnote = document.createElement("p");
    footnote.className = "footnote";
    footnote.textContent = field.required
      ? "Required answers are never guessed. Choosing “Answer later” keeps this application in your review queue."
      : "You can skip this optional field now and answer similar questions later.";
    panel.append(footnote);

    const setInteracting = (next: boolean) => {
      if (isInteracting === next) return;
      isInteracting = next;
      // The local display must react immediately; the durable server deadline
      // is refreshed in parallel and remains the source of truth after a tab
      // suspension or page reload.
      void refreshTimer();
      if (next) void touchDeadline();
    };
    form.addEventListener("focusin", () => setInteracting(true));
    form.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (!shadow.activeElement || !form.contains(shadow.activeElement)) setInteracting(false);
      }, 0);
    });
    form.addEventListener("input", () => setInteracting(true));
    form.addEventListener("pointerdown", () => setInteracting(true));

    deferButton.addEventListener("click", () => {
      void defer(field.required
        ? "Saved for later review."
        : "Skipped for now and saved for later review.");
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (isActionPending) return;
      const answer = control.read();
      const validation = validateLocalAnswer(field, answer);
      if (validation) {
        status.textContent = validation;
        status.dataset.state = "error";
        return;
      }
      isActionPending = true;
      status.textContent = "Saving your answer…";
      status.dataset.state = "pending";
      submitButton.disabled = true;
      deferButton.disabled = true;
      const rememberScope: ApplicationAnswerMemoryScope | undefined = rememberToggle.checked
        ? (scope.value === "global" ? "global" : "campaign")
        : undefined;
      void handlers.onAnswer({
        answer,
        rememberScope,
        autoUse: rememberToggle.checked,
      }).then((next) => {
        if (next) show(next);
        else destroy();
      }).catch((error: unknown) => {
        isActionPending = false;
        submitButton.disabled = false;
        deferButton.disabled = false;
        status.textContent = error instanceof Error
          ? error.message.slice(0, 220)
          : "RapidApply could not save that answer. Try again.";
        status.dataset.state = "error";
      });
    });

    dialogEl.replaceChildren(root);
    window.setTimeout(() => control.focus(), 0);
  }

  async function defer(message: string): Promise<void> {
    if (!current || isActionPending) return;
    const panelStatus = shadow.querySelector<HTMLElement>(".status");
    const actions = shadow.querySelectorAll<HTMLButtonElement>("button");
    isActionPending = true;
    actions.forEach((button) => { button.disabled = true; });
    if (panelStatus) {
      panelStatus.textContent = "Saving this for later…";
      panelStatus.dataset.state = "pending";
    }
    try {
      const next = await handlers.onDefer();
      if (next) {
        show(next);
        return;
      }
      if (panelStatus) {
        panelStatus.textContent = message;
        panelStatus.dataset.state = "success";
      }
      window.setTimeout(() => destroy(), 800);
    } catch (error) {
      isActionPending = false;
      actions.forEach((button) => { button.disabled = false; });
      if (panelStatus) {
        panelStatus.textContent = error instanceof Error
          ? error.message.slice(0, 220)
          : "RapidApply could not save this question for later.";
        panelStatus.dataset.state = "error";
      }
    }
  }

  return { show, destroy };
}

interface AnswerControl {
  element: HTMLElement;
  read(): ApplicationAnswerValue;
  focus(): void;
}

function createAnswerControl(document: Document, field: ApplicationFieldDescriptor): AnswerControl {
  if (["text", "textarea", "number"].includes(field.kind)) {
    const input = field.kind === "textarea"
      ? document.createElement("textarea")
      : document.createElement("input");
    if (input instanceof HTMLInputElement) input.type = field.kind === "number" ? "number" : "text";
    input.className = "field";
    input.required = field.required;
    input.placeholder = field.kind === "textarea" ? "Write a concise, factual answer" : "Type your answer";
    if (field.constraints?.maxLength && input instanceof HTMLTextAreaElement) input.maxLength = field.constraints.maxLength;
    return {
      element: input,
      read: () => ({ type: "text", text: input.value.trim() }),
      focus: () => input.focus(),
    };
  }

  if (field.kind === "checkbox") {
    const wrapper = document.createElement("label");
    wrapper.className = "check-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    const copy = document.createElement("span");
    copy.textContent = field.question;
    wrapper.append(input, copy);
    return {
      element: wrapper,
      read: () => ({ type: "checked", checked: input.checked }),
      focus: () => input.focus(),
    };
  }

  if (field.kind === "multi_select") {
    const wrapper = document.createElement("div");
    wrapper.className = "options";
    const inputs = field.options.map((option) => {
      const label = document.createElement("label");
      label.className = "option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = option.id;
      const copy = document.createElement("span");
      copy.textContent = option.label;
      label.append(input, copy);
      wrapper.append(label);
      return input;
    });
    return {
      element: wrapper,
      read: () => ({ type: "options", optionIds: inputs.filter((input) => input.checked).map((input) => input.value) }),
      focus: () => inputs[0]?.focus(),
    };
  }

  const select = document.createElement("select");
  select.className = "field";
  appendOption(document, select, "", "Select an answer");
  field.options.forEach((option) => appendOption(document, select, option.id, option.label));
  return {
    element: select,
    read: () => ({ type: "options", optionIds: select.value ? [select.value] : [] }),
    focus: () => select.focus(),
  };
}

function appendOption(document: Document, select: HTMLSelectElement, value: string, label: string): void {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function validateLocalAnswer(field: ApplicationFieldDescriptor, answer: ApplicationAnswerValue): string | null {
  if (answer.type === "text" && field.required && !answer.text.trim()) return "Enter an answer to continue.";
  if (answer.type === "options" && field.required && answer.optionIds.length === 0) return "Choose an answer to continue.";
  if (answer.type === "checked" && field.required && !answer.checked) return "Confirm this item to continue.";
  return null;
}

function compactJobContext(intervention: ApplicationIntervention): string {
  const parts = [intervention.jobTitle, intervention.company].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "LinkedIn Easy Apply";
}

const PROMPT_STYLE = `
  :host { all: initial; }
  .shell { position: fixed; inset: 0; z-index: 2147483647; color: #101828; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .backdrop { position: absolute; inset: 0; display: grid; place-items: center; padding: 22px; background: rgba(15, 23, 42, .48); backdrop-filter: blur(3px); }
  .panel { box-sizing: border-box; width: min(100%, 530px); max-height: calc(100vh - 44px); overflow: auto; border: 1px solid rgba(148,163,184,.45); border-radius: 18px; background: #fff; box-shadow: 0 28px 80px rgba(15, 23, 42, .34); padding: 24px; }
  .eyebrow { color: #155eef; font-size: 12px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; }
  h2 { margin: 9px 0 4px; color: #101828; font-size: 21px; line-height: 1.28; letter-spacing: -.02em; }
  .context, .footnote { margin: 0; color: #667085; font-size: 13px; line-height: 1.45; }
  .timer { display: inline-flex; margin-top: 14px; border-radius: 999px; background: #eff8ff; color: #175cd3; padding: 5px 9px; font-size: 12px; font-weight: 650; }
  .timer[data-state="urgent"] { background: #fff4ed; color: #c4320a; }
  .timer[data-state="paused"] { background: #f9f5ff; color: #7f56d9; }
  .answer-form { margin-top: 18px; }
  .field { box-sizing: border-box; width: 100%; min-height: 42px; border: 1px solid #d0d5dd; border-radius: 9px; background: #fff; color: #101828; font: inherit; font-size: 14px; padding: 10px 11px; outline: none; }
  textarea.field { min-height: 116px; resize: vertical; }
  .field:focus, .option:has(input:focus), .check-row:has(input:focus) { border-color: #2e90fa; box-shadow: 0 0 0 3px rgba(46,144,250,.16); }
  .options { display: grid; gap: 8px; }
  .option, .check-row { display: flex; align-items: flex-start; gap: 9px; box-sizing: border-box; border: 1px solid #d0d5dd; border-radius: 9px; color: #344054; cursor: pointer; font-size: 14px; line-height: 1.35; padding: 10px 11px; }
  .option input, .check-row input, .memory input { accent-color: #155eef; margin-top: 2px; }
  .memory { display: flex; align-items: center; gap: 7px; margin-top: 13px; color: #475467; font-size: 12px; }
  .memory label { cursor: pointer; }
  .memory select { margin-left: auto; border: 0; background: transparent; color: #175cd3; font: inherit; font-size: 12px; font-weight: 650; outline: none; }
  .status { min-height: 18px; margin: 10px 0 0; color: #475467; font-size: 12px; line-height: 1.35; }
  .status[data-state="error"] { color: #b42318; }
  .status[data-state="success"] { color: #027a48; }
  .actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 14px; }
  button { min-height: 39px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 700; padding: 0 14px; }
  button:disabled { cursor: wait; opacity: .65; }
  .primary { border: 1px solid #155eef; background: #155eef; color: #fff; }
  .primary:hover:not(:disabled) { background: #004eeb; }
  .secondary { border: 1px solid #d0d5dd; background: #fff; color: #344054; }
  .secondary:hover:not(:disabled) { background: #f9fafb; }
  .footnote { margin-top: 16px; border-top: 1px solid #eaecf0; padding-top: 14px; font-size: 11.5px; }
  @media (max-width: 520px) { .backdrop { align-items: end; padding: 10px; } .panel { border-radius: 16px; padding: 20px; } .actions { flex-direction: column-reverse; } button { width: 100%; } }
`;
