import { NextRequest, NextResponse } from "next/server";
import type { ApplicationInterventionResponse } from "@rapidapply/contracts";
import {
  deferApplicationInterventionForExecutor,
  resolveApplicationInterventionForExecutor,
  touchApplicationInterventionForExecutor,
} from "@/server/db/repositories/application-intervention-repository";
import { errorResponse } from "@/server/http/errors";
import { executorApplicationInterventionActionInputSchema } from "@/server/http/run-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InterventionRouteContext {
  params: { interventionId: string };
}

export async function POST(
  request: NextRequest,
  context: InterventionRouteContext,
): Promise<NextResponse> {
  try {
    const input = executorApplicationInterventionActionInputSchema.parse(await request.json());
    if (input.action === "answer") {
      const result = await resolveApplicationInterventionForExecutor({
        ...input,
        interventionId: context.params.interventionId,
        response: input.response! as ApplicationInterventionResponse,
      });
      return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
    }
    if (input.action === "defer") {
      const result = await deferApplicationInterventionForExecutor({
        ...input,
        interventionId: context.params.interventionId,
      });
      return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
    }
    const intervention = await touchApplicationInterventionForExecutor({
      ...input,
      interventionId: context.params.interventionId,
    });
    return NextResponse.json({ intervention }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "update application intervention");
  }
}
