import {
  getProfileSummaryDraftCandidateData,
  getProfileSummaryDraftInstructions,
  parseProfileSummaryDraft,
  type ProfileSummaryDraftSource,
  type ProviderProfileSummaryDraft,
} from "./profile-summary";

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";

export class GroqNotConfiguredError extends Error {
  constructor() {
    super("Groq is not configured for this environment.");
    this.name = "GroqNotConfiguredError";
  }
}

export class GroqDraftError extends Error {
  constructor() {
    super("Groq could not produce a usable draft.");
    this.name = "GroqDraftError";
  }
}

/**
 * Produces a candidate-reviewable draft only. The request deliberately omits
 * direct contact details, authorization answers, and public profile links.
 */
export async function createGroqProfileSummaryDraft(
  source: ProfileSummaryDraftSource,
): Promise<ProviderProfileSummaryDraft> {
  const configuration = getGroqConfiguration();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${configuration.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: configuration.model,
        messages: [
          { role: "system", content: getProfileSummaryDraftInstructions() },
          {
            role: "user",
            content: [
              "<candidate_data>",
              getProfileSummaryDraftCandidateData(source),
              "</candidate_data>",
            ].join("\n"),
          },
        ],
        // llama-3.1-8b-instant supports JSON Object Mode. RapidApply still
        // validates the result server-side because this is not strict schema mode.
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) throw new GroqDraftError();

    const outputText = readOutputText(payload);
    if (!outputText) throw new GroqDraftError();

    const parsed = parseProfileSummaryDraft(outputText);
    if (!parsed) throw new GroqDraftError();

    return { ...parsed, model: configuration.model };
  } catch (error) {
    if (error instanceof GroqNotConfiguredError || error instanceof GroqDraftError) {
      throw error;
    }

    throw new GroqDraftError();
  } finally {
    clearTimeout(timeout);
  }
}

function getGroqConfiguration(): { apiKey: string; model: string } {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  const model = process.env.GROQ_MODEL?.trim();

  if (!apiKey || !model) throw new GroqNotConfiguredError();

  return { apiKey, model };
}

function readOutputText(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;

  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.choices)) return null;

  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) return null;

  return typeof firstChoice.message.content === "string" ? firstChoice.message.content : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
