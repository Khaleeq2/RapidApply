import { NextRequest, NextResponse } from "next/server";
import { createApplicationInterventions } from "@/server/db/repositories/application-intervention-repository";
import { errorResponse } from "@/server/http/errors";
import { executorApplicationInterventionsInputSchema } from "@/server/http/run-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Capability-only endpoint. The extension can enqueue observed questions but
 * cannot read or write a candidate's unrelated answer history. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = executorApplicationInterventionsInputSchema.parse(await request.json());
    const result = await createApplicationInterventions(input);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "create application interventions");
  }
}
