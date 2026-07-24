/** A small deterministic hash for deduplicating observations, not security. */
export function stableFingerprint(value: unknown): string {
  const input = JSON.stringify(value);
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function normalizeText(value: string | null | undefined, maxLength = 240): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
