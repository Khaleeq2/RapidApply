import { NextRequest, NextResponse } from "next/server";
import { getExecutorRunStatus } from "@/server/db/repositories/run-repository";
import { errorResponse } from "@/server/http/errors";
import { executorStatusInputSchema } from "@/server/http/run-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns only the run bound to the caller's existing executor capability. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = executorStatusInputSchema.parse(await request.json());
    const run = await getExecutorRunStatus(input);
    return NextResponse.json({ run }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "read executor status");
  }
}
