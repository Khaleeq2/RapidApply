import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { getResumeDownloadForUser } from "@/server/db/repositories/resume-repository";
import { errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { resumeId: string } },
): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    const document = await getResumeDownloadForUser(user.id, params.resumeId);
    const responseBody = Uint8Array.from(document.bytes).buffer;
    return new NextResponse(responseBody, {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(document.bytes.byteLength),
        "content-disposition": `attachment; filename="${document.summary.fileName}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error, "download resume");
  }
}
