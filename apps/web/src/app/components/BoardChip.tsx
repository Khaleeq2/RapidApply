import { cn } from "./ui/utils";
import { type Board } from "./BoardToggle";

export function BoardChip({
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
      title={board.name}
      className={cn(
        "flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 transition-all",
        selected
          ? "border-transparent bg-primary/[0.06] shadow-sm"
          : "border-border bg-white/60 opacity-40 hover:opacity-80"
      )}
    >
      <span
        className="grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white"
        style={{ backgroundColor: selected ? board.color : "#9aa7bd" }}
      >
        {board.initial}
      </span>
      <span
        className={cn(
          "text-[13px] font-medium",
          selected ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {board.name}
      </span>
    </button>
  );
}
