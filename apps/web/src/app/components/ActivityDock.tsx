import { AnimatePresence, motion } from "motion/react";
import {
  CheckCircle2,
  Loader2,
  Search,
  FileText,
  Send,
  Radio,
  ChevronDown,
  Compass,
} from "lucide-react";
import { cn } from "./ui/utils";

export type FeedEvent = {
  id: number;
  kind: "search" | "match" | "tailor" | "apply";
  board: string;
  boardColor: string;
  title: string;
  detail: string;
  done: boolean;
};

const ICONS = {
  search: Search,
  match: Compass,
  tailor: FileText,
  apply: Send,
};

export function ActivityDock({
  running,
  events,
  minimized,
  onToggle,
}: {
  running: boolean;
  events: FeedEvent[];
  minimized: boolean;
  onToggle: () => void;
}) {
  const visible = running || events.length > 0;
  const latest = events[0];
  const appliedCount = events.filter((e) => e.kind === "apply").length;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="fixed bottom-5 right-5 z-50 w-[min(370px,calc(100vw-2.5rem))]"
        >
          <div className="overflow-hidden rounded-xl border border-white/70 bg-white/80 shadow-[0_28px_70px_-20px_rgba(10,36,114,0.4)] backdrop-blur-2xl">
            {/* Header (always visible) */}
            <button
              onClick={onToggle}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
            >
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-xl",
                  running ? "bg-accent/10 text-accent" : "bg-emerald-50 text-emerald-600"
                )}
              >
                {running ? (
                  <Loader2 className="size-[18px] animate-spin" strokeWidth={2.2} />
                ) : (
                  <CheckCircle2 className="size-[18px]" strokeWidth={2.2} />
                )}
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-[14px] font-medium text-foreground">
                  {running ? "On the hunt for you" : "Hunt paused"}
                </div>
                <div className="truncate text-[12px] text-muted-foreground">
                  {minimized && latest ? latest.detail : `${appliedCount} applications sent`}
                </div>
              </div>
              {running && (
                <span className="flex items-center gap-1.5 rounded-full bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent">
                  <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                  LIVE
                </span>
              )}
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  minimized && "rotate-180"
                )}
              />
            </button>

            {/* Body */}
            <div
              className={cn(
                "grid transition-all duration-300 ease-out",
                minimized ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
              )}
            >
              <div className="overflow-hidden">
                <div className="max-h-[320px] overflow-y-auto border-t border-border px-4 py-3">
                  <ol className="space-y-3">
                    {events.map((e, i) => {
                      const Icon = ICONS[e.kind];
                      const isLast = i === events.length - 1;
                      return (
                        <li key={e.id} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <span
                              className={cn(
                                "grid size-7 shrink-0 place-items-center rounded-full",
                                e.done
                                  ? "bg-emerald-50 text-emerald-600"
                                  : "bg-accent/10 text-accent"
                              )}
                            >
                              {e.done ? (
                                <CheckCircle2 className="size-[15px]" strokeWidth={2.2} />
                              ) : (
                                <Icon className="size-[15px]" strokeWidth={2.2} />
                              )}
                            </span>
                            {!isLast && <span className="mt-1 w-px flex-1 bg-border" />}
                          </div>
                          <div className="pb-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[13px] font-medium text-foreground">
                                {e.title}
                              </span>
                              <span
                                className="rounded px-1.5 py-px text-[10px] font-medium text-white"
                                style={{ backgroundColor: e.boardColor }}
                              >
                                {e.board}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                              {e.detail}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
