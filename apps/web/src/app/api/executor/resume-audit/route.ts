import { NextRequest, NextResponse } from "next/server";
import { auditExecutorResume } from "@/server/db/repositories/resume-repository";
import { errorResponse } from "@/server/http/errors";
import { resumeAuditInputSchema } from "@/server/http/run-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = resumeAuditInputSchema.parse(await request.json());
    const result = await auditExecutorResume(input);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "audit executor resume");
  }
}
