import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  AiProfileSummaryDraftError,
  AiProviderNotConfiguredError,
} from "../ai/profile-summary-draft";
import {
  AuthIdentityConflictError,
  UnauthenticatedError,
} from "../auth/current-user";
import {
  ApplicationInterventionNotFoundError,
} from "../db/repositories/application-intervention-repository";
import {
  ExecutionTicketError,
  ExecutorEventCapabilityError,
  InvalidRunTransitionError,
  RunNotFoundError,
} from "../db/repositories/run-repository";
import {
  ResumeGenerationError,
  ResumeNotFoundError,
} from "../db/repositories/resume-repository";

export function errorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "The request contains invalid campaign data.",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  if (error instanceof RunNotFoundError) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }

  if (error instanceof ApplicationInterventionNotFoundError) {
    return NextResponse.json({ error: "Application question not found." }, { status: 404 });
  }

  if (error instanceof ResumeNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  if (error instanceof ResumeGenerationError) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  if (error instanceof InvalidRunTransitionError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  if (error instanceof ExecutionTicketError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  if (error instanceof ExecutorEventCapabilityError) {
    return NextResponse.json(
      { error: "The browser execution session is invalid or has expired." },
      { status: 401 },
    );
  }

  if (error instanceof UnauthenticatedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  if (error instanceof AuthIdentityConflictError) {
    return NextResponse.json({ error: "This account is linked to a different identity." }, { status: 409 });
  }

  if (error instanceof AiProviderNotConfiguredError) {
    return NextResponse.json(
      { error: "AI drafting is not configured for this environment." },
      { status: 503 },
    );
  }

  if (error instanceof AiProfileSummaryDraftError) {
    return NextResponse.json(
      { error: "AI drafting is temporarily unavailable. Your profile has not been changed." },
      { status: 502 },
    );
  }

  // Do not expose database, credential, or infrastructure details to clients.
  console.error(`Unexpected API error in ${context}.`);
  return NextResponse.json({ error: "Unable to complete that request." }, { status: 500 });
}
