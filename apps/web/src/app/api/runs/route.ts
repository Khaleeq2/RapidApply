import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { createApplicationRun, listApplicationRuns } from "@/server/db/repositories/run-repository";
import { errorResponse } from "@/server/http/errors";
import { createRunInputSchema } from "@/server/http/run-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    const runs = await listApplicationRuns(user.id);
    return NextResponse.json({ runs });
  } catch (error) {
    return errorResponse(error, "list runs");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = createRunInputSchema.parse(await request.json());
    const user = await getCurrentUser();
    const run = await createApplicationRun(user, input);

    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "create run");
  }
}
