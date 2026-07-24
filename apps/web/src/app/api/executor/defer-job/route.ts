import { NextRequest, NextResponse } from "next/server";
import { deferExecutorJob } from "@/server/db/repositories/run-repository";
import { errorResponse } from "@/server/http/errors";
import { deferExecutorJobInputSchema } from "@/server/http/run-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = deferExecutorJobInputSchema.parse(await request.json());
    const result = await deferExecutorJob(input);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "defer executor job");
  }
}
