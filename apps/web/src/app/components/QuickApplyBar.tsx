import type { AwaitingUserContext, RunState } from "@rapidapply/contracts";
import { ArrowRight, ChevronDown, MapPin, Search, SlidersHorizontal } from "lucide-react";
import { type AdvancedConfig, AdvancedSettings } from "./AdvancedSettings";
import { BoardChip } from "./BoardChip";
import { type Board } from "./BoardToggle";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Slider } from "./ui/slider";
import { cn } from "./ui/utils";

export interface RunLogItem {
  id: string;
  role: string;
  company: string;
  board: string;
  boardColor: string;
  status: "discovered" | "qualified" | "applied" | "skipped";
  reason?: string;
}

export type LaunchpadRunStatus = "idle" | "pre-flight" | Exclude<RunState, "created">;

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

interface QuickApplyBarProps {
  role: string;
  location: string;
  boards: Board[];
  selected: Record<string, boolean>;
  runStatus: LaunchpadRunStatus;
  appliedCount: number;
  skippedCount: number;
  runLogs: RunLogItem[];
  activeCheckpoint: ActiveRunCheckpoint | null;
  limit: number;
  config: AdvancedConfig;
  advancedOpen: boolean;
  activeRunId: string | null;
  isSaving: boolean;
  launchError: string | null;
  browserHelperConnected: boolean;
  browserHelperOwnsRun: boolean;
  onRole: (value: string) => void;
  onLocation: (value: string) => void;
  onToggleBoard: (id: string) => void;
  onToggleAdvanced: () => void;
  onLimitChange: (value: number) => void;
  onConfigChange: (patch: Partial<AdvancedConfig>) => void;
  onStartPreflight: () => void;
  onLaunchRun: () => Promise<void> | void;
  onCancelPreflight: () => void;
  onPauseRun: () => Promise<void> | void;
  onResumeRun: () => Promise<void> | void;
  onCancelRun: () => Promise<void> | void;
  onPrepareBrowserHelper: () => Promise<void> | void;
  onResetRun: () => void;
}

const STATUS_COPY: Record<Exclude<LaunchpadRunStatus, "idle" | "pre-flight">, {
  title: string;
  description: string;
  dotClass: string;
  progressClass: string;
}> = {
  starting: {
    title: "Starting campaign",
    description: "Initializing campaign session.",
    dotClass: "bg-blue-500",
    progressClass: "bg-blue-500",
  },
  searching: {
    title: "Searching for jobs",
    description: "Scanning job listings for Easy Apply opportunities.",
    dotClass: "bg-indigo-500",
    progressClass: "bg-indigo-500",
  },
  opening_job: {
    title: "Opening job listing",
    description: "Navigating to target job detailing.",
    dotClass: "bg-indigo-500",
    progressClass: "bg-indigo-500",
  },
  easy_apply: {
    title: "Starting Easy Apply",
    description: "Opening application modal.",
    dotClass: "bg-purple-500",
    progressClass: "bg-purple-500",
  },
  fill_step: {
    title: "Filling form fields",
    description: "Evaluating fields with campaign policy and applying safe DOM updates.",
    dotClass: "bg-purple-500",
    progressClass: "bg-purple-500",
  },
  submit_attempted: {
    title: "Submitting application",
    description: "Verifying final review step before completion.",
    dotClass: "bg-amber-500",
    progressClass: "bg-amber-500",
  },
  submitted: {
    title: "Application submitted",
    description: "Submission verified successfully.",
    dotClass: "bg-emerald-500",
    progressClass: "bg-emerald-500",
  },
  ready: {
    title: "Campaign saved",
    description: "Your criteria are stored. A supported browser workflow must claim the campaign before execution starts.",
    dotClass: "bg-accent",
    progressClass: "bg-accent",
  },
  claimed: {
    title: "Browser helper prepared",
    description: "The dedicated browser tab securely claimed this campaign and is moving into LinkedIn discovery.",
    dotClass: "bg-violet-500",
    progressClass: "bg-violet-500",
  },
  running: {
    title: "Campaign running",
    description: "RapidApply is recording verified progress from the browser helper.",
    dotClass: "bg-accent",
    progressClass: "bg-primary",
  },
  paused: {
    title: "Campaign paused",
    description: "Execution is paused. You can resume it when you are ready.",
    dotClass: "bg-amber-500",
    progressClass: "bg-amber-500",
  },
  needs_user_input: {
    title: "Your input is needed",
    description: "The browser helper paused at a question that needs an approved answer.",
    dotClass: "bg-amber-500",
    progressClass: "bg-amber-500",
  },
  completed: {
    title: "Campaign completed",
    description: "This campaign has reached its recorded end state.",
    dotClass: "bg-emerald-500",
    progressClass: "bg-emerald-500",
  },
  failed: {
    title: "Campaign needs attention",
    description: "Execution stopped before completion. Review the saved activity before starting another campaign.",
    dotClass: "bg-rose-500",
    progressClass: "bg-rose-500",
  },
  cancelled: {
    title: "Campaign cancelled",
    description: "This campaign has been stopped and will not be picked up by the browser helper.",
    dotClass: "bg-slate-400",
    progressClass: "bg-slate-400",
  },
};

export function QuickApplyBar({
  role,
  location,
  boards,
  selected,
  runStatus,
  appliedCount,
  skippedCount,
  runLogs,
  activeCheckpoint,
  limit,
  config,
  advancedOpen,
  activeRunId,
  isSaving,
  launchError,
  browserHelperConnected,
  browserHelperOwnsRun,
  onRole,
  onLocation,
  onToggleBoard,
  onToggleAdvanced,
  onLimitChange,
  onConfigChange,
  onStartPreflight,
  onLaunchRun,
  onCancelPreflight,
  onPauseRun,
  onResumeRun,
  onCancelRun,
  onPrepareBrowserHelper,
  onResetRun,
}: QuickApplyBarProps) {
  const activeBoards = boards.filter((board) => selected[board.id]);
  const canStart = activeBoards.length > 0 && role.trim().length > 0;

  if (runStatus === "pre-flight") {
    return (
      <div className="animate-in fade-in zoom-in-95 rounded-2xl border-2 border-white/80 bg-white/75 p-6 shadow-[0_20px_48px_-12px_rgba(10,36,114,0.18)] ring-1 ring-primary/[0.05] backdrop-blur-2xl duration-200">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-primary">
              <SlidersHorizontal className="size-3.5" />
            </span>
            <h3 className="text-[16px] font-bold text-foreground">Review and save campaign</h3>
          </div>

          <div className="grid gap-3 rounded-xl border border-primary/10 bg-primary/[0.02] p-4 text-[13px] leading-relaxed">
            <ScopeRow label="Applications target" value={String(limit)} />
            <ScopeRow label="Role and location" value={`${role} · ${location}`} />
            <ScopeRow label="Target boards" value={activeBoards.map((board) => board.name).join(" and ")} />
            <ScopeRow
              label="Filters"
              value={`${capitalize(config.experience)} roles · tailoring preference ${config.aiTailor ? "saved" : "off"}`}
              last
            />
          </div>

          {launchError && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
              {launchError}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={onLaunchRun}
              disabled={isSaving}
              className="h-12 flex-1 rounded-lg bg-primary text-[14px] font-semibold text-primary-foreground shadow-md shadow-primary/10 transition-colors hover:bg-[#123a9e] disabled:cursor-wait disabled:opacity-60"
            >
              {isSaving
                ? "Saving campaign…"
                : browserHelperConnected
                  ? "Save and start"
                  : "Save campaign"}
            </button>
            <button
              onClick={onCancelPreflight}
              disabled={isSaving}
              className="h-12 px-5 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              Edit search
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (runStatus !== "idle") {
    const status = runStatus === "needs_user_input" && activeCheckpoint?.kind === "answer_plans_ready"
      ? {
          title: "Application answers are ready for review",
          description: activeCheckpoint.reviewCount
            ? `${activeCheckpoint.deterministicCount ?? 0} of ${activeCheckpoint.fieldCount ?? 0} observed fields have approved profile-backed answers. ${activeCheckpoint.reviewCount} still need your review.`
            : `${activeCheckpoint.fieldCount ?? 0} observed fields were planned from your approved profile facts. RapidApply remains paused until you choose the next action.`,
          dotClass: "bg-violet-500",
          progressClass: "bg-violet-500",
        }
      : runStatus === "needs_user_input" && activeCheckpoint?.kind === "qualification_complete"
      ? activeCheckpoint.qualificationStatus === "qualified"
        ? {
            title: "LinkedIn listing qualified",
            description: "RapidApply verified the saved job detail and an enabled Easy Apply control. The form controller proceeds only through non-submitting steps and pauses whenever a candidate decision is required.",
            dotClass: "bg-violet-500",
            progressClass: "bg-violet-500",
          }
        : activeCheckpoint.qualificationStatus === "skipped"
          ? {
              title: "First LinkedIn listing skipped",
              description: activeCheckpoint.reason,
              dotClass: "bg-amber-500",
              progressClass: "bg-amber-500",
            }
          : {
              title: "LinkedIn listing needs review",
              description: activeCheckpoint.reason,
              dotClass: "bg-amber-500",
              progressClass: "bg-amber-500",
            }
      : runStatus === "needs_user_input" && activeCheckpoint?.kind === "discovery_complete"
      ? {
          title: "LinkedIn discovery verified",
          description: `${activeCheckpoint.discoveredJobs ?? runLogs.length} unique jobs were saved${activeCheckpoint.poolTarget ? ` against a ${activeCheckpoint.poolTarget}-job candidate-pool target` : ""}. RapidApply will continue through its saved application checkpoints under the campaign autonomy policy.`,
          dotClass: "bg-violet-500",
          progressClass: "bg-violet-500",
        }
      : runStatus === "needs_user_input" && activeCheckpoint?.reason
        ? {
            ...STATUS_COPY.needs_user_input,
            description: activeCheckpoint.reason,
          }
        : STATUS_COPY[runStatus];
    const isTerminal = runStatus === "completed" || runStatus === "failed" || runStatus === "cancelled";
    const waitingFor = activeCheckpoint?.waitingFor;
    const answerCenterRequired = waitingFor === "application_intervention" ||
      waitingFor === "deferred_question";
    const finalReviewRequired = waitingFor === "final_review";
    const resumeLabel = waitingFor === "resume_selection"
      ? "Resume after selecting resume"
      : waitingFor === "manual_verification"
        ? "Retry after review"
        : waitingFor === "login_or_security"
          ? "Continue after sign-in"
          : "Resume campaign";

    return (
      <div className="animate-in fade-in zoom-in-95 rounded-2xl border-2 border-white/80 bg-white/75 p-6 shadow-[0_20px_48px_-12px_rgba(10,36,114,0.18)] ring-1 ring-primary/[0.05] backdrop-blur-2xl duration-200">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className={cn("size-2 shrink-0 rounded-full", status.dotClass, runStatus === "running" && "animate-pulse")} />
                <h3 className="text-[15px] font-bold text-foreground">{status.title}</h3>
              </div>
              <p className="mt-1 text-[12.5px] text-muted-foreground">{status.description}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {role} positions · {location}
              </p>
            </div>
            <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-accent">
              {appliedCount} / {limit} applied
            </span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full transition-all duration-500 ease-out", status.progressClass)}
              style={{ width: `${Math.min(100, (appliedCount / limit) * 100)}%` }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Metric label="Applied" value={appliedCount} />
            <Metric label="Skipped" value={skippedCount} />
          </div>

          {launchError && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
              {launchError}
            </p>
          )}

          <div className="rounded-lg border border-border bg-[#fafbfc]/80 p-3 text-[12.5px]">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Recorded activity</div>
            <div className="h-32 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
              {runLogs.length > 0 ? (
                runLogs.map((log) => (
                  <div key={log.id} className="flex items-start justify-between gap-3 border-b border-black/[0.03] pb-1.5 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <span className="font-semibold text-foreground">{log.role}</span>
                      <span className="text-muted-foreground"> at </span>
                      <span className="font-medium text-foreground">{log.company}</span>
                      <span className={cn(
                        "ml-1.5 rounded-sm px-1 py-0.5 text-[10px] font-medium",
                        log.status === "applied"
                          ? "border border-blue-200/50 bg-blue-50 text-blue-700"
                          : log.status === "discovered"
                            ? "border border-violet-200/50 bg-violet-50 text-violet-700"
                            : log.status === "qualified"
                              ? "border border-emerald-200/50 bg-emerald-50 text-emerald-700"
                            : "border border-amber-200/50 bg-amber-50 text-amber-700",
                      )}>
                        {log.status === "applied"
                          ? "Applied"
                          : log.status === "discovered"
                            ? "Discovered"
                            : log.status === "qualified"
                              ? "Qualified"
                            : log.reason ?? "Skipped"}
                      </span>
                    </div>
                    <span className="shrink-0 text-[11px] font-medium" style={{ color: log.boardColor }}>
                      {log.board}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex h-full items-center justify-center text-center text-[12px] italic text-muted-foreground">
                  {runStatus === "ready"
                    ? "Prepare the connected browser helper to claim this campaign."
                    : runStatus === "claimed"
                      ? "The dedicated tab is opening the configured LinkedIn search."
                      : "No verified activity has been recorded yet."}
                </div>
              )}
            </div>
          </div>

          {activeRunId && (
            <p className="font-mono text-[10.5px] text-muted-foreground">Campaign ID: {activeRunId}</p>
          )}

          <div className="flex gap-2 pt-1">
            {runStatus === "ready" ? (
              <>
                <button
                  onClick={onPrepareBrowserHelper}
                  disabled={isSaving || !browserHelperConnected}
                  className="h-11 flex-1 rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#123a9e]"
                >
                  {isSaving
                    ? "Preparing helper…"
                    : browserHelperConnected
                      ? "Prepare browser helper"
                      : "Browser helper required"}
                </button>
                <button
                  onClick={onResetRun}
                  disabled={isSaving}
                  className="h-11 px-3 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
                >
                  New campaign
                </button>
                <CancelButton onClick={onCancelRun} disabled={isSaving} />
              </>
            ) : runStatus === "claimed" ? (
              <>
                <button
                  onClick={browserHelperOwnsRun ? undefined : onPrepareBrowserHelper}
                  disabled={isSaving || browserHelperOwnsRun || !browserHelperConnected}
                  className="h-11 flex-1 rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#123a9e] disabled:cursor-default disabled:opacity-70"
                >
                  {isSaving
                    ? "Reconnecting…"
                    : browserHelperOwnsRun
                      ? "Starting LinkedIn…"
                      : "Reconnect browser helper"}
                </button>
                <CancelButton onClick={onCancelRun} disabled={isSaving} />
              </>
            ) : runStatus === "running" ? (
              <>
                {browserHelperOwnsRun ? (
                  <button
                    onClick={onPauseRun}
                    disabled={isSaving}
                    className="h-11 flex-1 rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#123a9e]"
                  >
                    Pause campaign
                  </button>
                ) : (
                  <button
                    onClick={onPrepareBrowserHelper}
                    disabled={isSaving || !browserHelperConnected}
                    className="h-11 flex-1 rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#123a9e]"
                  >
                    {isSaving ? "Reconnecting…" : "Reconnect browser helper"}
                  </button>
                )}
                <CancelButton onClick={onCancelRun} disabled={isSaving} />
              </>
            ) : runStatus === "needs_user_input" && (
              activeCheckpoint?.kind === "discovery_complete" ||
              activeCheckpoint?.kind === "qualification_complete"
            ) ? (
              <>
                <button
                  onClick={onPrepareBrowserHelper}
                  disabled={isSaving || !browserHelperConnected}
                  className="h-11 flex-1 rounded-lg bg-violet-600 text-[13px] font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
                >
                  Resume campaign
                </button>
                <CancelButton onClick={onCancelRun} disabled={isSaving} />
              </>
            ) : runStatus === "needs_user_input" && answerCenterRequired ? (
              <>
                <button
                  disabled
                  className="h-11 flex-1 cursor-default rounded-lg bg-amber-100 text-[13px] font-semibold text-amber-800"
                >
                  {waitingFor === "deferred_question"
                    ? "Question saved for Answer Center"
                    : "Answer needed in Answer Center"}
                </button>
                <CancelButton onClick={onCancelRun} disabled={isSaving} />
              </>
            ) : runStatus === "needs_user_input" && finalReviewRequired ? (
              <>
                <button
                  disabled
                  className="h-11 flex-1 cursor-default rounded-lg bg-violet-100 text-[13px] font-semibold text-violet-700"
                >
                  Ready for your LinkedIn review
                </button>
                <CancelButton onClick={onCancelRun} disabled={isSaving} />
              </>
            ) : runStatus === "paused" || runStatus === "needs_user_input" ? (
              <>
                {browserHelperOwnsRun ? (
                  <button
                    onClick={onResumeRun}
                    disabled={isSaving}
                    className="h-11 flex-1 rounded-lg bg-emerald-600 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-700"
                  >
                    {resumeLabel}
                  </button>
                ) : (
                  <button
                    onClick={onPrepareBrowserHelper}
                    disabled={isSaving || !browserHelperConnected}
                    className="h-11 flex-1 rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#123a9e]"
                  >
                    {isSaving ? "Reconnecting…" : "Reconnect browser helper"}
                  </button>
                )}
                <CancelButton onClick={onCancelRun} disabled={isSaving} />
              </>
            ) : isTerminal ? (
              <button
                onClick={onResetRun}
                disabled={isSaving}
                className="h-11 flex-1 rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#123a9e]"
              >
                Create another campaign
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-white/80 bg-white/75 p-6 shadow-[0_20px_48px_-12px_rgba(10,36,114,0.18)] ring-1 ring-primary/[0.05] backdrop-blur-2xl">
      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-[2]">
          <Search className="pointer-events-none absolute left-5 top-1/2 size-[19px] -translate-y-1/2 text-muted-foreground" />
          <Input
            value={role}
            onChange={(event) => onRole(event.target.value)}
            placeholder="Title, skill, or company — e.g. Product Designer"
            className="h-14 rounded-lg border-transparent bg-input-background/70 pl-14 pr-5 text-[15px] shadow-none focus-visible:bg-white"
          />
        </div>

        <div className="relative w-full shrink-0 lg:w-[280px]">
          <MapPin className="pointer-events-none absolute left-5 top-1/2 size-[19px] -translate-y-1/2 text-muted-foreground" />
          <Input
            value={location}
            onChange={(event) => onLocation(event.target.value)}
            placeholder="Where? — e.g. Remote"
            className="h-14 rounded-lg border-transparent bg-input-background/70 pl-14 pr-5 text-[15px] shadow-none focus-visible:bg-white"
          />
        </div>
      </div>

      <div className="mt-5 px-1">
        <div className="mb-2 flex items-center justify-between">
          <Label className="text-[13px] font-medium text-muted-foreground">Application target</Label>
          <span className="font-mono text-[13px] font-semibold tabular-nums text-accent">{limit}</span>
        </div>
        <Slider
          value={[limit]}
          min={5}
          max={100}
          step={5}
          onValueChange={([value]) => onLimitChange(value)}
          className="py-1"
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2.5 px-1">
        <span className="mr-1 text-[12px] font-medium text-muted-foreground">Target sources</span>
        {boards.map((board) => (
          <BoardChip
            key={board.id}
            board={board}
            selected={Boolean(selected[board.id])}
            onToggle={() => onToggleBoard(board.id)}
          />
        ))}

        <button
          onClick={onToggleAdvanced}
          className={cn(
            "ml-auto flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-all",
            advancedOpen
              ? "border-primary/20 bg-primary/[0.05] text-primary"
              : "border-border text-muted-foreground hover:border-primary/20 hover:text-foreground",
          )}
        >
          <SlidersHorizontal className="size-[14px]" strokeWidth={2} />
          Fine-tune
          <ChevronDown className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")} />
        </button>
      </div>

      <p className="mt-2 px-1 text-[11.5px] leading-relaxed text-muted-foreground">
        LinkedIn is the first supported execution source. Other job boards will be added behind the same campaign interface.
      </p>

      <AdvancedSettings open={advancedOpen} config={config} onChange={onConfigChange} />

      <div className="mt-5">
        <button
          onClick={onStartPreflight}
          disabled={!canStart}
          className="group flex h-14 w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground shadow-md shadow-primary/15 transition-all hover:bg-[#123a9e] disabled:opacity-40"
        >
          Review campaign
          <ArrowRight className="size-[18px] transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}

function ScopeRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-6", !last && "border-b border-border/40 pb-2")}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-semibold text-foreground">{value}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-white/70 p-2.5 text-center">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[16px] font-bold text-foreground">{value}</div>
    </div>
  );
}

function CancelButton({
  onClick,
  disabled,
}: {
  onClick: () => Promise<void> | void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-11 border border-rose-200 bg-rose-50 px-5 text-[13px] font-semibold text-rose-600 transition-colors hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60"
    >
      Cancel
    </button>
  );
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
