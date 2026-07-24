import { useMemo } from "react";
import type { PastRun } from "./ApplicationsHistory";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
} from "recharts";
import { Activity, CheckCircle2, Clock3, Send, Sparkles } from "lucide-react";
import { StatCard } from "./StatCard";

const BOARD_COLORS: Record<string, string> = {
  LinkedIn: "#0a66c2",
  Indeed: "#2557a7",
  Monster: "#6e46ae",
};

const STATUS_ROWS = [
  { state: "ready", label: "Ready", color: "bg-blue-500" },
  { state: "claimed", label: "Helper prepared", color: "bg-violet-500" },
  { state: "running", label: "Running", color: "bg-primary" },
  { state: "needs_user_input", label: "Needs input", color: "bg-amber-500" },
  { state: "completed", label: "Completed", color: "bg-emerald-500" },
] as const;

export function InsightsPage({ runs }: { runs: PastRun[] }) {
  const data = useMemo(() => deriveInsights(runs), [runs]);

  return (
    <div className="space-y-6 pb-4 pt-5">
      <div>
        <h1 className="text-[28px] font-bold tracking-tight">Insights</h1>
        <p className="text-[14px] text-muted-foreground">
          A truthful view of saved campaigns and verified execution activity.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Activity} label="Campaigns saved" value={String(data.totalRuns)} sub="all recorded campaigns" />
        <StatCard icon={Send} label="Applications verified" value={String(data.totalApplied)} sub="submitted events only" />
        <StatCard icon={CheckCircle2} label="Completed campaigns" value={String(data.completedRuns)} sub={`${data.completionRate}% of saved campaigns`} accent />
        <StatCard icon={Clock3} label="Active campaigns" value={String(data.activeRuns)} sub="ready, running, paused, or awaiting input" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h3 className="text-[15px] font-bold text-foreground">Campaign status</h3>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              State is updated only by the durable campaign event stream.
            </p>
          </div>

          <div className="space-y-3.5 pt-2">
            {STATUS_ROWS.map((status) => {
              const count = data.stateCounts[status.state] ?? 0;
              const percentage = percentageOf(count, data.totalRuns);

              return (
                <div key={status.state} className="space-y-1.5">
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="font-semibold text-foreground">{status.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {count} <span className="text-[11px] font-normal text-muted-foreground/60">({percentage}%)</span>
                    </span>
                  </div>
                  <div className="h-4 w-full overflow-hidden rounded-md bg-muted">
                    <div className={`${status.color} h-full rounded-md transition-all duration-500`} style={{ width: `${percentage}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h3 className="text-[15px] font-bold text-foreground">Early signals</h3>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              Recommendations become richer as verified executor events arrive.
            </p>
          </div>

          <div className="space-y-3">
            {data.findings.map((finding) => (
              <div
                key={finding.title}
                className="flex items-start gap-3 rounded-lg border border-border bg-slate-50/50 p-3 text-[12.5px] leading-relaxed"
              >
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-primary/5 text-primary">
                  <Sparkles className="size-3.5" />
                </span>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-bold text-foreground">{finding.title}</h4>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {finding.badge}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{finding.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[15px] font-bold text-foreground">Campaigns saved over time</h3>
            <span className="text-[12px] text-muted-foreground">Last 7 days</span>
          </div>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="campaign-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(10,36,114,0.06)" />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12, fill: "#5b6b86" }}
                />
                <ChartTooltip
                  cursor={{ stroke: "#2563eb", strokeOpacity: 0.2 }}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid rgba(10,36,114,0.1)",
                    fontSize: 13,
                    boxShadow: "0 12px 30px -12px rgba(10,36,114,0.3)",
                  }}
                />
                <Area type="monotone" dataKey="campaigns" stroke="#2563eb" strokeWidth={2.5} fill="url(#campaign-fill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
          <h3 className="mb-1 text-[15px] font-bold text-foreground">Campaign target boards</h3>
          <p className="mb-5 text-[12px] text-muted-foreground">Board selections across saved campaigns.</p>
          <div className="space-y-5">
            {data.boardBreakdown.map((board) => (
              <div key={board.name}>
                <div className="mb-1.5 flex items-center justify-between text-[13px]">
                  <span className="font-medium text-foreground">{board.name}</span>
                  <span className="tabular-nums text-muted-foreground">{board.count} · {board.percentage}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${board.percentage}%`, backgroundColor: board.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function deriveInsights(runs: PastRun[]) {
  const totalRuns = runs.length;
  const totalApplied = runs.reduce((total, run) => total + run.applied, 0);
  const completedRuns = runs.filter((run) => run.state === "completed").length;
  const activeRuns = runs.filter((run) =>
    ["ready", "claimed", "running", "paused", "needs_user_input"].includes(run.state),
  ).length;
  const stateCounts = runs.reduce<Record<string, number>>((counts, run) => {
    counts[run.state] = (counts[run.state] ?? 0) + 1;
    return counts;
  }, {});

  const boardCounts = new Map<string, number>();
  let totalBoardSelections = 0;
  for (const run of runs) {
    for (const board of run.boards) {
      boardCounts.set(board, (boardCounts.get(board) ?? 0) + 1);
      totalBoardSelections += 1;
    }
  }

  const boardBreakdown = Object.keys(BOARD_COLORS).map((name) => {
    const count = boardCounts.get(name) ?? 0;
    return {
      name,
      count,
      percentage: percentageOf(count, totalBoardSelections),
      color: BOARD_COLORS[name],
    };
  });

  const trend = buildSevenDayTrend(runs);
  const findings = buildFindings({ totalRuns, totalApplied, activeRuns, completedRuns });

  return {
    totalRuns,
    totalApplied,
    completedRuns,
    activeRuns,
    completionRate: percentageOf(completedRuns, totalRuns),
    stateCounts,
    boardBreakdown,
    trend,
    findings,
  };
}

function buildSevenDayTrend(runs: PastRun[]) {
  const counts = new Map<string, number>();
  for (const run of runs) {
    const key = new Date(run.date).toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    return {
      day: date.toLocaleDateString(undefined, { weekday: "short" }),
      campaigns: counts.get(key) ?? 0,
    };
  });
}

function buildFindings({
  totalRuns,
  totalApplied,
  activeRuns,
  completedRuns,
}: {
  totalRuns: number;
  totalApplied: number;
  activeRuns: number;
  completedRuns: number;
}) {
  if (totalRuns === 0) {
    return [
      {
        title: "Data capture is ready",
        badge: "Foundation complete",
        description: "Save your first campaign to begin building a durable history. RapidApply will not invent activity before the browser helper verifies it.",
      },
      {
        title: "Execution stays deliberate",
        badge: "Controlled",
        description: "A saved campaign waits in the ready state until a supported browser workflow explicitly claims it.",
      },
    ];
  }

  return [
    {
      title: "Verified activity only",
      badge: `${totalApplied} recorded`,
      description: "Application totals reflect submitted events from the execution layer, not timers or sample data.",
    },
    {
      title: activeRuns > 0 ? "Campaigns are waiting or active" : "No active campaigns",
      badge: `${activeRuns} active`,
      description: activeRuns > 0
        ? "Open a saved campaign to see whether it is ready, running, paused, or waiting for your input."
        : "Create a campaign whenever you are ready to begin another focused job-search run.",
    },
    {
      title: "Outcome learning comes next",
      badge: `${completedRuns} complete`,
      description: "Interview and response insights will become meaningful after verified application and outcome records are connected.",
    },
  ];
}

function percentageOf(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}
