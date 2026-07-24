import type {
  ApplicationFieldDescriptor,
  CandidateProfile,
  ResolvedApplicationAnswer,
} from "@rapidapply/contracts";
import { z } from "zod";
import {
  getApplicationAnswerInstructions,
  validateAiApplicationAnswer,
} from "./application-answer-policy";

const GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";

const providerAnswerSchema = z.object({
  status: z.enum(["resolved", "unresolved"]),
  answerType: z.enum(["text", "options", "checked", "none"]),
  text: z.string().max(4_000),
  optionIds: z.array(z.string().trim().min(1).max(80)).max(20),
  checked: z.boolean(),
  provenanceIds: z.array(z.string().trim().min(1).max(120)).max(30),
  confidence: z.number().min(0).max(1),
  rationaleCode: z.enum(["direct_fact", "grounded_synthesis", "best_matching_option"]),
}).strict();

export interface ApplicationAnswerJobContext {
  title?: string;
  company?: string;
  location?: string;
  description?: string;
  targetRole?: string;
}

export interface GroundedApplicationAnswerResult {
  decision?: ResolvedApplicationAnswer;
  diagnosticCode?: string;
  outcome:
    | "resolved"
    | "insufficient_evidence"
    | "provider_not_configured"
    | "provider_error"
    | "invalid_response";
}

interface EvidenceItem {
  id: string;
  value: string;
}

/**
 * Calls exactly one configured provider and accepts an answer only after
 * schema, field-shape, provenance, style, and confidence validation. The model
 * may decline to answer; it is never replaced by a static or first-option
 * fallback.
 */
export async function createGroundedApplicationAnswer(input: {
  field: ApplicationFieldDescriptor;
  profile: CandidateProfile;
  job?: ApplicationAnswerJobContext;
  confidenceThreshold: number;
  requiresReview: boolean;
  fetcher?: typeof fetch;
}): Promise<GroundedApplicationAnswerResult> {
  const evidence = buildEvidence(input.profile, input.job);
  if (evidence.length === 0) return { outcome: "insufficient_evidence" };

  const provider = configuredProvider();
  if (!provider) return { outcome: "provider_not_configured" };

  const prompt = buildPrompt(
    input.field,
    evidence,
    input.job,
    input.profile.autopilot.answeringMode ?? "competitive",
  );
  let response: { text: string; model: string };
  try {
    response = provider.name === "gemini"
      ? await callGemini(provider.apiKey, provider.model, prompt, input.fetcher ?? fetch)
      : await callGroq(provider.apiKey, provider.model, prompt, input.fetcher ?? fetch);
  } catch {
    return { outcome: "provider_error" };
  }

  const parsed = providerAnswerSchema.safeParse(parseJson(response.text));
  if (!parsed.success) {
    return { outcome: "invalid_response", diagnosticCode: "provider_schema_invalid" };
  }
  if (parsed.data.status === "unresolved" || parsed.data.answerType === "none") {
    return { outcome: "insufficient_evidence" };
  }

  const answer = parsed.data.answerType === "text"
    ? { type: "text" as const, text: parsed.data.text.trim() }
    : parsed.data.answerType === "options"
      ? { type: "options" as const, optionIds: parsed.data.optionIds }
      : { type: "checked" as const, checked: parsed.data.checked };
  const validation = validateAiApplicationAnswer({
    answer,
    provenanceIds: parsed.data.provenanceIds,
    confidence: parsed.data.confidence,
    rationaleCode: parsed.data.rationaleCode,
  }, input.field, evidence.map((item) => item.id));
  if (validation.success === false) {
    return {
      outcome: "invalid_response",
      diagnosticCode: `answer_validation:${validation.issues.join("+")}`,
    };
  }

  return {
    outcome: "resolved",
    decision: {
      status: "resolved",
      fieldKey: input.field.key,
      source: "ai",
      answer: validation.candidate.answer,
      provenanceIds: validation.candidate.provenanceIds,
      requiresReview: input.requiresReview ||
        validation.candidate.confidence < input.confidenceThreshold,
      provider: provider.name,
      model: response.model,
    },
  };
}

function buildEvidence(
  profile: CandidateProfile,
  job?: ApplicationAnswerJobContext,
): EvidenceItem[] {
  const values: Array<EvidenceItem | null> = [
    evidence("profile.headline", profile.headline),
    evidence("profile.summary", profile.summary),
    evidence("profile.location", profile.location),
    profile.authorizedToWork === "not_specified"
      ? null
      : { id: "profile.authorizedToWork", value: profile.authorizedToWork },
    profile.requiresSponsorship === "not_specified"
      ? null
      : { id: "profile.requiresSponsorship", value: profile.requiresSponsorship },
    evidence("campaign.targetRole", job?.targetRole),
    evidence("job.title", job?.title),
    evidence("job.company", job?.company),
    evidence("job.location", job?.location),
    evidence("job.description", job?.description, 8_000),
  ];
  return values.filter((value): value is EvidenceItem => value !== null);
}

function evidence(id: string, raw: string | undefined, maxLength = 4_000): EvidenceItem | null {
  const value = raw?.trim().slice(0, maxLength);
  return value ? { id, value } : null;
}

function buildPrompt(
  field: ApplicationFieldDescriptor,
  evidenceItems: EvidenceItem[],
  job?: ApplicationAnswerJobContext,
  answeringMode: "competitive" | "conservative" = "competitive",
): string {
  return [
    getApplicationAnswerInstructions(field, answeringMode),
    "If the evidence does not directly support a truthful answer, return status=unresolved and answerType=none.",
    "Never infer that the candidate has experience, credentials, preferences, availability, education, legal status, or accomplishments merely because an option exists.",
    "For resolved option answers, copy only opaque optionIds from field.options.",
    "Every resolved claim must cite one or more evidence IDs in provenanceIds.",
    "Return one JSON object with exactly: status, answerType, text, optionIds, checked, provenanceIds, confidence, rationaleCode.",
    'status must be exactly "resolved" or "unresolved".',
    'answerType must be exactly "text", "options", "checked", or "none"; use the plural value "options" for every option answer.',
    'rationaleCode must be exactly "direct_fact", "grounded_synthesis", or "best_matching_option".',
    'Always include every field. Use text="", optionIds=[], and checked=false when that field is not the selected answer representation.',
    '<output_shape_example>{"status":"resolved","answerType":"options","text":"","optionIds":["opaque-id-from-field"],"checked":false,"provenanceIds":["supplied.evidence.id"],"confidence":0.9,"rationaleCode":"best_matching_option"}</output_shape_example>',
    "<field>",
    JSON.stringify({
      key: field.key,
      question: field.question,
      kind: field.kind,
      category: field.category,
      required: field.required,
      options: field.options,
      constraints: field.constraints,
    }),
    "</field>",
    "<job_context>",
    JSON.stringify({
      title: job?.title ?? "",
      company: job?.company ?? "",
      location: job?.location ?? "",
      targetRole: job?.targetRole ?? "",
    }),
    "</job_context>",
    "<evidence>",
    JSON.stringify(evidenceItems),
    "</evidence>",
  ].join("\n");
}

function configuredProvider():
  | { name: "gemini" | "groq"; apiKey: string; model: string }
  | null {
  const name = (process.env.RAPIDAPPLY_AI_PROVIDER ?? "gemini").trim().toLowerCase();
  if (name === "groq") {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    const model = process.env.GROQ_MODEL?.trim();
    return apiKey && model ? { name, apiKey, model } : null;
  }
  if (name === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const model = process.env.GEMINI_MODEL?.trim();
    return apiKey && model ? { name, apiKey, model } : null;
  }
  return null;
}

async function callGemini(
  apiKey: string,
  model: string,
  prompt: string,
  fetcher: typeof fetch,
): Promise<{ text: string; model: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetcher(GEMINI_INTERACTIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        model,
        store: false,
        input: prompt,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["resolved", "unresolved"] },
              answerType: { type: "string", enum: ["text", "options", "checked", "none"] },
              text: { type: "string", maxLength: 4_000 },
              optionIds: { type: "array", items: { type: "string" }, maxItems: 20 },
              checked: { type: "boolean" },
              provenanceIds: { type: "array", items: { type: "string" }, maxItems: 30 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              rationaleCode: {
                type: "string",
                enum: ["direct_fact", "grounded_synthesis", "best_matching_option"],
              },
            },
            required: [
              "status",
              "answerType",
              "text",
              "optionIds",
              "checked",
              "provenanceIds",
              "confidence",
              "rationaleCode",
            ],
            additionalProperties: false,
          },
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error("provider_error");
    const text = readGeminiText(payload);
    if (!text) throw new Error("provider_error");
    return { text, model };
  } finally {
    clearTimeout(timeout);
  }
}

async function callGroq(
  apiKey: string,
  model: string,
  prompt: string,
  fetcher: typeof fetch,
): Promise<{ text: string; model: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetcher(GROQ_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You resolve job-application fields using only supplied evidence and return JSON only.",
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error("provider_error");
    const text = readGroqText(payload);
    if (!text) throw new Error("provider_error");
    return { text, model };
  } finally {
    clearTimeout(timeout);
  }
}

function readGeminiText(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.output_text === "string") return value.output_text;
  if (typeof value.outputText === "string") return value.outputText;
  if (!Array.isArray(value.steps)) return null;
  for (const step of [...value.steps].reverse()) {
    if (!isRecord(step) || step.type !== "model_output" || !Array.isArray(step.content)) continue;
    const text = step.content
      .map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "")
      .join("");
    if (text) return text;
  }
  return null;
}

function readGroqText(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) return null;
  const choice = value.choices[0];
  return isRecord(choice) && isRecord(choice.message) &&
    typeof choice.message.content === "string"
    ? choice.message.content
    : null;
}

function parseJson(value: string): unknown {
  const normalized = value.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
