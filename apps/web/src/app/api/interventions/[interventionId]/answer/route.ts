import { NextRequest, NextResponse } from "next/server";
import type { ApplicationInterventionResponse } from "@rapidapply/contracts";
import { getCurrentUser } from "@/server/auth/current-user";
import { resolveApplicationInterventionForUser } from "@/server/db/repositories/application-intervention-repository";
import { errorResponse } from "@/server/http/errors";
import { userApplicationInterventionResponseInputSchema } from "@/server/http/run-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InterventionAnswerRouteContext {
  params: { interventionId: string };
}

export async function POST(
  request: NextRequest,
  context: InterventionAnswerRouteContext,
): Promise<NextResponse> {
  try {
    const response = userApplicationInterventionResponseInputSchema.parse(await request.json());
    const user = await getCurrentUser();
    const result = await resolveApplicationInterventionForUser({
      userId: user.id,
      interventionId: context.params.interventionId,
      response: response as ApplicationInterventionResponse,
    });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "answer application intervention");
  }
}
