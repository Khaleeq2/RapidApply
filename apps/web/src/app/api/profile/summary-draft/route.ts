import { NextResponse } from "next/server";
import { createProfileSummaryDraft } from "@/server/ai/profile-summary-draft";
import { getCurrentUser } from "@/server/auth/current-user";
import { getCandidateProfile } from "@/server/db/repositories/candidate-profile-repository";
import { errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    const { profile } = await getCandidateProfile(user);

    if (!profile.headline.trim() && !profile.summary.trim()) {
      return NextResponse.json(
        { error: "Add a headline or a starting summary before requesting a draft." },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }

    const draft = await createProfileSummaryDraft({
      headline: profile.headline,
      location: profile.location,
      summary: profile.summary,
    });

    return NextResponse.json(
      { draftSummary: draft.summary, provider: draft.provider, model: draft.model },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, "create candidate summary draft");
  }
}
