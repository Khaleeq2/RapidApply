import { type LucideIcon } from "lucide-react";

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-white/70 backdrop-blur-xl p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        <span
          className={
            "grid size-8 place-items-center rounded-lg " +
            (accent ? "bg-accent/10 text-accent" : "bg-primary/8 text-primary")
          }
        >
          <Icon className="size-[16px]" strokeWidth={2} />
        </span>
      </div>
      <div className="mt-3 font-display text-[28px] font-bold leading-none text-foreground tabular-nums">
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[12px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
