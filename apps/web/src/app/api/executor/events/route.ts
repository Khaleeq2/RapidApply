import { NextRequest, NextResponse } from "next/server";
import { appendExecutorRunEvent } from "@/server/db/repositories/run-repository";
import { errorResponse } from "@/server/http/errors";
import { executorRunEventInputSchema } from "@/server/http/run-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Capability-only endpoint for the extension's short-lived execution session.
 * It intentionally does not accept a browser user session and it does not
 * enable any site adapter by itself.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = executorRunEventInputSchema.parse(await request.json());
    const result = await appendExecutorRunEvent(input);

    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "append executor event");
  }
}
