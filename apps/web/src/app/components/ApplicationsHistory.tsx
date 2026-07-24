import { useState, useMemo, useRef, useEffect } from "react";
import type { RunState } from "@rapidapply/contracts";
import {
  Search,
  Calendar,
  Building2,
  MapPin,
  CheckCircle2,
  Clock,
  XCircle,
  ChevronDown,
  ChevronRight,
  X,
  LayoutGrid,
  List,
  SlidersHorizontal,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "./ui/utils";

/* ------------------------------------------------------------------ */
/*  Interfaces                                                        */
/* ------------------------------------------------------------------ */

export interface Application {
  id: string;
  role: string;
  company: string;
  location: string;
  status: "applied" | "interviewing" | "rejected" | "ghosted";
  board: string;
  boardColor: string;
  date: string;
  reason?: string;
}

export interface PastRun {
  id: string;
  state: RunState;
  role: string;
  location: string;
  date: string;
  targetLimit: number;
  applied: number;
  skipped: number;
  boards: string[];
  applications: Application[];
}

const STATUS_CONFIG = {
  applied: {
    icon: Clock,
    color: "text-blue-600",
    bg: "bg-blue-50",
    dot: "bg-blue-500",
    label: "Applied",
  },
  interviewing: {
    icon: CheckCircle2,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    dot: "bg-emerald-500",
    label: "Interviewing",
  },
  rejected: {
    icon: XCircle,
    color: "text-rose-600",
    bg: "bg-rose-50",
    dot: "bg-rose-500",
    label: "Rejected",
  },
  ghosted: {
    icon: Clock,
    color: "text-slate-500",
    bg: "bg-slate-50",
    dot: "bg-slate-400",
    label: "Ghosted",
  },
};

const RUN_STATE_CONFIG: Record<RunState, { label: string; className: string }> = {
  created: { label: "Created", className: "bg-slate-100 text-slate-600" },
  starting: { label: "Starting", className: "bg-blue-50 text-blue-700" },
  searching: { label: "Searching", className: "bg-indigo-50 text-indigo-700" },
  opening_job: { label: "Opening Job", className: "bg-indigo-50 text-indigo-700" },
  easy_apply: { label: "Easy Apply", className: "bg-purple-50 text-purple-700" },
  fill_step: { label: "Filling Form", className: "bg-purple-50 text-purple-700" },
  submit_attempted: { label: "Submitting", className: "bg-amber-50 text-amber-700" },
  submitted: { label: "Submitted", className: "bg-emerald-50 text-emerald-700" },
  ready: { label: "Ready", className: "bg-blue-50 text-blue-700" },
  claimed: { label: "Helper prepared", className: "bg-violet-50 text-violet-700" },
  running: { label: "Running", className: "bg-blue-50 text-blue-700" },
  paused: { label: "Paused", className: "bg-amber-50 text-amber-700" },
  needs_user_input: { label: "Needs input", className: "bg-amber-50 text-amber-700" },
  completed: { label: "Completed", className: "bg-emerald-50 text-emerald-700" },
  failed: { label: "Needs attention", className: "bg-rose-50 text-rose-700" },
  cancelled: { label: "Cancelled", className: "bg-slate-100 text-slate-600" },
};

export function ApplicationsHistory({ pastRuns }: { pastRuns: PastRun[] }) {
  const [viewMode, setViewMode] = useState<"list" | "pipeline">("list");
  const [search, setSearch] = useState("");
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);

  // Toggle run collapse
  const toggleRun = (runId: string) => {
    setExpandedRuns((prev) => ({ ...prev, [runId]: !prev[runId] }));
  };

  // Flatten all applications for search / pipeline filtering
  const allApplications = useMemo(() => {
    return pastRuns.flatMap((run) =>
      run.applications.map((app) => ({
        ...app,
        runId: run.id,
        runRole: run.role,
      }))
    );
  }, [pastRuns]);

  // Filtered applications based on search query
  const filteredApps = useMemo(() => {
    if (!search.trim()) return allApplications;
    const q = search.toLowerCase();
    return allApplications.filter(
      (app) =>
        app.role.toLowerCase().includes(q) ||
        app.company.toLowerCase().includes(q) ||
        app.location.toLowerCase().includes(q)
    );
  }, [allApplications, search]);

  // Group applications for pipeline board
  const pipelineGroups = useMemo(() => {
    const groups: Record<Application["status"], typeof filteredApps> = {
      applied: [],
      interviewing: [],
      rejected: [],
      ghosted: [],
    };
    filteredApps.forEach((app) => {
      groups[app.status].push(app);
    });
    return groups;
  }, [filteredApps]);

  return (
    <div className="flex flex-col gap-5 pt-5 pb-4 h-full min-h-0 relative">
      {/* Page Header */}
      <div className="shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Applications</h1>
          <p className="text-[14px] text-muted-foreground">
            Review saved campaign records and any verified application activity.
          </p>
        </div>

        {/* View Switcher: List vs Pipeline */}
        <div className="flex items-center rounded-lg border border-border bg-white p-1">
          <button
            onClick={() => setViewMode("list")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-all cursor-pointer",
              viewMode === "list"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <List className="size-3.5" />
            Runs view
          </button>
          <button
            onClick={() => setViewMode("pipeline")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-all cursor-pointer",
              viewMode === "pipeline"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <LayoutGrid className="size-3.5" />
            Pipeline Board
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search roles, companies, locations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-white pl-8 pr-8 text-[13px] outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/10"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 grid size-4 place-items-center rounded-full bg-muted text-muted-foreground hover:bg-foreground/10 cursor-pointer"
            >
              <X className="size-2.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── View: Runs Collapsible List ── */}
      {viewMode === "list" && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
          {pastRuns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-white/50 p-10 text-center">
              <h3 className="text-[14px] font-semibold text-foreground">No saved campaigns yet</h3>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Create a campaign from the Launchpad and it will appear here with its verified activity.
              </p>
            </div>
          ) : pastRuns.map((run) => {
            const isExpanded = !!expandedRuns[run.id];
            const state = RUN_STATE_CONFIG[run.state];
            // Filter run applications based on search query
            const runApps = run.applications.filter((app) => {
              if (!search.trim()) return true;
              const q = search.toLowerCase();
              return (
                app.role.toLowerCase().includes(q) ||
                app.company.toLowerCase().includes(q) ||
                app.location.toLowerCase().includes(q)
              );
            });

            if (search.trim() && runApps.length === 0) return null;

            return (
              <div
                key={run.id}
                className="rounded-xl border border-border bg-white/70 overflow-hidden shadow-sm transition-all"
              >
                {/* Run Card Header */}
                <div
                  onClick={() => toggleRun(run.id)}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-secondary/15 cursor-pointer hover:bg-secondary/25 transition-colors border-b border-border/40 select-none"
                >
                  <div className="flex items-start gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <SlidersHorizontal className="size-4" />
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[14.5px] font-bold leading-tight text-foreground">
                          {run.role} in {run.location}
                        </h3>
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", state.className)}>
                          {state.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[12px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="size-3" />
                          {new Date(run.date).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                        <span className="size-1 rounded-full bg-border" />
                        <span>Target limit: {run.targetLimit}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 self-end sm:self-auto">
                    <div className="text-right text-[12px] tabular-nums">
                      <span className="font-semibold text-emerald-600">{run.applied} applied</span>
                      <span className="text-muted-foreground mx-1.5">·</span>
                      <span className="text-muted-foreground">{run.skipped} skipped</span>
                    </div>
                    {isExpanded ? (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* Expanded Run applications table */}
                {isExpanded && (
                  <div className="divide-y divide-border/40 max-h-[380px] overflow-y-auto">
                    {runApps.length > 0 ? (
                      runApps.map((app) => {
                        const cfg = STATUS_CONFIG[app.status];
                        return (
                          <div
                            key={app.id}
                            onClick={() => setSelectedApp(app)}
                            className="group grid grid-cols-[1fr_120px_100px_120px_44px] items-center gap-x-2 px-4 py-3 transition-colors hover:bg-primary/[0.02] cursor-pointer"
                          >
                            <div className="min-w-0 pl-2">
                              <div className="truncate text-[13px] font-semibold text-foreground group-hover:text-primary transition-colors">
                                {app.role}
                              </div>
                              <div className="truncate text-[12px] text-muted-foreground mt-0.5">
                                {app.company}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <span
                                className="size-2 rounded-full shrink-0"
                                style={{ backgroundColor: app.boardColor }}
                              />
                              <span className="text-[12px] font-medium text-foreground/80">
                                {app.board}
                              </span>
                            </div>

                            <div className="inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold">
                              <span className={cn("size-1.5 rounded-full", cfg.dot)} />
                              <span className={cfg.color}>{cfg.label}</span>
                            </div>

                            <div className="truncate text-[12px] text-muted-foreground">
                              {app.location}
                            </div>

                            <button className="grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-muted hover:text-foreground cursor-pointer">
                              <ChevronRight className="size-4" />
                            </button>
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-8 text-center text-[13px] text-muted-foreground italic">
                        {run.applications.length === 0
                          ? `No individual application records are available for this campaign yet. This campaign is ${state.label.toLowerCase()}.`
                          : "No applications matched your search within this run."}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── View: Pipeline Kanban Board ── */}
      {viewMode === "pipeline" && (
        <div className="flex-1 min-h-0 flex flex-row gap-4 overflow-x-auto pb-2 scrollbar-thin">
          {(Object.keys(STATUS_CONFIG) as Array<keyof typeof STATUS_CONFIG>).map((status) => {
            const cfg = STATUS_CONFIG[status];
            const list = pipelineGroups[status];

            return (
              <div key={status} className="flex flex-col h-full bg-[#f8fafc]/50 rounded-xl border border-border/80 p-3 w-[270px] sm:w-[290px] shrink-0">
                {/* Column header */}
                <div className="shrink-0 flex items-center justify-between mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", cfg.dot)} />
                    <h3 className="text-[13px] font-bold uppercase tracking-wider text-foreground">{cfg.label}</h3>
                  </div>
                  <span className="text-[11px] font-bold tabular-nums text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-md">
                    {list.length}
                  </span>
                </div>

                {/* Column cards container */}
                <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5 scrollbar-thin">
                  {list.length > 0 ? (
                    list.map((app) => (
                      <div
                        key={app.id}
                        onClick={() => setSelectedApp(app)}
                        className="p-3 bg-white border border-border rounded-lg shadow-sm hover:border-primary/20 hover:shadow transition-all cursor-pointer group"
                      >
                        <div className="text-[12.5px] font-bold text-foreground group-hover:text-primary transition-colors leading-snug">
                          {app.role}
                        </div>
                        <div className="text-[11.5px] text-muted-foreground mt-0.5 font-medium">
                          {app.company}
                        </div>

                        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground border-t border-black/[0.02] pt-2">
                          <span className="flex items-center gap-1">
                            <MapPin className="size-3" />
                            {app.location.split("·")[0].trim()}
                          </span>
                          <span className="font-semibold" style={{ color: app.boardColor }}>
                            {app.board}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex h-32 items-center justify-center border border-dashed border-border/60 rounded-lg text-[11.5px] text-muted-foreground/60 italic">
                      Empty
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Slide-out Details Drawer ── */}
      <AnimatePresence>
        {selectedApp && (
          <>
            {/* Backdrop overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.3 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedApp(null)}
              className="fixed inset-0 z-40 bg-black"
            />

            {/* Slide drawer */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="fixed top-0 right-0 z-50 h-full w-full sm:w-[460px] bg-white border-l border-border/80 shadow-2xl p-6 flex flex-col"
            >
              {/* Header */}
              <div className="shrink-0 flex items-start justify-between pb-4 border-b border-border/60">
                <div className="min-w-0 pr-4">
                  <span className="text-[11px] font-semibold text-accent uppercase tracking-wider">
                    Application details
                  </span>
                  <h2 className="text-[17px] font-bold text-foreground leading-tight mt-1">
                    {selectedApp.role}
                  </h2>
                  <p className="text-[13px] text-muted-foreground mt-1">
                    {selectedApp.company} · {selectedApp.location}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedApp(null)}
                  className="p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <X className="size-5" />
                </button>
              </div>

              {/* Drawer Content */}
              <div className="flex-1 min-h-0 overflow-y-auto py-5 space-y-6 scrollbar-thin text-[13px]">
                {/* Meta details */}
                <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-slate-50/50 p-4">
                  <div>
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase">Board source</div>
                    <div className="font-semibold text-foreground flex items-center gap-1.5 mt-1">
                      <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: selectedApp.boardColor }} />
                      {selectedApp.board}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase">Status</div>
                    <div className="font-semibold flex items-center gap-1.5 mt-1">
                      <span className={cn("size-1.5 rounded-full", STATUS_CONFIG[selectedApp.status].dot)} />
                      <span className={STATUS_CONFIG[selectedApp.status].color}>
                        {STATUS_CONFIG[selectedApp.status].label}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase">Applied date</div>
                    <div className="font-semibold text-foreground mt-1">
                      {new Date(selectedApp.date).toLocaleDateString(undefined, {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase">Outcome</div>
                    <div className="mt-1 font-semibold text-muted-foreground">Not recorded</div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Recorded evidence</div>
                  <div className="rounded-lg border border-primary/10 bg-primary/[0.02] p-3 leading-relaxed text-muted-foreground">
                    This detail view currently contains only the verified fields shown above. Resume selection, responses,
                    confirmation evidence, and outcome updates will appear only after the executor sends structured,
                    verified records.
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Candidate-control boundary</div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 leading-relaxed text-amber-800">
                    Any uncertain, legal, compensation, or disclosure question must remain pending for the candidate.
                  </div>
                </div>
              </div>

              <div className="shrink-0 border-t border-border/60 pt-4 text-center text-[12px] text-muted-foreground">
                Live-listing links are not stored in this foundation build.
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
