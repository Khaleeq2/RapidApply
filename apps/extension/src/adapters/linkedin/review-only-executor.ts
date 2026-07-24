import type { ApplicationAnswerPlanRecord } from "@rapidapply/contracts";
import type { AdapterObservation } from "../types";
import {
  clickElement,
  selectNativeOptionVerified,
  selectNativeOptionsVerified,
  setNativeValueVerified,
  clickElementAndWait,
  waitForCondition,
} from "../../interactions/dom";
import {
  findLinkedInApplicationContainer,
  isLinkedInElementVisible,
} from "./application-container";
import {
  observeLinkedInApplicationFieldBindings,
  type LinkedInObservedFieldBinding,
} from "./observer";

export interface ReviewOnlyExecutionResult {
  appliedFieldKeys: string[];
  alreadySatisfiedFieldKeys: string[];
  blocked: Array<{ fieldKey: string; reason: string }>;
}

/**
 * Applies only a server-resolved, policy-approved value to a live form. This
 * has no navigation behavior: it deliberately cannot click Continue, Review,
 * Upload, or Submit. Those actions remain separate, explicitly verified
 * phases of the controller.
 */
export async function applyLinkedInReviewOnlyAnswers(input: {
  document: Document;
  observation: AdapterObservation;
  plans: readonly ApplicationAnswerPlanRecord[];
}): Promise<ReviewOnlyExecutionResult> {
  if (input.observation.pageType !== "application_form") {
    throw new Error("RapidApply refuses to fill a review or submission state.");
  }

  const result: ReviewOnlyExecutionResult = {
    appliedFieldKeys: [],
    alreadySatisfiedFieldKeys: [],
    blocked: [],
  };

  for (const record of input.plans) {
    const decision = record.decision;
    // LinkedIn can replace every field in the active dialog after a change.
    // Do not retain a node from the initial observation: resolve the matching
    // live control again for each answer and for each verified retry.
    const resolveBinding = () => resolveLiveApplicationField(input.document, record.field);
    const binding = resolveBinding();
    const control = binding?.controls[0] ?? null;
    if (!binding || !control) {
      result.blocked.push({ fieldKey: record.field.key, reason: "The observed form control changed." });
      continue;
    }
    if (!decision || decision.status !== "resolved" || decision.requiresReview) {
      result.blocked.push({ fieldKey: record.field.key, reason: "This field requires candidate review." });
      continue;
    }
    if (control instanceof HTMLInputElement && control.type === "file") {
      result.blocked.push({ fieldKey: record.field.key, reason: "Resume upload is not enabled in review-only execution." });
      continue;
    }

    const outcome = await applyResolvedAnswer(resolveBinding, record);
    if (outcome === "applied") result.appliedFieldKeys.push(record.field.key);
    if (outcome === "already_satisfied") result.alreadySatisfiedFieldKeys.push(record.field.key);
    if (outcome !== "applied" && outcome !== "already_satisfied") {
      result.blocked.push({ fieldKey: record.field.key, reason: outcome });
    }
  }
  return result;
}

async function applyResolvedAnswer(
  resolveBinding: () => LinkedInObservedFieldBinding | null,
  record: ApplicationAnswerPlanRecord,
): Promise<"applied" | "already_satisfied" | string> {
  const answer = record.decision?.status === "resolved" ? record.decision.answer : undefined;
  if (!answer) return "No resolved answer is available.";

  const control = resolveBinding()?.controls[0] ?? null;
  if (!control) return "The observed form control changed.";

  if (answer.type === "text") {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) {
      return "The live control does not accept text.";
    }
    await setNativeValueVerified(() => {
      const current = resolveBinding()?.controls[0] ?? null;
      return current instanceof HTMLInputElement || current instanceof HTMLTextAreaElement
        ? current
        : null;
    }, answer.text);
    const updatedControl = resolveBinding()?.controls[0] ?? null;
    if (updatedControl instanceof HTMLElement && isTypeaheadControl(updatedControl)) {
      const selected = await selectLinkedInTypeaheadOption(updatedControl, answer.text);
      if (!selected) {
        return "RapidApply could not identify a unique typeahead option matching the approved answer.";
      }
    }
    return "applied";
  }

  if (control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type)) {
    if (answer.type === "checked") {
      if (isCheckableSatisfied(control, answer.checked)) return "already_satisfied";
      const activated = await activateCheckableVerified(() => {
        const current = resolveBinding()?.controls[0] ?? null;
        return current instanceof HTMLInputElement && ["checkbox", "radio"].includes(current.type)
          ? current
          : null;
      }, answer.checked);
      if (!activated) return "LinkedIn did not accept the approved checked state.";
      return "applied";
    }

    if (answer.type === "options") {
      if (control.type === "radio" && answer.optionIds.length !== 1) {
        return "Radio fields require exactly one selected option.";
      }
      const plannedOptions = answer.optionIds.map((id) =>
        record.field.options.find((candidate) => candidate.id === id)
      );
      if (plannedOptions.some((option) => !option)) {
        return "The planned option is not part of the observed field.";
      }
      const selectedLabels = new Set(
        plannedOptions.map((option) => normalize(option!.label)),
      );
      const live = resolveBinding();
      if (!live || live.controls.some((candidate) => !(candidate instanceof HTMLInputElement))) {
        return "The observed option group changed.";
      }
      const liveInputs = live.controls as HTMLInputElement[];
      const liveOptions = live.field.options ?? [];
      if (liveOptions.length !== liveInputs.length) return "The observed option group changed.";

      const targetIndexes = liveOptions
        .map((option, index) => selectedLabels.has(normalize(option.label)) ? index : -1)
        .filter((index) => index >= 0);
      if (targetIndexes.length !== selectedLabels.size) {
        return "RapidApply could not identify every approved option exactly.";
      }
      const targetSet = new Set(targetIndexes);
      const alreadySatisfied = liveInputs.every((input, index) =>
        isCheckableSatisfied(input, targetSet.has(index))
      );
      if (alreadySatisfied) return "already_satisfied";

      // Radio groups are controlled by LinkedIn's semantic role element. Click
      // only the approved option; manually forcing every sibling's checked
      // property bypasses the React state that validation reads.
      const indexesToActivate = control.type === "radio"
        ? targetIndexes
        : liveInputs.map((_, index) => index);
      for (const index of indexesToActivate) {
        const desired = targetSet.has(index);
        if (isCheckableSatisfied(liveInputs[index]!, desired)) continue;
        const activated = await activateCheckableVerified(() => {
          const current = resolveBinding()?.controls[index];
          return current instanceof HTMLInputElement &&
            ["radio", "checkbox"].includes(current.type)
            ? current
            : null;
        }, desired);
        if (!activated) return "LinkedIn did not accept the approved option selection.";
      }
      const finalBinding = resolveBinding();
      const finalInputs = finalBinding?.controls ?? [];
      if (finalInputs.length !== liveInputs.length || finalInputs.some((candidate, index) =>
        !(candidate instanceof HTMLInputElement) ||
        !isCheckableSatisfied(candidate, targetSet.has(index))
      )) {
        return "LinkedIn did not accept the approved option selection.";
      }
      return "applied";
    }

    return "The live control does not support this answer format.";
  }

  if (!(control instanceof HTMLSelectElement)) {
    return "The live control does not support this option selection.";
  }
  if (answer.type !== "options") return "Select elements require an options answer.";
  const options = answer.optionIds.map((id) =>
    record.field.options.find((candidate) => candidate.id === id)
  );
  if (options.some((option) => !option)) return "The planned option is not part of the observed field.";
  if (record.field.kind === "multi_select") {
    const labels = options.map((option) => option!.label);
    if (!hasUniqueNativeOptionLabels(control, labels)) {
      return "RapidApply could not identify every approved select option uniquely.";
    }
    const selectedLabels = new Set(
      [...control.options]
        .filter((option) => option.selected)
        .map((option) => normalize(option.textContent ?? "")),
    );
    if (
      selectedLabels.size === labels.length &&
      labels.every((label) => selectedLabels.has(normalize(label)))
    ) return "already_satisfied";
    await selectNativeOptionsVerified(() => {
      const current = resolveBinding()?.controls[0] ?? null;
      return current instanceof HTMLSelectElement ? current : null;
    }, labels);
    return "applied";
  }
  if (answer.optionIds.length !== 1) return "Single-select fields require one selected option.";
  const option = options[0];
  if (!option) return "The planned option is not part of the observed field.";
  if (!hasUniqueNativeOptionLabels(control, [option.label])) {
    return "RapidApply could not identify the approved select option uniquely.";
  }
  if ([...control.options].some((candidate) => candidate.value === control.value && candidate.textContent?.trim() === option.label)) {
    return "already_satisfied";
  }
  await selectNativeOptionVerified(() => {
    const current = resolveBinding()?.controls[0] ?? null;
    return current instanceof HTMLSelectElement ? current : null;
  }, {
    label: option.label,
  });
  return "applied";
}

function isCheckableSatisfied(input: HTMLInputElement, desired: boolean): boolean {
  const semanticControl = input.closest<HTMLElement>("[role='radio'], [role='checkbox']");
  const ariaChecked = semanticControl?.getAttribute("aria-checked");
  if (ariaChecked === "true" || ariaChecked === "false") {
    return input.checked === desired && ariaChecked === String(desired);
  }
  return input.checked === desired;
}

/**
 * Activates the control that owns LinkedIn's state, rather than only mutating
 * the native input. LinkedIn's SDUI radios and checkboxes render a native
 * input inside a role element whose click handler updates React state and
 * aria-checked. A native setter can make the control look selected while the
 * required-field validator still considers it empty.
 */
async function activateCheckableVerified(
  resolveControl: () => HTMLInputElement | null,
  desired: boolean,
): Promise<boolean> {
  const current = resolveControl();
  if (!current) return false;
  if (isCheckableSatisfied(current, desired)) return true;

  // LinkedIn has shipped several Easy Apply radio implementations. Some
  // attach the state handler to the role wrapper, some to the native input,
  // and older generations attach it to the associated label. Try each live
  // activation surface in a bounded order and verify the state after every
  // attempt. This preserves the legacy extension's useful native click tactic
  // without blindly clicking repeatedly or accepting a cosmetic checked state.
  const targets = [
    () => {
      const live = resolveControl();
      return live?.closest<HTMLElement>("[role='radio'], [role='checkbox']") ?? live;
    },
    () => resolveControl(),
    () => {
      const live = resolveControl();
      if (!live) return null;
      if (live.id) {
        const label = [...live.ownerDocument.querySelectorAll<HTMLLabelElement>("label[for]")]
          .find((candidate) => candidate.htmlFor === live.id) ?? null;
        if (label) return label;
      }
      return live.closest<HTMLElement>("label");
    },
  ];

  for (const resolveTarget of targets) {
    const target = resolveTarget();
    if (!target || !target.isConnected) continue;
    try {
      await clickElementAndWait(
        resolveTarget,
        () => {
          const live = resolveControl();
          return live ? isCheckableSatisfied(live, desired) : false;
        },
        { maxAttempts: 1, postconditionTimeoutMs: 1_500 },
      );
      return true;
    } catch {
      // Try the next known LinkedIn activation surface. The postcondition is
      // the authority; an unsuccessful click must never be reported as done.
    }
  }
  return false;
}

function hasUniqueNativeOptionLabels(
  control: HTMLSelectElement,
  labels: readonly string[],
): boolean {
  return labels.every((label) => {
    const target = normalize(label);
    return [...control.options].filter((option) =>
      normalize(option.textContent ?? "") === target
    ).length === 1;
  });
}

/**
 * Match a server-approved answer to the current Easy Apply control without
 * carrying any third-party selector or node reference over a navigation or
 * React rerender. The opaque field key is preferred; a unique label-and-kind
 * match handles the common case where LinkedIn changes sibling order.
 */
function resolveLiveApplicationField(
  document: Document,
  plannedField: ApplicationAnswerPlanRecord["field"],
): LinkedInObservedFieldBinding | null {
  const dialog = findLinkedInApplicationContainer(document);
  if (!dialog) return null;

  const bindings = observeLinkedInApplicationFieldBindings(dialog);
  const targetLabel = normalize(plannedField.question);
  const exactKey = bindings.filter((binding) => binding.field.key === plannedField.key);
  if (exactKey.length === 1) return exactKey[0] ?? null;

  const compatible = bindings.filter((binding) =>
    isCompatibleControl(binding.field.control, plannedField.kind)
  );
  const exactSemantic = compatible.filter((binding) =>
    normalize(binding.field.label) === targetLabel
  );
  return exactSemantic.length === 1 ? exactSemantic[0] ?? null : null;
}

function isCompatibleControl(
  control: AdapterObservation["fields"][number]["control"],
  kind: ApplicationAnswerPlanRecord["field"]["kind"],
): boolean {
  if (kind === "textarea") return control === "textarea";
  if (kind === "number") return control === "number";
  if (kind === "single_select") return control === "select";
  if (kind === "multi_select") return control === "select" || control === "checkbox";
  if (kind === "radio") return control === "radio";
  if (kind === "checkbox") return control === "checkbox";
  return ["text", "email", "tel", "other"].includes(control);
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isTypeaheadControl(control: HTMLElement): boolean {
  const container = control.closest(
    ".jobs-easy-apply-form-element, .fb-dash-form-element, [data-test-form-element], .search-typeahead-v2, .basic-typeahead, .artdeco-typeahead",
  );
  if (!container) return false;
  return Boolean(
    container.querySelector(
      ".search-typeahead-v2__hit-text, .basic-typeahead__hit, .basic-typeahead__selectable, .artdeco-typeahead__hit, li[role='option'], div[role='option'], [data-test-typeahead-option]",
    ),
  );
}

async function selectLinkedInTypeaheadOption(
  control: HTMLElement,
  approvedValue: string,
): Promise<boolean> {
  const container =
    control.closest(
      ".jobs-easy-apply-form-element, .fb-dash-form-element, [data-test-form-element], fieldset, form, [role='dialog'], .artdeco-modal",
    ) ?? control.ownerDocument;

  const selector = [
    ".search-typeahead-v2__hit-text",
    ".basic-typeahead__hit",
    ".basic-typeahead__selectable",
    ".search-typeahead-v2__hit",
    ".artdeco-typeahead__hit",
    "li[role='option']",
    "div[role='option']",
    "[data-test-typeahead-option]",
  ].join(", ");

  let hit: HTMLElement | null = null;
  try {
    hit = await waitForCondition(
      () => {
        const candidates = [...container.querySelectorAll<HTMLElement>(selector)]
          .filter(isLinkedInElementVisible);
        return chooseUniqueTypeaheadMatch(candidates, approvedValue);
      },
      { timeoutMs: 3_000, pollIntervalMs: 80, description: "LinkedIn typeahead option" },
    );
  } catch {
    return false;
  }

  if (hit && isLinkedInElementVisible(hit)) {
    const clickTarget = hit.closest<HTMLElement>(
      "li[role='option'], div[role='option'], li, .basic-typeahead__hit, .basic-typeahead__selectable, .search-typeahead-v2__hit, .artdeco-typeahead__hit, [data-test-typeahead-option]",
    ) ?? hit;
    clickElement(clickTarget);
    return true;
  }
  return false;
}

function chooseUniqueTypeaheadMatch(
  candidates: readonly HTMLElement[],
  approvedValue: string,
): HTMLElement | null {
  const target = normalize(approvedValue);
  if (!target) return null;

  const scored = candidates
    .map((candidate) => {
      const label = normalize(candidate.textContent ?? "");
      const score = label === target
        ? 3
        : label.startsWith(`${target} `) || target.startsWith(`${label} `)
          ? 2
          : (` ${label} `.includes(` ${target} `) || ` ${target} `.includes(` ${label} `))
            ? 1
            : 0;
      return { candidate, label, score };
    })
    .filter((entry) => entry.score > 0 && entry.label.length > 0);
  if (scored.length === 0) return null;

  const highestScore = Math.max(...scored.map((entry) => entry.score));
  const strongest = scored.filter((entry) => entry.score === highestScore);
  const distinctLabels = new Set(strongest.map((entry) => entry.label));
  return distinctLabels.size === 1 ? strongest[0]?.candidate ?? null : null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
