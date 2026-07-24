"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  WEB_BRIDGE_SOURCE,
  isExtensionReadyMessage,
  isExtensionRunClaimedMessage,
  isExtensionRunClaimFailedMessage,
} from "@rapidapply/contracts";
import {
  readExecutionLaunchTicket,
  removeExecutionLaunchTicket,
} from "../../lib/extension-launch";

type LaunchStatus = "checking" | "claiming" | "starting" | "missing" | "failed";

export default function ExecutionLaunchPage() {
  const params = useParams<{ runId: string }>();
  const runId = typeof params.runId === "string" ? params.runId : "";
  const [status, setStatus] = useState<LaunchStatus>("checking");
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setStatus("failed");
      setFailure("This campaign handoff is missing its run ID.");
      return;
    }

    const ticket = readExecutionLaunchTicket(runId);
    let handoffSent = false;
    let acknowledgementSent = false;
    let helperSeen = false;

    const acknowledgeClaim = () => {
      if (acknowledgementSent) return;
      acknowledgementSent = true;
      removeExecutionLaunchTicket(runId);
      setStatus("starting");
      window.postMessage(
        {
          source: WEB_BRIDGE_SOURCE,
          type: "EXTENSION_RUN_LAUNCH_ACKNOWLEDGED",
          runId,
        },
        window.location.origin,
      );
    };

    const receiveExtensionMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) return;

      if (isExtensionReadyMessage(event.data)) {
        helperSeen = true;

        if (ticket) {
          // A present ticket always wins over local status. It may be a newly
          // issued recovery ticket that must replace an older same-run session.
          if (handoffSent) return;
          handoffSent = true;
          setStatus("claiming");
          window.postMessage(
            {
              source: WEB_BRIDGE_SOURCE,
              type: "EXTENSION_RUN_HANDOFF",
              executionTicket: ticket,
            },
            window.location.origin,
          );
          return;
        }

        // Recovery after a reload between claim and navigation: no raw ticket
        // remains, but the extension already owns the run. Replay only the ack.
        if (event.data.activeRunId === runId) {
          acknowledgeClaim();
          return;
        }

        setStatus("failed");
        setFailure("This one-time handoff expired or was already used. Return to RapidApply and reconnect the campaign.");
        return;
      }

      if (isExtensionRunClaimedMessage(event.data) && event.data.run.id === runId) {
        acknowledgeClaim();
        return;
      }

      if (isExtensionRunClaimFailedMessage(event.data) && event.data.runId === runId) {
        setStatus("failed");
        setFailure(event.data.reason);
      }
    };

    window.addEventListener("message", receiveExtensionMessage);
    const ping = () => window.postMessage(
      { source: WEB_BRIDGE_SOURCE, type: "EXTENSION_PING" },
      window.location.origin,
    );
    ping();
    const pingInterval = window.setInterval(ping, 500);
    const missingTimeout = window.setTimeout(() => {
      if (!helperSeen) setStatus("missing");
    }, 3_500);

    return () => {
      window.clearInterval(pingInterval);
      window.clearTimeout(missingTimeout);
      window.removeEventListener("message", receiveExtensionMessage);
    };
  }, [runId]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f8fd] px-6 text-[#0b1220]">
      <section className="w-full max-w-md rounded-2xl border border-blue-950/10 bg-white p-8 text-center shadow-xl shadow-blue-950/5">
        <div className="mx-auto mb-5 grid size-12 place-items-center rounded-xl bg-[#0a2472] text-lg font-black text-white">
          R
        </div>
        <h1 className="text-xl font-bold">{statusTitle(status)}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {failure ?? statusDescription(status)}
        </p>

        {(status === "checking" || status === "claiming" || status === "starting") && (
          <div className="mx-auto mt-6 h-1.5 w-40 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-blue-600" />
          </div>
        )}

        {(status === "missing" || status === "failed") && (
          <a
            href="/"
            className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-[#0a2472] px-5 text-sm font-semibold text-white"
          >
            Return to RapidApply
          </a>
        )}

        <p className="mt-6 font-mono text-[10px] text-slate-400">Campaign {runId}</p>
      </section>
    </main>
  );
}

function statusTitle(status: LaunchStatus): string {
  switch (status) {
    case "checking": return "Connecting to the browser helper";
    case "claiming": return "Securing this campaign";
    case "starting": return "Opening LinkedIn";
    case "missing": return "Browser helper not detected";
    case "failed": return "The handoff needs attention";
  }
}

function statusDescription(status: LaunchStatus): string {
  switch (status) {
    case "checking": return "RapidApply is finding the installed extension in this tab.";
    case "claiming": return "The extension is exchanging the one-time ticket for a private execution session.";
    case "starting": return "The handoff is complete. This same tab will continue into the LinkedIn search.";
    case "missing": return "Install or reload the RapidApply browser helper, then prepare the campaign again from the dashboard.";
    case "failed": return "Return to the dashboard and prepare the browser helper again.";
  }
}
