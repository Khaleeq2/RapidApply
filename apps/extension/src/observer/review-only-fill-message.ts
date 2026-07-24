import type { ApplicationAnswerPlanRecord } from "@rapidapply/contracts";

export interface ReviewOnlyFillResult {
  appliedFieldKeys: string[];
  alreadySatisfiedFieldKeys: string[];
  blocked: Array<{ fieldKey: string; reason: string }>;
}

export type ReviewOnlyFillResponse =
  | { ok: true; result: ReviewOnlyFillResult }
  | { ok: false; reason?: string };

interface ReviewOnlyFillMessage {
  type: "rapidapply.apply-review-only-answers";
  plans: readonly ApplicationAnswerPlanRecord[];
}

export interface SendReviewOnlyFillOptions {
  plans: readonly ApplicationAnswerPlanRecord[];
  send: (message: ReviewOnlyFillMessage) => Promise<unknown>;
  wait?: (milliseconds: number) => Promise<void>;
}

/**
 * Sends the idempotent, review-only fill command to the page adapter.
 *
 * A transport retry is safe here because the page executor first verifies a
 * live field value before changing it. It is intentionally isolated from
 * review, navigation, upload, and submit actions, which are never retried by
 * this transport helper.
 */
export async function sendReviewOnlyFillWithRetry({
  plans,
  send,
  wait = waitForContentScriptReady,
}: SendReviewOnlyFillOptions): Promise<ReviewOnlyFillResponse> {
  let transportReason = "RapidApply could not contact its LinkedIn page helper.";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await send({
        type: "rapidapply.apply-review-only-answers",
        plans,
      });
      if (isReviewOnlyFillResponse(response)) return response;
      if (isReviewOnlyFillFailure(response)) {
        return { ok: false, reason: response.reason ?? "RapidApply could not verify the application fill result." };
      }
      transportReason = "RapidApply received an incomplete response from its LinkedIn page helper.";
    } catch (error) {
      transportReason = fillMessageTransportReason(error);
    }

    if (attempt < 3) await wait(attempt * 150);
  }

  return { ok: false, reason: transportReason };
}

function isReviewOnlyFillResponse(value: unknown): value is Extract<ReviewOnlyFillResponse, { ok: true }> {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.result)) return false;
  return Array.isArray(value.result.appliedFieldKeys) &&
    Array.isArray(value.result.alreadySatisfiedFieldKeys) &&
    Array.isArray(value.result.blocked);
}

function isReviewOnlyFillFailure(value: unknown): value is Extract<ReviewOnlyFillResponse, { ok: false }> {
  return isRecord(value) && value.ok === false &&
    (typeof value.reason === "string" || value.reason === undefined);
}

function fillMessageTransportReason(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("receiving end does not exist") || message.includes("message port closed")
    ? "RapidApply is waiting for its LinkedIn page helper to become ready."
    : "RapidApply could not contact its LinkedIn page helper.";
}

function waitForContentScriptReady(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
