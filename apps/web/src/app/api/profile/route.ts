import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import {
  getCandidateProfile,
  saveCandidateProfile,
} from "@/server/db/repositories/candidate-profile-repository";
import { errorResponse } from "@/server/http/errors";
import { candidateProfileInputSchema } from "@/server/http/profile-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    const result = await getCandidateProfile(user);

    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "get candidate profile");
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const input = candidateProfileInputSchema.parse(await request.json());
    const user = await getCurrentUser();
    const result = await saveCandidateProfile(user, input);

    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "save candidate profile");
  }
}
