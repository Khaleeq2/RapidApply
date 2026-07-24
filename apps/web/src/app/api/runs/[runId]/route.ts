import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { getApplicationRun, listRunEvents } from "@/server/db/repositories/run-repository";
import { errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RunRouteContext {
  params: { runId: string };
}

export async function GET(_request: NextRequest, context: RunRouteContext): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    const [run, events] = await Promise.all([
      getApplicationRun(user.id, context.params.runId),
      listRunEvents(user.id, context.params.runId),
    ]);

    return NextResponse.json({ run, events });
  } catch (error) {
    return errorResponse(error, "get run");
  }
}
