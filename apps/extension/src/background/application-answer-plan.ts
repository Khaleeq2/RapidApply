import type {
  ApplicationAnswerPlanRecord,
  ApplicationFieldDescriptor,
  ExtensionExecutionSession,
} from "@rapidapply/contracts";
import type { ObservedJob } from "../adapters/types";

/**
 * A deliberately small, non-sensitive description of a planner transport
 * failure. The background controller uses this to select a safe visible
 * outcome instead of collapsing the whole observation into an opaque error.
 */
export class ApplicationAnswerPlanningError extends Error {
  constructor(
    public readonly code: "network" | "invalid_response" | "http_error",
    public readonly status?: number,
  ) {
    super(code === "http_error"
      ? `Application answer planner returned HTTP ${status ?? "error"}.`
      : code === "network"
        ? "Application answer planner could not be reached."
        : "Application answer planner returned an invalid response.");
    this.name = "ApplicationAnswerPlanningError";
  }
}

export async function requestApplicationAnswerPlans(input: {
  session: ExtensionExecutionSession;
  jobExternalId: string;
  observationFingerprint: string;
  fields: ApplicationFieldDescriptor[];
  jobContext?: ObservedJob;
}): Promise<ApplicationAnswerPlanRecord[]> {
  let response: Response;
  try {
    response = await fetch(new URL("/api/executor/application-plan", input.session.controllerOrigin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: input.session.runId,
        executorSessionId: input.session.executorSessionId,
        executorEventToken: input.session.executorEventCapability.token,
        jobExternalId: input.jobExternalId,
        observationFingerprint: input.observationFingerprint,
        fields: input.fields,
        jobContext: {
          ...input.jobContext,
          targetRole: input.session.executionPlan.targetRole,
        },
      }),
    });
  } catch {
    throw new ApplicationAnswerPlanningError("network");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApplicationAnswerPlanningError("http_error", response.status);
  }
  if (!isPlanResponse(payload)) {
    throw new ApplicationAnswerPlanningError("invalid_response");
  }
  return payload.plans;
}

function isPlanResponse(value: unknown): value is { plans: ApplicationAnswerPlanRecord[] } {
  return typeof value === "object" && value !== null &&
    Array.isArray((value as { plans?: unknown }).plans);
}
