import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import {
  generateResumeForUser,
  listGeneratedResumes,
} from "@/server/db/repositories/resume-repository";
import { errorResponse } from "@/server/http/errors";
import { generateResumeInputSchema } from "@/server/http/resume-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    const resumeDocuments = await listGeneratedResumes(user.id);
    return NextResponse.json({ resumes: resumeDocuments }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "list resumes");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const input = generateResumeInputSchema.parse(await request.json());
    const user = await getCurrentUser();
    const resume = await generateResumeForUser(user, input.targetRole);
    return NextResponse.json({ resume }, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, "generate resume");
  }
}
