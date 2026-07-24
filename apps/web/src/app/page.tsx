"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AWAITING_USER_CONTEXTS,
  WEB_BRIDGE_SOURCE,
  isExtensionReadyMessage,
  type AwaitingUserContext,
  type BrowserExecutionTicket,
  type RunEventType,
  type RunState,
} from "@rapidapply/contracts";
import { Puzzle, Sparkles } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { type Board } from "./components/BoardToggle";
import {
  QuickApplyBar,
  type LaunchpadRunStatus,
  type RunLogItem,
} from "./components/QuickApplyBar";
import { type AdvancedConfig } from "./components/AdvancedSettings";
import { InsightsPage } from "./components/InsightsPage";
import { CandidateProfilePage } from "./components/CandidateProfilePage";
import { ApplicationQuestionsPage } from "./components/ApplicationQuestionsPage";
import { cn } from "./components/ui/utils";
import { ApplicationsHistory, type PastRun } from "./components/ApplicationsHistory";
import { AuthScreen } from "./components/AuthScreen";
import { authClient } from "./lib/auth-client";
import {
  executionLaunchPath,
  storeExecutionLaunchTicket,
} from "./lib/extension-launch";

const BOARDS: Board[] = [
  { id: "linkedin", name: "LinkedIn", color: "#0a66c2", initial: "in" },
];

const BOARD_NAME_BY_ID = new Map([
  ["linkedin", "LinkedIn"],
  ["indeed", "Indeed"],
  ["monster", "Monster"],
]);

interface PersistedRun {
  id: string;
  state: RunState;
  targetRole: string;
  targetLocation: string;
  boardIds: string[];
  targetApplications: number;
  appliedCount: number;
  skippedCount: number;
  createdAt: string;
}

interface PersistedRunEvent {
  id: string;
  type: RunEventType;
  detail: Record<string, string | number | boolean | null> | null;
}

interface ActiveRunCheckpoint {
  kind: "manual_action" | "discovery_complete" | "qualification_complete" | "answer_plans_ready";
  reason: string;
  discoveredJobs?: number;
  poolTarget?: number;
  qualificationStatus?: "qualified" | "skipped" | "needs_user_input";
  fieldCount?: number;
  deterministicCount?: number;
  reviewCount?: number;
  waitingFor?: AwaitingUserContext;
}

function toPastRun(run: PersistedRun): PastRun {
  return {
    id: run.id,
    state: run.state,
    role: run.targetRole,
    location: run.targetLocation,
    date: run.createdAt,
    targetLimit: run.targetApplications,
    applied: run.appliedCount,
    skipped: run.skippedCount,
    boards: run.boardIds.map((boardId) => BOARD_NAME_BY_ID.get(boardId) ?? boardId),
    applications: [],
  };
}

function toRunLogs(events: PersistedRunEvent[]): RunLogItem[] {
  return events
    .filter((event) => [
      "job_discovered",
      "job_qualified",
      "application_submitted",
      "application_skipped",
    ].includes(event.type))
    .slice()
    .reverse()
    .map((event) => {
      const boardId = readEventDetail(event.detail, "board") ?? "RapidApply";
      const board = BOARD_NAME_BY_ID.get(boardId) ?? boardId;
      const boardColor = BOARDS.find((candidate) => candidate.name === board)?.color ?? "#2563eb";
      const status = event.type === "application_submitted"
        ? "applied"
        : event.type === "job_discovered"
          ? "discovered"
          : event.type === "job_qualified"
            ? "qualified"
            : "skipped";

      return {
        id: event.id,
        role: readEventDetail(event.detail, "jobTitle") ?? "Application",
        company: readEventDetail(event.detail, "company") ?? "verified activity",
        board,
        boardColor,
        status,
        reason: status === "skipped" || status === "qualified"
          ? readEventDetail(event.detail, "reason") ?? "Skipped"
          : undefined,
      };
    });
}

function readEventDetail(
  detail: PersistedRunEvent["detail"],
  key: string,
): string | undefined {
  const value = detail?.[key];
  return typeof value === "string" ? value : undefined;
}

function readNumericEventDetail(
  detail: PersistedRunEvent["detail"],
  key: string,
): number | undefined {
  const value = detail?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function latestRunCheckpoint(events: PersistedRunEvent[]): ActiveRunCheckpoint | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "application_answers_planned") {
      return {
        kind: "answer_plans_ready",
        reason: readEventDetail(event.detail, "reason") ?? "RapidApply prepared application answer plans.",
        fieldCount: readNumericEventDetail(event.detail, "fieldCount"),
        deterministicCount: readNumericEventDetail(event.detail, "deterministicCount"),
        reviewCount: readNumericEventDetail(event.detail, "reviewCount"),
      };
    }
    if (event.type !== "user_input_required") continue;

    const reason = readEventDetail(event.detail, "reason") ?? "Manual browser action is required.";
    const discoveredJobs = readNumericEventDetail(event.detail, "discoveredJobs");
    const poolTarget = readNumericEventDetail(event.detail, "poolTarget");
    const rawQualificationStatus = readEventDetail(event.detail, "qualificationStatus");
    const qualificationStatus = rawQualificationStatus === "qualified" ||
      rawQualificationStatus === "skipped" ||
      rawQualificationStatus === "needs_user_input"
      ? rawQualificationStatus
      : undefined;
    const rawWaitingFor = readEventDetail(event.detail, "waitingFor");
    const waitingFor = rawWaitingFor &&
      (AWAITING_USER_CONTEXTS as readonly string[]).includes(rawWaitingFor)
      ? rawWaitingFor as AwaitingUserContext
      : undefined;
    return {
      kind: qualificationStatus
        ? "qualification_complete"
        : discoveredJobs !== undefined || reason.startsWith("LinkedIn discovery is complete")
          ? "discovery_complete"
          : "manual_action",
      reason,
      discoveredJobs,
      poolTarget,
      qualificationStatus,
      waitingFor,
    };
  }

  return null;
}

interface DashboardUser {
  name: string;
  email: string;
  image?: string | null;
}

function DashboardApp({ user, onSignOut }: { user: DashboardUser; onSignOut: () => Promise<void> }) {
  const [nav, setNav] = useState("dashboard");
  const [browserHelperStatus, setBrowserHelperStatus] = useState<
    "checking" | "connected" | "unavailable"
  >("checking");
  const [extensionActiveRunId, setExtensionActiveRunId] = useState<string | null>(null);
  const [role, setRole] = useState("Product Designer");
  const [location, setLocation] = useState("San Francisco · Remote");
  const [selected, setSelected] = useState<Record<string, boolean>>({
    linkedin: true,
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [config, setConfig] = useState<AdvancedConfig>({
    dailyLimit: 40,
    experience: "senior",
    workStyle: "remote",
    aiTailor: true,
    onlyEasyApply: true,
    exclude: "",
  });

  // A campaign becomes durable before any browser workflow is allowed to run.
  const [runStatus, setRunStatus] = useState<LaunchpadRunStatus>("idle");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [appliedCount, setAppliedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [runLogs, setRunLogs] = useState<RunLogItem[]>([]);
  const [activeCheckpoint, setActiveCheckpoint] = useState<ActiveRunCheckpoint | null>(null);
  const [pastRuns, setPastRuns] = useState<PastRun[]>([]);
  const activeBoards = BOARDS.filter((b) => selected[b.id]);
  const canStart = activeBoards.length > 0 && role.trim().length > 0;
  const browserHelperOwnsActiveRun = Boolean(
    activeRunId && extensionActiveRunId === activeRunId,
  );
  const totalRecordedApplications = pastRuns.reduce((total, run) => total + run.applied, 0);

  useEffect(() => {
    const receiveExtensionStatus = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (!isExtensionReadyMessage(event.data)) return;

      setBrowserHelperStatus("connected");
      setExtensionActiveRunId(event.data.activeRunId ?? null);
    };

    window.addEventListener("message", receiveExtensionStatus);
    window.postMessage(
      { source: WEB_BRIDGE_SOURCE, type: "EXTENSION_PING" },
      window.location.origin,
    );

    const timeout = window.setTimeout(() => {
      setBrowserHelperStatus((current) =>
        current === "checking" ? "unavailable" : current,
      );
    }, 800);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", receiveExtensionStatus);
    };
  }, []);

  function toggleBoard(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  function updateConfig(patch: Partial<AdvancedConfig>) {
    setConfig((c) => ({ ...c, ...patch }));
  }

  const updateRunPresentation = useCallback((run: PersistedRun) => {
    const nextStatus = run.state as LaunchpadRunStatus;
    setActiveRunId(run.id);
    setRunStatus(nextStatus);
    // The server-created run is authoritative. Without this, a restored
    // five-application campaign could incorrectly retain the default 40 on
    // the launchpad even though the execution plan correctly targets five.
    setConfig((current) => current.dailyLimit === run.targetApplications
      ? current
      : { ...current, dailyLimit: run.targetApplications });
    setAppliedCount(run.appliedCount);
    setSkippedCount(run.skippedCount);
    setPastRuns((current) => [
      toPastRun(run),
      ...current.filter((existingRun) => existingRun.id !== run.id),
    ]);
  }, []);

  const loadSavedRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/runs", { cache: "no-store" });
      const payload = (await response.json()) as { runs?: PersistedRun[] };

      if (!response.ok || !Array.isArray(payload.runs)) return;
      setPastRuns(payload.runs.map(toPastRun));
      const activeRun = payload.runs.find((run) =>
        !["completed", "failed", "cancelled"].includes(run.state)
      );
      if (activeRun) {
        updateRunPresentation(activeRun);
        setRole(activeRun.targetRole);
        setLocation(activeRun.targetLocation);
        setSelected({ linkedin: activeRun.boardIds.includes("linkedin") });
      }
    } catch {
      // The launch flow reports actionable errors. A history refresh can fail
      // silently without blocking someone from preparing a campaign.
    }
  }, [updateRunPresentation]);

  useEffect(() => {
    void loadSavedRuns();
  }, [loadSavedRuns]);

  const synchronizeActiveRun = useCallback(async () => {
    if (!activeRunId) return;

    try {
      const response = await fetch(`/api/runs/${activeRunId}`, { cache: "no-store" });
      const payload = (await response.json()) as {
        run?: PersistedRun;
        events?: PersistedRunEvent[];
      };

      if (!response.ok || !payload.run) return;
      updateRunPresentation(payload.run);
      const events = payload.events ?? [];
      setRunLogs(toRunLogs(events));
      setActiveCheckpoint(
        payload.run.state === "needs_user_input" ? latestRunCheckpoint(events) : null,
      );
    } catch {
      // A polling failure must not overwrite the durable state already on screen.
    }
  }, [activeRunId, updateRunPresentation]);

  useEffect(() => {
    if (!activeRunId || ["completed", "failed", "cancelled"].includes(runStatus)) return;

    void synchronizeActiveRun();
    const interval = window.setInterval(() => {
      void synchronizeActiveRun();
      window.postMessage(
        { source: WEB_BRIDGE_SOURCE, type: "EXTENSION_PING" },
        window.location.origin,
      );
    }, 5_000);

    return () => window.clearInterval(interval);
  }, [activeRunId, runStatus, synchronizeActiveRun]);

  function startPreflight() {
    if (!canStart) return;
    setLaunchError(null);
    setRunStatus("pre-flight");
  }

  function cancelPreflight() {
    setLaunchError(null);
    setRunStatus("idle");
  }

  async function prepareBrowserHelperForRun(
    runId: string,
    launchWindow: Window | null,
    recover = false,
  ): Promise<void> {
    const response = await fetch(`/api/runs/${runId}/executor-ticket`, {
      method: "POST",
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
      },
      body: JSON.stringify({ recover }),
    });
    const payload = (await response.json()) as {
      run?: PersistedRun;
      executionTicket?: BrowserExecutionTicket;
      error?: string;
    };

    if (!response.ok || !payload.run || !payload.executionTicket) {
      throw new Error(payload.error ?? "RapidApply could not prepare the browser helper.");
    }

    updateRunPresentation(payload.run);
    storeExecutionLaunchTicket(payload.executionTicket);

    if (!launchWindow) {
      throw new Error("The browser blocked RapidApply from opening its execution tab. Allow pop-ups for this site, then prepare the campaign again.");
    }
    launchWindow.location.href = executionLaunchPath(payload.run.id);
  }

  async function launchRun() {
    const launchWindow = browserHelperStatus === "connected"
      ? window.open("/launch/waiting", "rapidapply-executor")
      : null;
    setIsSaving(true);
    setLaunchError(null);
    let savedRun = false;

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetRole: role,
          targetLocation: location,
          boardIds: activeBoards.map((board) => board.id),
          targetApplications: config.dailyLimit,
          configuration: {
            dailyLimit: config.dailyLimit,
            experience: config.experience,
            workStyle: config.workStyle,
            aiTailor: config.aiTailor,
            onlyEasyApply: config.onlyEasyApply,
            exclude: config.exclude,
          },
          autonomyPolicy: {
            mode: config.autonomyMode ?? "autonomous",
            freeTextStrategy: config.aiTailor ? "ai_draft" : "profile_only",
            unknownFieldStrategy: config.unknownFieldStrategy ?? "defer_to_finish_later",
            aiConfidenceThreshold: 0.75,
            maxThroughput: { dailyCap: config.dailyLimit, hourlyCap: config.hourlyCap ?? 5 },
          },
        }),
      });
      const payload = (await response.json()) as { run?: PersistedRun; error?: string };

      if (!response.ok || !payload.run) {
        throw new Error(payload.error ?? "RapidApply could not save this campaign.");
      }

      setRunLogs([]);
      updateRunPresentation(payload.run);
      savedRun = true;

      if (browserHelperStatus === "connected") {
        await prepareBrowserHelperForRun(payload.run.id, launchWindow);
      }
    } catch (error) {
      if (!savedRun) launchWindow?.close();
      setLaunchError(error instanceof Error ? error.message : "RapidApply could not save this campaign.");
      if (!savedRun) setRunStatus("pre-flight");
    } finally {
      setIsSaving(false);
    }
  }

  async function prepareBrowserHelper() {
    if (!activeRunId) {
      setLaunchError("Save a campaign before preparing the browser helper.");
      return;
    }

    if (browserHelperStatus !== "connected") {
      setLaunchError("Install or reconnect the RapidApply browser helper before preparing this campaign.");
      return;
    }

    const launchWindow = window.open("/launch/waiting", "rapidapply-executor");
    setIsSaving(true);
    setLaunchError(null);

    try {
      await prepareBrowserHelperForRun(
        activeRunId,
        launchWindow,
        runStatus !== "ready",
      );
    } catch (error) {
      setLaunchError(
        error instanceof Error ? error.message : "RapidApply could not prepare the browser helper.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function sendRunEvent(type: "run_paused" | "run_resumed" | "run_cancelled") {
    if (!activeRunId) {
      setLaunchError("This campaign does not have a durable run ID yet.");
      return;
    }

    setIsSaving(true);
    setLaunchError(null);

    try {
      const response = await fetch(`/api/runs/${activeRunId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
          idempotencyKey: `web:${activeRunId}:${type}:${crypto.randomUUID()}`,
        }),
      });
      const payload = (await response.json()) as { run?: PersistedRun; error?: string };

      if (!response.ok || !payload.run) {
        throw new Error(payload.error ?? "RapidApply could not update this campaign.");
      }

      updateRunPresentation(payload.run);
      window.postMessage(
        {
          source: WEB_BRIDGE_SOURCE,
          type: "EXTENSION_RUN_STATE_SYNC",
          runId: payload.run.id,
          state: payload.run.state,
        },
        window.location.origin,
      );
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : "RapidApply could not update this campaign.");
    } finally {
      setIsSaving(false);
    }
  }

  function pauseRun() {
    return sendRunEvent("run_paused");
  }

  function resumeRun() {
    return sendRunEvent("run_resumed");
  }

  function cancelRun() {
    return sendRunEvent("run_cancelled");
  }

  function resetRun() {
    setRunStatus("idle");
    setActiveRunId(null);
    setLaunchError(null);
    setAppliedCount(0);
    setSkippedCount(0);
    setRunLogs([]);
    setActiveCheckpoint(null);
  }

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* ambient glow */}
      {nav === "dashboard" && (
        <>
          <div className="pointer-events-none absolute -left-40 -top-40 size-[560px] rounded-full bg-primary/10 blur-[130px]" />
          <div className="pointer-events-none absolute right-0 top-1/4 size-[460px] rounded-full bg-accent/10 blur-[130px]" />
          <div className="pointer-events-none absolute bottom-0 left-1/3 size-[380px] rounded-full bg-[#6e46ae]/[0.07] blur-[130px]" />
        </>
      )}

      <Sidebar active={nav} onSelect={setNav} user={user} onSignOut={onSignOut} />

      <main className={cn("relative z-10 flex-1 flex flex-col min-w-0", nav === "applications" ? "h-screen overflow-hidden" : "h-screen overflow-y-auto")}>
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex items-center justify-end gap-3 px-6 py-4 lg:px-10 shrink-0">
          <div className="flex items-center gap-2 rounded-full border border-border bg-white/70 px-3.5 py-2.5 backdrop-blur-xl">
            <span className="text-[13px] font-medium text-foreground">
              {totalRecordedApplications} applications recorded
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-white/70 px-3.5 py-2 backdrop-blur-xl">
            <span
              className={cn(
                "grid size-6 place-items-center rounded-md",
                browserHelperStatus === "connected"
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-amber-50 text-amber-600",
              )}
            >
              <Puzzle className="size-3.5" strokeWidth={2.4} />
            </span>
            <span className="text-[13px] font-medium">
              {browserHelperStatus === "connected"
                ? "Browser helper connected"
                : browserHelperStatus === "checking"
                  ? "Checking browser helper"
                  : "Browser helper not installed"}
            </span>
            <span
              className={cn(
                "size-1.5 rounded-full",
                browserHelperStatus === "connected" ? "bg-emerald-500" : "bg-amber-500",
              )}
            />
          </div>
        </header>

        {nav === "insights" ? (
          <div className="mx-auto max-w-[1120px] px-6 pb-16 lg:px-10 w-full">
            <InsightsPage runs={pastRuns} />
          </div>
        ) : nav === "applications" ? (
          <div className="mx-auto flex max-w-[1280px] flex-col px-6 lg:px-10 flex-1 min-h-0 w-full pb-5">
            <ApplicationsHistory pastRuns={pastRuns} />
          </div>
        ) : nav === "answers" ? (
          <ApplicationQuestionsPage />
        ) : nav === "resume" ? (
          <CandidateProfilePage />
        ) : nav === "dashboard" ? (
          <div className="mx-auto flex min-h-[calc(100vh-140px)] max-w-[960px] flex-col justify-center px-6 pb-16 lg:px-10 w-full">
            {/* Cockpit headline */}
            <div className="mb-6 text-center">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-white/60 px-3 py-1.5 backdrop-blur-xl">
                <Sparkles className="size-3.5 text-accent" strokeWidth={2.2} />
                <span className="text-[12px] font-medium text-muted-foreground">
                  Your campaign, saved and ready for verified browser execution.
                </span>
              </div>
              <h1 className="text-[34px] font-bold leading-tight tracking-tight sm:text-[40px]">
                Set your next job-search campaign in motion
              </h1>
              <p className="mx-auto mt-3 max-w-[480px] text-[15px] leading-relaxed text-muted-foreground">
                Define the role, target and filters. RapidApply stores the campaign first,
                then records only verified progress from its browser helper.
              </p>
            </div>

            {/* The hero widget */}
            <QuickApplyBar
              role={role}
              location={location}
              boards={BOARDS}
              selected={selected}
              runStatus={runStatus}
              appliedCount={appliedCount}
              skippedCount={skippedCount}
              runLogs={runLogs}
              activeCheckpoint={activeCheckpoint}
              limit={config.dailyLimit}
              config={config}
              advancedOpen={advancedOpen}
              activeRunId={activeRunId}
              isSaving={isSaving}
              launchError={launchError}
              browserHelperConnected={browserHelperStatus === "connected"}
              browserHelperOwnsRun={browserHelperOwnsActiveRun}
              onRole={setRole}
              onLocation={setLocation}
              onToggleBoard={toggleBoard}
              onToggleAdvanced={() => setAdvancedOpen((o) => !o)}
              onLimitChange={(v) => updateConfig({ dailyLimit: v })}
              onConfigChange={updateConfig}
              onStartPreflight={startPreflight}
              onLaunchRun={launchRun}
              onCancelPreflight={cancelPreflight}
              onPauseRun={pauseRun}
              onResumeRun={resumeRun}
              onCancelRun={cancelRun}
              onPrepareBrowserHelper={prepareBrowserHelper}
              onResetRun={resetRun}
            />
          </div>
        ) : nav === "pricing" ? (
          <div className="mx-auto max-w-[960px] px-6 pb-16 lg:px-10 mt-6 w-full">
            <div className="text-center mb-8">
              <h1 className="text-[28px] font-bold tracking-tight">Product status</h1>
              <p className="text-[14px] text-muted-foreground mt-1.5">
                Pricing, billing, and usage limits are not active in this development build.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-6 max-w-[720px] mx-auto">
              <div className="rounded-xl border border-border bg-white p-6 flex flex-col justify-between">
                <div>
                  <div className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground">
                    Available foundation
                  </div>
                  <h3 className="text-[18px] font-bold text-foreground mt-3">Campaign control plane</h3>
                  <p className="text-[13px] text-muted-foreground mt-1">The durable product surface currently being built and tested.</p>
                  
                  <ul className="space-y-2.5 mt-6 text-[13px] text-muted-foreground">
                    <li className="flex items-center gap-2">✓ Durable campaign saves</li>
                    <li className="flex items-center gap-2">✓ Candidate-authored profile facts</li>
                    <li className="flex items-center gap-2">✓ One-time browser-helper handoff</li>
                  </ul>
                </div>
                <button disabled className="mt-8 h-10 w-full rounded-lg bg-slate-100 text-slate-400 font-semibold text-[13px] cursor-not-allowed">
                  Development only
                </button>
              </div>

              <div className="rounded-xl border border-primary/20 bg-white p-6 shadow-md flex flex-col justify-between relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-primary text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg">
                  NEXT
                </div>
                <div>
                  <div className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
                    Planned capability
                  </div>
                  <h3 className="text-[18px] font-bold text-foreground mt-3">User-approved execution</h3>
                  <p className="text-[13px] text-muted-foreground mt-1">Only after a consent model, scoped permissions, and regression fixtures exist.</p>
                  
                  <ul className="space-y-2.5 mt-6 text-[13px] text-slate-600">
                    <li className="flex items-center gap-2">✦ Resume-file storage decision</li>
                    <li className="flex items-center gap-2">✦ Explicit event and approval channel</li>
                    <li className="flex items-center gap-2">✦ Per-job qualification and Easy Apply controller</li>
                    <li className="flex items-center gap-2">✦ Billing and entitlement design</li>
                  </ul>
                </div>
                <button disabled className="mt-8 h-10 w-full cursor-not-allowed rounded-lg bg-slate-100 text-[13px] font-semibold text-slate-400">
                  Not available yet
                </button>
              </div>
            </div>
          </div>
        ) : nav === "settings" ? (
          <div className="mx-auto max-w-[800px] px-6 pb-16 lg:px-10 mt-6 w-full">
            <h1 className="text-[28px] font-bold tracking-tight">Settings</h1>
            <p className="text-[14px] text-muted-foreground mt-1.5">
              Review your account and current browser-helper execution state.
            </p>

            <div className="mt-8 space-y-6">
              {/* Account settings */}
              <div className="rounded-xl border border-border bg-white p-6">
                <h3 className="text-[15px] font-bold text-foreground mb-1">Signed-in account</h3>
                <p className="mb-4 text-[12.5px] text-muted-foreground">
                  Your account is protected by a server-validated Better Auth session. Structured Resume &amp; Profile facts remain separate from authentication credentials.
                </p>
                <div className="grid sm:grid-cols-2 gap-4 text-[13px]">
                  <div>
                    <label className="block text-muted-foreground mb-1">Identity</label>
                    <div className="flex h-9 items-center rounded-md border border-border bg-slate-50/50 px-3 text-foreground">{user.name}</div>
                  </div>
                  <div>
                    <label className="block text-muted-foreground mb-1">Authentication</label>
                    <div className="flex h-9 items-center rounded-md border border-border bg-slate-50/50 px-3 text-muted-foreground">{user.email}</div>
                  </div>
                </div>
              </div>

              {/* Connected job boards */}
              <div className="rounded-xl border border-border bg-white p-6">
                <h3 className="text-[15px] font-bold text-foreground mb-1">Browser-helper connections</h3>
                <p className="mb-4 text-[12.5px] text-muted-foreground">
                  RapidApply uses the LinkedIn session the user controls in the dedicated executor tab. It does not store the LinkedIn password or cookies.
                </p>
                <div className="space-y-4 text-[13px]">
                  <div className="flex items-center justify-between border-b border-border/40 pb-3">
                    <div>
                      <div className="font-semibold text-foreground">Browser helper</div>
                      <div className="text-muted-foreground text-[12px] mt-0.5">Availability is checked on the Launchpad. The current adapter supports exact-tab LinkedIn observation and bounded search discovery.</div>
                    </div>
                    <span className="rounded bg-violet-50 px-2 py-0.5 text-[11.5px] font-semibold text-violet-700">Discovery enabled</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-border/40 pb-3">
                    <div>
                      <div className="font-semibold text-foreground">Job board sessions</div>
                      <div className="text-muted-foreground text-[12px] mt-0.5">LinkedIn authentication stays inside the user-managed Chrome session; manual sign-in and security steps pause the campaign.</div>
                    </div>
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-700">User managed</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-foreground">Next execution step</div>
                      <div className="text-muted-foreground text-[12px] mt-0.5">Qualify each discovered job, open it in the same tab, and prove the Easy Apply state before enabling form actions.</div>
                    </div>
                    <span className="text-[12px] font-bold text-muted-foreground">Scoped next</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex min-h-[calc(100vh-200px)] max-w-[960px] flex-col items-center justify-center px-6 text-center w-full">
            <h2 className="text-[20px] font-semibold capitalize">{nav}</h2>
            <p className="mt-2 max-w-[360px] text-[14px] text-muted-foreground">
              This space is coming soon. For now, everything you need lives on your Launchpad.
            </p>
          </div>
        )}
      </main>

    </div>
  );
}

export default function App() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <main className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">Loading your workspace…</main>;
  }

  if (!session) {
    return <AuthScreen />;
  }

  const user = (session as unknown as { user: DashboardUser }).user;

  return (
    <DashboardApp
      user={user}
      onSignOut={async () => {
        await authClient.signOut();
        window.location.reload();
      }}
    />
  );
}
