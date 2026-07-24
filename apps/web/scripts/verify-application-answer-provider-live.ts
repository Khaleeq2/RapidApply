import assert from "node:assert/strict";
import type { ApplicationFieldDescriptor, CandidateProfile } from "@rapidapply/contracts";
import "../src/server/db/config";
import { createGroundedApplicationAnswer } from "../src/server/ai/application-answer-provider";

const profile: CandidateProfile = {
  fullName: "Provider Verification",
  contactEmail: "provider-verification@rapidapply.local",
  phone: "+1 555 010 0000",
  location: "New York, NY",
  headline: "Product Designer",
  summary: "Designs clear workflows for complex products.",
  linkedinUrl: "",
  portfolioUrl: "",
  authorizedToWork: "yes",
  requiresSponsorship: "no",
  autopilot: {
    mode: "smart",
    questionTimeoutSeconds: 15,
    autoSkipOptionalFields: true,
  },
};

const optionField: ApplicationFieldDescriptor = {
  key: "a1b2c3d4",
  question: "Are you authorized to work in the United States?",
  kind: "radio",
  category: "work_authorization",
  required: true,
  options: [
    { id: "11111111", label: "Yes" },
    { id: "22222222", label: "No" },
  ],
};

async function main(): Promise<void> {
  let providerContent = "";
  const result = await createGroundedApplicationAnswer({
    field: optionField,
    profile,
    job: { title: "Product Designer", targetRole: "Product Designer" },
    confidenceThreshold: 0.5,
    requiresReview: false,
    fetcher: async (input, init) => {
      const response = await fetch(input, init);
      const payload: unknown = await response.clone().json().catch(() => null);
      providerContent = readProviderContent(payload);
      return response;
    },
  });

  if (result.outcome !== "resolved") {
    throw new Error(
      `Application-answer provider outcome: ${result.outcome}` +
      (result.diagnosticCode ? ` (${result.diagnosticCode})` : "") +
      (providerContent ? `; ${describeProviderContent(providerContent)}` : ""),
    );
  }
  assert.equal(result.outcome, "resolved");
  assert.equal(result.decision?.source, "ai");
  assert.deepEqual(
    result.decision?.status === "resolved" ? result.decision.answer : undefined,
    { type: "options", optionIds: ["11111111"] },
  );
  assert.equal(result.decision?.requiresReview, false);
  assert.ok(result.decision?.provider);
  assert.ok(result.decision?.model);

  let textProviderContent = "";
  const textField: ApplicationFieldDescriptor = {
    key: "b2c3d4e5",
    question: "Briefly explain why your background fits this product design role.",
    kind: "textarea",
    category: "open_text",
    required: true,
    options: [],
    constraints: { minLength: 20, maxLength: 300 },
  };
  const textResult = await createGroundedApplicationAnswer({
    field: textField,
    profile,
    job: {
      title: "Product Designer",
      targetRole: "Product Designer",
      description: "Design clear workflows for complex products and communicate product decisions.",
    },
    confidenceThreshold: 0.5,
    requiresReview: false,
    fetcher: async (input, init) => {
      const response = await fetch(input, init);
      const payload: unknown = await response.clone().json().catch(() => null);
      textProviderContent = readProviderContent(payload);
      return response;
    },
  });
  if (textResult.outcome !== "resolved") {
    throw new Error(
      `Application-answer text provider outcome: ${textResult.outcome}` +
      (textResult.diagnosticCode ? ` (${textResult.diagnosticCode})` : "") +
      (textProviderContent ? `; ${describeProviderContent(textProviderContent)}` : ""),
    );
  }
  assert.equal(
    textResult.decision?.status === "resolved"
      ? textResult.decision.answer.type
      : undefined,
    "text",
  );
  assert.equal(textResult.decision?.requiresReview, false);

  // Deliberately do not print prompts, provider responses, profile values, or credentials.
  console.log(`Live option and free-text application answers verified with ${result.decision.provider}.`);
}

function readProviderContent(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices)) return "";
  const choice = value.choices[0];
  return isRecord(choice) && isRecord(choice.message) &&
    typeof choice.message.content === "string"
    ? choice.message.content
    : "";
}

function describeProviderContent(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return "provider content was valid JSON but not an object";
    const optionTypes = Array.isArray(parsed.optionIds)
      ? parsed.optionIds.map((item) => typeof item).join("|")
      : typeof parsed.optionIds;
    const provenanceTypes = Array.isArray(parsed.provenanceIds)
      ? parsed.provenanceIds.map((item) => typeof item).join("|")
      : typeof parsed.provenanceIds;
    return [
      `provider JSON keys=${Object.keys(parsed).sort().join(",")}`,
      `status=${String(parsed.status)}`,
      `answerType=${String(parsed.answerType)}`,
      `rationaleCode=${String(parsed.rationaleCode)}`,
      `textType=${typeof parsed.text}`,
      `optionTypes=${optionTypes}`,
      `checkedType=${typeof parsed.checked}`,
      `provenanceTypes=${provenanceTypes}`,
      `confidenceType=${typeof parsed.confidence}`,
    ].join("; ");
  } catch {
    return "provider content was not valid JSON";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : "unknown failure";
  console.error(`Live application-answer provider verification failed: ${detail}`);
  process.exitCode = 1;
});
