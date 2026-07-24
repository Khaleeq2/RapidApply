import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  BrowserExecutionTicket,
  BrowserExecutorEventCapability,
} from "@rapidapply/contracts";
import { getExecutionTicketTtlSeconds, getExecutorEventTtlSeconds } from "../db/config";

export function issueExecutionTicket(runId: string, now = new Date()): BrowserExecutionTicket {
  const expiresAt = new Date(now.getTime() + getExecutionTicketTtlSeconds() * 1_000).toISOString();

  return {
    runId,
    token: randomBytes(32).toString("base64url"),
    expiresAt,
  };
}

export function issueExecutorEventCapability(
  runId: string,
  now = new Date(),
): BrowserExecutorEventCapability {
  const expiresAt = new Date(now.getTime() + getExecutorEventTtlSeconds() * 1_000).toISOString();

  return {
    runId,
    token: randomBytes(32).toString("base64url"),
    expiresAt,
  };
}

export function hashExecutionTicket(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function executionTicketMatches(token: string, expectedHash: string): boolean {
  const suppliedHash = Buffer.from(hashExecutionTicket(token), "hex");
  const storedHash = Buffer.from(expectedHash, "hex");

  return suppliedHash.length === storedHash.length && timingSafeEqual(suppliedHash, storedHash);
}

export function hasExecutionTicketExpired(expiresAt: string, now = new Date()): boolean {
  const expiry = Date.parse(expiresAt);
  return Number.isNaN(expiry) || expiry <= now.getTime();
}
