import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { prepareExecutionTicket } from "@/server/db/repositories/run-repository";
import { errorResponse } from "@/server/http/errors";
import { prepareExecutorInputSchema } from "@/server/http/run-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExecutorTicketRouteContext {
  params: { runId: string };
}

export async function POST(
  request: NextRequest,
  context: ExecutorTicketRouteContext,
): Promise<NextResponse> {
  try {
    const body = await request.text();
    const input = prepareExecutorInputSchema.parse(body ? JSON.parse(body) : {});
    const user = await getCurrentUser();
    const result = await prepareExecutionTicket(user.id, context.params.runId, input);
    return NextResponse.json(result, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, "prepare execution ticket");
  }
}
