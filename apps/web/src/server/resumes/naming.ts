import { createHash } from "node:crypto";

const FILE_PART_LIMIT = 64;

/** A human-readable filename that is also stable enough for exact LinkedIn reuse. */
export function buildResumeFileName(input: {
  fullName: string;
  targetRole: string;
  version: number;
}): string {
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error("Resume versions must be positive integers.");
  }

  const name = toFilePart(input.fullName, "Candidate");
  const role = toFilePart(input.targetRole, "Professional");
  return `${name}_${role}_Resume_v${input.version}.pdf`;
}

/** Internal identity stays independent of the visible filename and target casing. */
export function buildResumeRoleKey(targetRole: string): string {
  const normalized = normalizeWords(targetRole).toLowerCase() || "professional";
  const readable = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 48) || "professional";
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  return `${readable}-${digest}`;
}

function toFilePart(value: string, fallback: string): string {
  const normalized = normalizeWords(value)
    .replace(/&/g, " And ")
    .replace(/['’]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, FILE_PART_LIMIT)
    .replace(/_+$/g, "");
  return normalized || fallback;
}

function normalizeWords(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ");
}
