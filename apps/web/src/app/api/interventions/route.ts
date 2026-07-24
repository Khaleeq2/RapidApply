import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { listApplicationInterventionsForUser } from "@/server/db/repositories/application-intervention-repository";
import { errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    const interventions = await listApplicationInterventionsForUser(user.id);
    return NextResponse.json({ interventions }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "list application interventions");
  }
}
