import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { listDeferredJobsForUser } from "@/server/db/repositories/run-repository";
import { errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    const deferredJobs = await listDeferredJobsForUser(user.id);
    return NextResponse.json({ deferredJobs }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "list deferred jobs");
  }
}
