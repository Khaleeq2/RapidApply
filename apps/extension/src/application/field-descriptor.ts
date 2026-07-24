import type {
  ApplicationFieldDescriptor,
  ApplicationFieldKind,
  ApplicationQuestionCategory,
} from "@rapidapply/contracts";
import type { ObservedField } from "../adapters/types";

/**
 * Converts a privacy-preserving adapter observation into the contract consumed
 * by the answer planner. The adapter owns DOM facts; this module owns the
 * semantic classification that used to be spread across the legacy script's
 * question-specific branches.
 */
export function describeObservedApplicationField(field: ObservedField): ApplicationFieldDescriptor {
  const kind = toApplicationFieldKind(field);
  return {
    key: field.key,
    question: field.label,
    kind,
    category: classifyApplicationQuestion(field.label, field.control),
    required: field.required,
    options: field.options ?? [],
    constraints: inferConstraints(field, kind),
  };
}

export function describeObservedApplicationFields(fields: readonly ObservedField[]): ApplicationFieldDescriptor[] {
  return fields.map(describeObservedApplicationField);
}

/**
 * A LinkedIn application can arrive with account-managed contact controls
 * already populated. Those values are already in the candidate's browser
 * session, so they must be preserved rather than re-planned or overwritten
 * from a potentially different RapidApply profile value.
 */
export function describeActionableApplicationFields(
  fields: readonly ObservedField[],
): ApplicationFieldDescriptor[] {
  return fields
    .filter((field) => !field.disabled && !field.hasValue)
    .map(describeObservedApplicationField);
}

export function classifyApplicationQuestion(
  label: string,
  control: ObservedField["control"],
): ApplicationQuestionCategory {
  const text = normalize(label);

  if (/(full|legal|preferred) name/.test(text)) return "full_name";
  if (/(email|e-mail)/.test(text)) return "contact_email";
  if (/(phone|telephone|mobile|cell(?:ular)?)/.test(text)) return "phone";
  if (
    /^(linkedin|linked in)$|(?:linkedin|linked in).*(?:url|profile|link)|(?:url|profile|link).*(?:linkedin|linked in)/.test(text)
  ) return "linkedin_url";
  if (/\bportfolio\b|^(personal )?(website|site)( url| link)?$/.test(text)) {
    return "portfolio_url";
  }
  if (/(professional headline|profile headline)/.test(text)) return "headline";
  if (/(professional summary|profile summary)/.test(text)) return "professional_summary";
  if (/(sponsor|require sponsorship|visa sponsorship)/.test(text)) return "sponsorship";
  if (/(work authorization|authorized to work|legally eligible)/.test(text)) return "work_authorization";
  if (/(years? of experience|experience.*years?|years?.*experience|how long.*experience)/.test(text)) {
    return "years_experience";
  }
  if (/(city|state|province|country|zip|postal|location|address)/.test(text)) return "location";
  if (/(salary|compensation|pay range|hourly rate|desired pay|expected pay)/.test(text)) {
    return "compensation";
  }
  if (/(security clearance|clearance level)/.test(text)) return "security_clearance";
  if (/(criminal|background check|convicted|felony|misdemeanor)/.test(text)) return "background_check";
  if (/(disability|disabled|accommodation)/.test(text)) return "disability";
  if (/(veteran|military service)/.test(text)) return "veteran_status";
  if (/(race|ethnicity|gender|sexual orientation|pronoun|demographic)/.test(text)) return "demographic";
  if (/(consent|agree|acknowledge|certify|attest|terms and conditions)/.test(text)) return "consent";
  if (/(education|degree|school|university|college|major)/.test(text)) return "education";
  if (/(available|start date|notice period|when can you start)/.test(text)) return "availability";
  if (control === "textarea" || /(describe|explain|why|tell us|cover letter|additional information|summary)/.test(text)) {
    return "open_text";
  }
  return "other";
}

function toApplicationFieldKind(field: ObservedField): ApplicationFieldKind {
  switch (field.control) {
    case "textarea":
      return "textarea";
    case "number":
      return "number";
    case "select":
      return field.multiple ? "multi_select" : "single_select";
    case "radio":
      return "radio";
    case "checkbox":
      // A single checkbox is a boolean acknowledgement. Several checkbox
      // controls grouped under one name or fieldset are one multi-select
      // question and must reach the planner and review UI as such.
      return (field.options?.length ?? 0) > 1 ? "multi_select" : "checkbox";
    default:
      return "text";
  }
}

function inferConstraints(
  field: ObservedField,
  kind: ApplicationFieldKind,
): ApplicationFieldDescriptor["constraints"] {
  const constraints = { ...field.constraints };
  if (kind !== "number" || !field.validationMessage) {
    return Object.keys(constraints).length > 0 ? constraints : undefined;
  }

  const numbers = [...field.validationMessage.matchAll(/\b\d+(?:\.\d+)?\b/g)]
    .map((match) => Number(match[0]));
  if (numbers.length >= 2) {
    constraints.minimum ??= numbers[0];
    constraints.maximum ??= numbers[1];
  }

  return Object.keys(constraints).length > 0 ? constraints : undefined;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
