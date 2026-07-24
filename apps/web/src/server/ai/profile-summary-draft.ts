import {
  GeminiDraftError,
  GeminiNotConfiguredError,
  createGeminiProfileSummaryDraft,
} from "./gemini";
import { GroqDraftError, GroqNotConfiguredError, createGroqProfileSummaryDraft } from "./groq";
import type { ProfileSummaryDraftSource } from "./profile-summary";

export type AiDraftProvider = "gemini" | "groq";

export interface ProfileSummaryDraft {
  summary: string;
  provider: AiDraftProvider;
  model: string;
}

export class AiProviderNotConfiguredError extends Error {
  constructor() {
    super("The configured AI provider is unavailable in this environment.");
    this.name = "AiProviderNotConfiguredError";
  }
}

export class AiProfileSummaryDraftError extends Error {
  constructor() {
    super("The configured AI provider could not produce a usable draft.");
    this.name = "AiProfileSummaryDraftError";
  }
}

/**
 * One explicit provider is selected by environment. There is deliberately no
 * silent provider fallback: a candidate's profile excerpt must never be sent
 * to a second vendor without an explicit configuration decision.
 */
export async function createProfileSummaryDraft(
  source: ProfileSummaryDraftSource,
): Promise<ProfileSummaryDraft> {
  const provider = getAiDraftProvider();

  try {
    if (provider === "groq") {
      const draft = await createGroqProfileSummaryDraft(source);
      return { ...draft, provider };
    }

    const draft = await createGeminiProfileSummaryDraft(source);
    return { ...draft, provider };
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

function getAiDraftProvider(): AiDraftProvider {
  const provider = (process.env.RAPIDAPPLY_AI_PROVIDER ?? "gemini").trim().toLowerCase();

  if (provider === "gemini" || provider === "groq") return provider;

  throw new AiProviderNotConfiguredError();
}

function normalizeProviderError(error: unknown): Error {
  if (error instanceof GeminiNotConfiguredError || error instanceof GroqNotConfiguredError) {
    return new AiProviderNotConfiguredError();
  }

  if (error instanceof GeminiDraftError || error instanceof GroqDraftError) {
    return new AiProfileSummaryDraftError();
  }

  return new AiProfileSummaryDraftError();
}
