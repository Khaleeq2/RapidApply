import {
  isBrowserExecutionTicket,
  type BrowserExecutionTicket,
} from "@rapidapply/contracts";

const EXECUTION_TICKET_PREFIX = "rapidapply.execution-ticket.";

export function executionLaunchPath(runId: string): string {
  return `/launch/${encodeURIComponent(runId)}`;
}

export function storeExecutionLaunchTicket(ticket: BrowserExecutionTicket): void {
  window.localStorage.setItem(ticketKey(ticket.runId), JSON.stringify(ticket));
}

export function readExecutionLaunchTicket(runId: string): BrowserExecutionTicket | null {
  const value = window.localStorage.getItem(ticketKey(runId));
  if (!value) return null;

  try {
    const ticket: unknown = JSON.parse(value);
    if (
      !isBrowserExecutionTicket(ticket) ||
      ticket.runId !== runId ||
      Date.parse(ticket.expiresAt) <= Date.now()
    ) {
      removeExecutionLaunchTicket(runId);
      return null;
    }
    return ticket;
  } catch {
    removeExecutionLaunchTicket(runId);
    return null;
  }
}

export function removeExecutionLaunchTicket(runId: string): void {
  window.localStorage.removeItem(ticketKey(runId));
}

function ticketKey(runId: string): string {
  return `${EXECUTION_TICKET_PREFIX}${runId}`;
}
