import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { appendRunEvent } from "@/server/db/repositories/run-repository";
import { errorResponse } from "@/server/http/errors";
import { userControlledRunEventInputSchema } from "@/server/http/run-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RunEventRouteContext {
  params: { runId: string };
}

export async function POST(
  request: NextRequest,
  context: RunEventRouteContext,
): Promise<NextResponse> {
  try {
    const input = userControlledRunEventInputSchema.parse(await request.json());
    const user = await getCurrentUser();
    const result = await appendRunEvent(user.id, context.params.runId, input);

    return NextResponse.json(result, { status: result.deduplicated ? 200 : 201 });
  } catch (error) {
    return errorResponse(error, "append run event");
  }
}
