import type { ExtensionExecutionSession } from "@rapidapply/contracts";
import "./style.css";

interface ExecutionStatusResponse {
  ok: boolean;
  session?: ExtensionExecutionSession | null;
}

const statusDot = requiredElement("status-dot");
const statusTitle = requiredElement("status-title");
const statusDetail = requiredElement("status-detail");
const feedback = requiredElement("feedback");

void refreshStatus();

async function refreshStatus(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "rapidapply.recording-status",
    }) as ExecutionStatusResponse;
    if (!response.ok || !response.session) {
      statusDot.className = "status-dot idle";
      statusTitle.textContent = "No active campaign";
      statusDetail.textContent = "Start a campaign in RapidApply to connect this browser helper.";
      return;
    }

    statusDot.className = "status-dot active";
    statusTitle.textContent = `Campaign ${shortId(response.session.runId)}`;
    statusDetail.textContent = `Executor state: ${response.session.state.replaceAll("_", " ")}`;
  } catch {
    statusDot.className = "status-dot idle";
    statusTitle.textContent = "Helper unavailable";
    statusDetail.textContent = "Reload RapidApply if the helper was just updated.";
    feedback.textContent = "";
  }
}

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing popup element: ${id}`);
  return element as T;
}

function shortId(value: string): string {
  return value.slice(0, 8);
}
