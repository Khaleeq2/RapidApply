import {
  isAnswerApplicationInterventionMessage,
  isDeferApplicationInterventionMessage,
  isShowApplicationInterventionCommand,
  isTouchApplicationInterventionMessage,
} from "../src/intervention/messages";

const intervention = {
  id: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  jobExternalId: "123456789",
  jobUrl: "https://www.linkedin.com/jobs/view/123456789/",
  observationFingerprint: "a1b2c3d4",
  field: {
    key: "01020304",
    question: "Which work arrangement do you prefer?",
    kind: "single_select",
    category: "other",
    required: true,
    options: [{ id: "05060708", label: "Remote" }],
  },
  status: "pending",
  createdAt: "2026-07-21T12:00:00.000Z",
  updatedAt: "2026-07-21T12:00:00.000Z",
} as const;

describe("application intervention messages", () => {
  it("accepts bounded extension-only answer commands", () => {
    expect(isShowApplicationInterventionCommand({
      type: "rapidapply.show-application-intervention",
      intervention,
    })).toBe(true);
    expect(isAnswerApplicationInterventionMessage({
      type: "rapidapply.answer-application-intervention",
      interventionId: intervention.id,
      response: {
        answer: { type: "options", optionIds: ["05060708"] },
        rememberScope: "campaign",
        autoUse: true,
      },
    })).toBe(true);
    expect(isDeferApplicationInterventionMessage({
      type: "rapidapply.defer-application-intervention",
      interventionId: intervention.id,
    })).toBe(true);
    expect(isTouchApplicationInterventionMessage({
      type: "rapidapply.touch-application-intervention",
      interventionId: intervention.id,
    })).toBe(true);
  });

  it("rejects malformed responses and unexpected message fields", () => {
    expect(isAnswerApplicationInterventionMessage({
      type: "rapidapply.answer-application-intervention",
      interventionId: intervention.id,
      response: { answer: { type: "options", optionIds: ["not-an-opaque-id"] } },
    })).toBe(false);
    expect(isShowApplicationInterventionCommand({
      type: "rapidapply.show-application-intervention",
      intervention,
      injected: true,
    })).toBe(false);
  });
});
