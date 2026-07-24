import { NextRequest, NextResponse } from "next/server";
import { claimExecutionTicket } from "@/server/db/repositories/run-repository";
import { errorResponse } from "@/server/http/errors";
import { claimExecutorInputSchema } from "@/server/http/run-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * This endpoint deliberately authenticates only with a one-time execution
 * capability. The browser helper never receives database credentials or a
 * general-purpose user session token.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = claimExecutorInputSchema.parse(await request.json());
    const session = await claimExecutionTicket(input);
    return NextResponse.json(
      session,
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, "claim executor");
  }
}
