import type { ExtensionExecutionSession } from "@rapidapply/contracts";
import {
  ApplicationAnswerPlanningError,
  requestApplicationAnswerPlans,
} from "../src/background/application-answer-plan";

describe("application answer planner transport", () => {
  it("preserves a safe HTTP failure classification for the controller", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "invalid ticket" }),
    }) as Response);
    vi.stubGlobal("fetch", fetcher);

    await expect(requestApplicationAnswerPlans({
      session: session(),
      jobExternalId: "123456789",
      observationFingerprint: "deadbeef",
      fields: [field()],
    })).rejects.toMatchObject({
      name: "ApplicationAnswerPlanningError",
      code: "http_error",
      status: 401,
    });
  });

  it("classifies an unreachable planner without inventing an answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    await expect(requestApplicationAnswerPlans({
      session: session(),
      jobExternalId: "123456789",
      observationFingerprint: "deadbeef",
      fields: [field()],
    })).rejects.toMatchObject({
      code: "network",
    });
  });

  afterEach(() => vi.unstubAllGlobals());
});

function session(): ExtensionExecutionSession {
  return {
    controllerOrigin: "http://localhost:3000",
    runId: "5f0fa6a1-6916-4459-9e24-835510cbc6f8",
    executorSessionId: "f0ef7d5b-3d8a-44c7-9d8c-ae80dac714ca",
    executorEventCapability: {
      runId: "5f0fa6a1-6916-4459-9e24-835510cbc6f8",
      token: "x".repeat(64),
      expiresAt: "2026-07-24T00:00:00.000Z",
    },
    executionPlan: { targetRole: "Product Designer" },
  } as ExtensionExecutionSession;
}

function field() {
  return {
    key: "01234567",
    question: "Are you authorized to work?",
    kind: "radio" as const,
    category: "work_authorization" as const,
    required: true,
    options: [
      { id: "76543210", label: "Yes" },
      { id: "12345678", label: "No" },
    ],
  };
}
