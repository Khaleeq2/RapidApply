import { NextRequest, NextResponse } from "next/server";
import { planExecutorApplicationAnswers } from "@/server/db/repositories/application-answer-plan-repository";
import { errorResponse } from "@/server/http/errors";
import { executorApplicationPlanInputSchema } from "@/server/http/run-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Capability-only endpoint. It accepts descriptors, never third-party DOM values. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = executorApplicationPlanInputSchema.parse(await request.json());
    const result = await planExecutorApplicationAnswers(input);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "plan application answers");
  }
}
