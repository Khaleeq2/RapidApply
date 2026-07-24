import {
  getProfileSummaryDraftCandidateData,
  getProfileSummaryDraftInstructions,
  parseProfileSummaryDraft,
  type ProfileSummaryDraftSource,
  type ProviderProfileSummaryDraft,
} from "./profile-summary";

const GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super("Gemini is not configured for this environment.");
    this.name = "GeminiNotConfiguredError";
  }
}

export class GeminiDraftError extends Error {
  constructor() {
    super("Gemini could not produce a usable draft.");
    this.name = "GeminiDraftError";
  }
}

/**
 * Produces a candidate-reviewable draft only. The request is deliberately
 * stateless and excludes name, email, phone, work authorization, and public
 * profile links. Nothing is persisted until the candidate explicitly saves it.
 */
export async function createGeminiProfileSummaryDraft(
  source: ProfileSummaryDraftSource,
): Promise<ProviderProfileSummaryDraft> {
  const configuration = getGeminiConfiguration();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(GEMINI_INTERACTIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": configuration.apiKey,
      },
      body: JSON.stringify({
        model: configuration.model,
        store: false,
        input: buildProfileSummaryPrompt(source),
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: {
            type: "object",
            properties: {
              summary: {
                type: "string",
                description:
                  "A concise professional summary that uses only the supplied candidate facts.",
                maxLength: 1200,
              },
            },
            required: ["summary"],
            additionalProperties: false,
          },
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) throw new GeminiDraftError();

    const outputText = readOutputText(payload);
    if (!outputText) throw new GeminiDraftError();

    const parsed = parseProfileSummaryDraft(outputText);
    if (!parsed) throw new GeminiDraftError();

    return { ...parsed, model: configuration.model };
  } catch (error) {
    if (error instanceof GeminiNotConfiguredError || error instanceof GeminiDraftError) {
      throw error;
    }

    throw new GeminiDraftError();
  } finally {
    clearTimeout(timeout);
  }
}

function getGeminiConfiguration(): { apiKey: string; model: string } {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim();

  if (!apiKey || !model) throw new GeminiNotConfiguredError();

  return { apiKey, model };
}

function buildProfileSummaryPrompt(source: ProfileSummaryDraftSource): string {
  return [
    getProfileSummaryDraftInstructions(),
    "<candidate_data>",
    getProfileSummaryDraftCandidateData(source),
    "</candidate_data>",
  ].join("\n");
}

function readOutputText(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;

  const payload = value as Record<string, unknown>;
  if (typeof payload.output_text === "string") return payload.output_text;
  if (typeof payload.outputText === "string") return payload.outputText;

  // Raw Interactions API responses return the final text inside the last
  // model_output step rather than as a top-level convenience property.
  if (Array.isArray(payload.steps)) {
    for (const step of [...payload.steps].reverse()) {
      if (!isRecord(step) || step.type !== "model_output" || !Array.isArray(step.content)) continue;

      const text = step.content
        .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
        .join("");
      if (text) return text;
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
