import { NextRequest, NextResponse } from "next/server";
import { getExecutorResumeDocument } from "@/server/db/repositories/resume-repository";
import { errorResponse } from "@/server/http/errors";
import { executorResumeInputSchema } from "@/server/http/run-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Capability-only delivery for the role already bound to the claimed run. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = executorResumeInputSchema.parse(await request.json());
    const resume = await getExecutorResumeDocument(input);
    return NextResponse.json({ resume }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "deliver executor resume");
  }
}
