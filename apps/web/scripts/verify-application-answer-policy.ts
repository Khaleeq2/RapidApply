import assert from "node:assert/strict";
import type { ApplicationFieldDescriptor, CandidateProfile } from "@rapidapply/contracts";
import {
  planApplicationAnswer,
  validateAiApplicationAnswer,
} from "../src/server/ai/application-answer-policy";
import { createGroundedApplicationAnswer } from "../src/server/ai/application-answer-provider";

const profile: CandidateProfile = {
  fullName: "Fixture Candidate",
  contactEmail: "candidate@example.test",
  phone: "+1 555 010 1000",
  location: "New York, NY",
  headline: "Product Designer",
  summary: "Designs clear workflows for complex products.",
  linkedinUrl: "",
  portfolioUrl: "",
  authorizedToWork: "yes",
  requiresSponsorship: "no",
  autopilot: { mode: "verified", questionTimeoutSeconds: 15, autoSkipOptionalFields: true },
};

const emailField = field({ category: "contact_email", question: "Email address" });
const emailPlan = planApplicationAnswer(emailField, context());
assert.equal(emailPlan.plan.strategy, "deterministic");
assert.deepEqual(emailPlan.deterministicAnswer?.answer, {
  type: "text",
  text: "candidate@example.test",
});

const portfolioField = field({
  category: "portfolio_url",
  question: "Portfolio URL",
});
const portfolioPlan = planApplicationAnswer(portfolioField, {
  ...context(),
  profile: {
    ...profile,
    portfolioUrl: "https://portfolio.example.test/candidate",
  },
});
assert.deepEqual(portfolioPlan.deterministicAnswer?.answer, {
  type: "text",
  text: "https://portfolio.example.test/candidate",
});

const fullNameField = field({
  category: "full_name",
  question: "Full legal name",
});
assert.deepEqual(planApplicationAnswer(fullNameField, context()).deterministicAnswer?.answer, {
  type: "text",
  text: "Fixture Candidate",
});

const summaryField = field({
  kind: "textarea",
  category: "professional_summary",
  question: "Professional summary",
});
assert.deepEqual(planApplicationAnswer(summaryField, context()).deterministicAnswer?.answer, {
  type: "text",
  text: profile.summary,
});

const postalCodeField = field({
  category: "location",
  question: "Postal code",
});
const postalCodePlan = planApplicationAnswer(postalCodeField, context());
assert.equal(
  postalCodePlan.deterministicAnswer,
  undefined,
  "a general profile location must not be copied into a postal-code field",
);

const authorizationField = field({
  kind: "single_select",
  category: "work_authorization",
  question: "Are you authorized to work in the United States?",
  options: [
    { id: "option-yes", label: "Yes" },
    { id: "option-no", label: "No" },
  ],
});
assert.deepEqual(planApplicationAnswer(authorizationField, context()).deterministicAnswer?.answer, {
  type: "options",
  optionIds: ["option-yes"],
});
assert.equal(
  planApplicationAnswer(authorizationField, {
    ...context(),
    profile: { ...profile, authorizedToWork: "not_specified" },
  }).plan.strategy,
  "user_input",
  "an unspecified legal work-status fact must never be delegated to the model",
);

const availabilityField = field({
  category: "availability",
  question: "When can you start?",
});
assert.equal(
  planApplicationAnswer(availabilityField, context()).plan.strategy,
  "user_input",
  "candidate availability must come from an explicit approved answer",
);

const ambiguousSponsorshipField = field({
  kind: "single_select",
  category: "sponsorship",
  question: "Will you require sponsorship?",
  options: [
    { id: "sponsor-now", label: "Yes, now" },
    { id: "sponsor-later", label: "Yes, later" },
    { id: "sponsor-no", label: "No" },
  ],
});
const ambiguousSponsorshipPlan = planApplicationAnswer(ambiguousSponsorshipField, {
  ...context(),
  profile: { ...profile, requiresSponsorship: "yes" },
});
assert.equal(ambiguousSponsorshipPlan.plan.strategy, "user_input");
assert.equal(
  ambiguousSponsorshipPlan.deterministicAnswer,
  undefined,
  "a boolean profile fact must not pick the first of several qualified Yes options",
);

const prepopulatedPhoneSelector = field({
  kind: "single_select",
  category: "phone",
  question: "Phone country code",
  options: [{ id: "option-us", label: "United States (+1)" }],
});
const phonePlan = planApplicationAnswer(prepopulatedPhoneSelector, context());
assert.equal(phonePlan.plan.strategy, "deterministic");
assert.deepEqual(phonePlan.deterministicAnswer?.answer, {
  type: "options",
  optionIds: ["option-us"],
});

const ambiguousPhoneSelector = field({
  kind: "single_select",
  category: "phone",
  question: "Phone country code",
  options: [
    { id: "option-us", label: "United States (+1)" },
    { id: "option-ca", label: "Canada (+1)" },
  ],
});
const ambiguousPhonePlan = planApplicationAnswer(ambiguousPhoneSelector, context());
assert.equal(ambiguousPhonePlan.plan.strategy, "ai_option");
assert.equal(
  ambiguousPhonePlan.deterministicAnswer,
  undefined,
  "a shared dialing prefix must not silently select one country",
);

const openTextField = field({
  kind: "textarea",
  category: "open_text",
  question: "Why is this role a strong fit?",
  constraints: { maxLength: 500 },
});
assert.equal(planApplicationAnswer(openTextField, context()).plan.strategy, "ai_text");

const demographicField = field({
  kind: "single_select",
  category: "demographic",
  question: "Please select a demographic response.",
  options: [{ id: "decline", label: "Prefer not to say" }],
});
assert.equal(planApplicationAnswer(demographicField, context()).plan.strategy, "user_input");

const unsupportedScreeningClaim = field({
  kind: "radio",
  category: "other",
  question: "Have you managed an acquisition integration?",
  options: [
    { id: "screening-yes", label: "Yes" },
    { id: "screening-no", label: "No" },
  ],
});
const screeningPlan = planApplicationAnswer(unsupportedScreeningClaim, context());
assert.equal(screeningPlan.plan.strategy, "ai_option");
assert.equal(
  screeningPlan.deterministicAnswer,
  undefined,
  "an option's presence must never fabricate a Yes or first-option decision",
);

const contextualExperienceField = field({
  kind: "number",
  category: "years_experience",
  question: "How many years of product design experience do you have?",
  constraints: { minimum: 0, maximum: 50 },
});
const contextualExperiencePlan = planApplicationAnswer(contextualExperienceField, {
  ...context(),
  profile: {
    ...profile,
    summary: "Ten years in technology, including two years focused on product design.",
  },
});
assert.equal(contextualExperiencePlan.plan.strategy, "ai_text");
assert.equal(
  contextualExperiencePlan.deterministicAnswer,
  undefined,
  "a generic duration in prose must not be copied into a skill-specific experience field",
);

const validCandidate = validateAiApplicationAnswer(
  {
    answer: {
      type: "text",
      text: "My experience designing complex workflows aligns with the role's focus on clear product decisions.",
    },
    provenanceIds: ["profile.summary", "job.description"],
    confidence: 0.86,
    rationaleCode: "grounded_synthesis",
  },
  openTextField,
  ["profile.summary", "job.description"],
);
assert.equal(validCandidate.success, true);

const invalidStyle = validateAiApplicationAnswer(
  {
    answer: { type: "text", text: "I am thrilled to delve into this role—my background is a great fit." },
    provenanceIds: ["profile.summary"],
    confidence: 0.8,
    rationaleCode: "grounded_synthesis",
  },
  openTextField,
  ["profile.summary"],
);
assert.equal(invalidStyle.success, false);

const invalidOption = validateAiApplicationAnswer(
  {
    answer: { type: "options", optionIds: ["made-up-option"] },
    provenanceIds: ["profile.authorizedToWork"],
    confidence: 0.99,
    rationaleCode: "best_matching_option",
  },
  authorizationField,
  ["profile.authorizedToWork"],
);
assert.equal(invalidOption.success, false);

const ungrounded = validateAiApplicationAnswer(
  {
    answer: { type: "text", text: "My product workflow experience is relevant to this role." },
    provenanceIds: ["invented.fact"],
    confidence: 0.95,
    rationaleCode: "direct_fact",
  },
  openTextField,
  ["profile.summary", "job.description"],
);
assert.equal(ungrounded.success, false);

const extraOutput = validateAiApplicationAnswer(
  {
    answer: { type: "text", text: "My product workflow experience is relevant to this role." },
    provenanceIds: ["profile.summary"],
    confidence: 0.9,
    rationaleCode: "direct_fact",
    javascript: "document.querySelector('button').click()",
  },
  openTextField,
  ["profile.summary"],
);
assert.equal(extraOutput.success, false);

void verifyLiveProvider()
  .then(() => {
    console.log("Application answer policy verified: deterministic facts, live structured AI resolution, style, provenance, confidence, and option bounds passed.");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });

async function verifyLiveProvider(): Promise<void> {
  const previousProvider = process.env.RAPIDAPPLY_AI_PROVIDER;
  const previousGroqKey = process.env.GROQ_API_KEY;
  const previousGroqModel = process.env.GROQ_MODEL;
  process.env.RAPIDAPPLY_AI_PROVIDER = "groq";
  process.env.GROQ_API_KEY = "verification-key";
  process.env.GROQ_MODEL = "verification-model";

  try {
    let providerRequestBody = "";
    const grounded = await createGroundedApplicationAnswer({
      field: openTextField,
      profile,
      job: {
        title: "Product Designer",
        description: "Design complex workflows and communicate product decisions.",
      },
      confidenceThreshold: 0.75,
      requiresReview: false,
      fetcher: async (_input, init) => {
        providerRequestBody = String(init?.body ?? "");
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                status: "resolved",
                answerType: "text",
                text: "I design clear workflows for complex products and communicate product decisions directly.",
                optionIds: [],
                checked: false,
                provenanceIds: ["profile.summary", "job.description"],
                confidence: 0.91,
                rationaleCode: "grounded_synthesis",
              }),
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    assert.equal(grounded.outcome, "resolved");
    assert.equal(grounded.decision?.source, "ai");
    assert.equal(grounded.decision?.requiresReview, false);
    assert.equal(grounded.decision?.provider, "groq");
    assert.ok(!providerRequestBody.includes(profile.contactEmail), "AI evidence must exclude direct contact data");
  } finally {
    if (previousProvider === undefined) delete process.env.RAPIDAPPLY_AI_PROVIDER;
    else process.env.RAPIDAPPLY_AI_PROVIDER = previousProvider;
    if (previousGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousGroqKey;
    if (previousGroqModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = previousGroqModel;
  }
}

function context() {
  return {
    profile,
    aiEnabled: true,
    hasJobDescription: true,
  };
}

function field(overrides: Partial<ApplicationFieldDescriptor>): ApplicationFieldDescriptor {
  return {
    key: "fixture-field",
    question: "Fixture question",
    kind: "text",
    category: "other",
    required: true,
    options: [],
    ...overrides,
  };
}
