import type { AdapterObservation, ObservedField } from "../adapters/types";

/**
 * Resume selection is deliberately kept out of the generic field filler.
 * Until a candidate-approved document is already attached in LinkedIn, the
 * helper stops here instead of clicking through a required-upload error.
 */
export function needsManualResumeSelection(observation: AdapterObservation): boolean {
  return observation.pageType === "application_form" &&
    observation.fields.some((field) => isResumeSelectionField(observation, field));
}

export function isResumeSelectionField(
  observation: AdapterObservation,
  field: ObservedField,
): boolean {
  if (field.control !== "file" || field.disabled || field.hasValue) return false;
  return observation.applicationStep === "resume" ||
    /(?:\bresume\b|\bcv\b|curriculum vitae)/i.test(field.label);
}
