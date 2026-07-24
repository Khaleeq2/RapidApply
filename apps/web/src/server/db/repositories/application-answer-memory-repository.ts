import type {
  ApplicationAnswerMemory,
  ApplicationAnswerMemoryScope,
  ApplicationAnswerValue,
  ApplicationFieldDescriptor,
  StoredApplicationAnswerValue,
} from "@rapidapply/contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { ApprovedApplicationAnswer } from "../../ai/application-answer-policy";
import { db } from "../client";
import { applicationAnswerMemory } from "../schema";

interface StoredMemoryRow {
  id: string;
  userId: string;
  campaignId: string | null;
  scopeKey: string;
  intentKey: string;
  category: string;
  question: string;
  answerJson: string;
  autoUse: boolean;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function applicationAnswerIntentKey(field: ApplicationFieldDescriptor): string {
  // Only direct contact values are invariant enough to reuse solely by
  // category. Location can mean city, postal code, state, or address;
  // authorization can be country-specific; and consequential questions are
  // never interchangeable merely because they share a category.
  if ([
    "full_name",
    "contact_email",
    "phone",
    "headline",
    "professional_summary",
    "linkedin_url",
    "portfolio_url",
  ].includes(field.category)) {
    return `category:${field.category}`;
  }

  const question = normalizeQuestion(field.question);
  const options = field.options
    .map((option) => normalizeQuestion(option.label))
    .filter(Boolean)
    .sort()
    .join("|");
  return `question:${field.category}:${question}:${options}`.slice(0, 700);
}

export async function findReusableApplicationAnswer(input: {
  userId: string;
  campaignId: string;
  field: ApplicationFieldDescriptor;
}): Promise<ApprovedApplicationAnswer | undefined> {
  const intentKey = applicationAnswerIntentKey(input.field);
  const campaignScope = scopeKey("campaign", input.campaignId);
  const rows = await db
    .select()
    .from(applicationAnswerMemory)
    .where(and(
      eq(applicationAnswerMemory.userId, input.userId),
      eq(applicationAnswerMemory.intentKey, intentKey),
      inArray(applicationAnswerMemory.scopeKey, [campaignScope, scopeKey("global")]),
      eq(applicationAnswerMemory.autoUse, true),
    ))
    .orderBy(desc(applicationAnswerMemory.updatedAt));

  const preferred = rows.sort((left, right) => Number(right.scopeKey === campaignScope) - Number(left.scopeKey === campaignScope));
  for (const row of preferred) {
    const stored = parseStoredAnswer(row.answerJson);
    if (!stored) continue;
    const answer = resolveStoredAnswerForField(stored, input.field);
    if (!answer) continue;

    const now = new Date().toISOString();
    await db.update(applicationAnswerMemory)
      .set({
        useCount: row.useCount + 1,
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(eq(applicationAnswerMemory.id, row.id));

    return {
      answer,
      provenanceId: `answer-memory:${row.id}`,
    };
  }

  return undefined;
}

export async function saveApplicationAnswerMemory(input: {
  userId: string;
  campaignId: string;
  scope: ApplicationAnswerMemoryScope;
  field: ApplicationFieldDescriptor;
  answer: ApplicationAnswerValue;
  autoUse: boolean;
}): Promise<ApplicationAnswerMemory | null> {
  const stored = toStoredAnswer(input.field, input.answer);
  if (!stored) return null;

  const now = new Date().toISOString();
  const campaignId = input.scope === "campaign" ? input.campaignId : null;
  const key = scopeKey(input.scope, input.campaignId);
  const intentKey = applicationAnswerIntentKey(input.field);
  const id = crypto.randomUUID();

  await db.insert(applicationAnswerMemory).values({
    id,
    userId: input.userId,
    campaignId,
    scopeKey: key,
    intentKey,
    category: input.field.category,
    question: input.field.question,
    answerJson: JSON.stringify(stored),
    autoUse: input.autoUse,
    useCount: 0,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [
      applicationAnswerMemory.userId,
      applicationAnswerMemory.scopeKey,
      applicationAnswerMemory.intentKey,
    ],
    set: {
      campaignId,
      category: input.field.category,
      question: input.field.question,
      answerJson: JSON.stringify(stored),
      autoUse: input.autoUse,
      updatedAt: now,
    },
  });

  const [row] = await db.select().from(applicationAnswerMemory).where(and(
    eq(applicationAnswerMemory.userId, input.userId),
    eq(applicationAnswerMemory.scopeKey, key),
    eq(applicationAnswerMemory.intentKey, intentKey),
  )).limit(1);

  return row ? toMemory(row) : null;
}

export function toStoredAnswer(
  field: ApplicationFieldDescriptor,
  answer: ApplicationAnswerValue,
): StoredApplicationAnswerValue | null {
  if (answer.type === "text") return { type: "text", text: answer.text.trim() };
  if (answer.type === "checked") return { type: "checked", checked: answer.checked };

  const labels = answer.optionIds.map((id) => field.options.find((option) => option.id === id)?.label)
    .filter((label): label is string => Boolean(label));
  if (labels.length !== answer.optionIds.length) return null;
  return { type: "options", optionLabels: labels };
}

export function resolveStoredAnswerForField(
  stored: StoredApplicationAnswerValue,
  field: ApplicationFieldDescriptor,
): ApplicationAnswerValue | null {
  if (stored.type === "text") {
    return ["text", "textarea", "number"].includes(field.kind)
      ? { type: "text", text: stored.text }
      : null;
  }
  if (stored.type === "checked") {
    return field.kind === "checkbox" ? { type: "checked", checked: stored.checked } : null;
  }
  if (!["single_select", "multi_select", "radio"].includes(field.kind)) return null;

  const optionIds = stored.optionLabels.map((label) => {
    const matches = field.options.filter((option) =>
      normalizeQuestion(option.label) === normalizeQuestion(label)
    );
    return matches.length === 1 ? matches[0]!.id : undefined;
  });
  if (optionIds.some((id) => !id)) return null;
  return { type: "options", optionIds: optionIds as string[] };
}

function parseStoredAnswer(value: string): StoredApplicationAnswerValue | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.type !== "string") return null;
    if (parsed.type === "text" && typeof parsed.text === "string" && parsed.text.trim()) {
      return { type: "text", text: parsed.text.trim().slice(0, 4_000) };
    }
    if (parsed.type === "checked" && typeof parsed.checked === "boolean") {
      return { type: "checked", checked: parsed.checked };
    }
    if (
      parsed.type === "options" &&
      Array.isArray(parsed.optionLabels) &&
      parsed.optionLabels.length > 0 &&
      parsed.optionLabels.every((label) => typeof label === "string" && label.trim().length > 0)
    ) {
      return { type: "options", optionLabels: parsed.optionLabels.map((label) => label.trim().slice(0, 120)) };
    }
  } catch {
    // A malformed memory row must never produce an application answer.
  }
  return null;
}

function toMemory(row: StoredMemoryRow): ApplicationAnswerMemory | null {
  const answer = parseStoredAnswer(row.answerJson);
  if (!answer) return null;
  const scope = row.scopeKey === "global" ? "global" : "campaign";
  return {
    id: row.id,
    scope,
    campaignId: row.campaignId ?? undefined,
    intentKey: row.intentKey,
    category: row.category as ApplicationAnswerMemory["category"],
    question: row.question,
    answer,
    autoUse: row.autoUse,
    useCount: row.useCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt ?? undefined,
  };
}

function scopeKey(scope: ApplicationAnswerMemoryScope, campaignId?: string): string {
  return scope === "global" ? "global" : `campaign:${campaignId}`;
}

function normalizeQuestion(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|please|would|you|your|do|does|are|is|to|for|of|and|or)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 480);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
