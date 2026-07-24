import { Check } from "lucide-react";
import { cn } from "./ui/utils";

export type Board = {
  id: string;
  name: string;
  color: string;
  initial: string;
};

export function BoardToggle({
  board,
  selected,
  onToggle,
}: {
  board: Board;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all",
        selected
          ? "border-accent/40 bg-accent/[0.06] shadow-sm"
          : "border-border bg-white/50 hover:border-accent/30 hover:bg-white"
      )}
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-lg text-[15px] font-bold text-white"
        style={{ backgroundColor: board.color }}
      >
        {board.initial}
      </span>
      <span className="flex-1">
        <span className="block text-[14px] font-medium leading-tight text-foreground">
          {board.name}
        </span>
        <span className="text-[12px] text-muted-foreground">
          {selected ? "Included" : "Skipped"}
        </span>
      </span>
      <span
        className={cn(
          "grid size-5 place-items-center rounded-full border transition-colors",
          selected
            ? "border-accent bg-accent text-white"
            : "border-border text-transparent"
        )}
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    </button>
  );
}
