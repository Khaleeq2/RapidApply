import { Sparkles } from "lucide-react";
import { cn } from "./ui/utils";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Input } from "./ui/input";

export type AdvancedConfig = {
  dailyLimit: number;
  experience: string;
  workStyle: string;
  aiTailor: boolean;
  onlyEasyApply: boolean;
  exclude: string;
  autonomyMode?: "autonomous" | "strict_control";
  unknownFieldStrategy?: "defer_to_finish_later" | "skip_job" | "pause_campaign";
  hourlyCap?: number;
};

export function AdvancedSettings({
  open,
  config,
  onChange,
}: {
  open: boolean;
  config: AdvancedConfig;
  onChange: (patch: Partial<AdvancedConfig>) => void;
}) {
  return (
    <div
      className={cn(
        "grid transition-all duration-300 ease-out",
        open ? "mt-4 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}
    >
      <div className="overflow-hidden">
        <div className="border-t border-border/40 pt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[13px] text-muted-foreground font-medium">Experience level</Label>
              <Select
                value={config.experience}
                onValueChange={(v) => onChange({ experience: v })}
              >
                <SelectTrigger className="border border-border bg-white px-3 py-2 text-[14px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border border-border shadow-md">
                  <SelectItem value="entry">Entry level</SelectItem>
                  <SelectItem value="mid">Mid level</SelectItem>
                  <SelectItem value="senior">Senior</SelectItem>
                  <SelectItem value="lead">Lead / Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] text-muted-foreground font-medium">Work style</Label>
              <Select
                value={config.workStyle}
                onValueChange={(v) => onChange({ workStyle: v })}
              >
                <SelectTrigger className="border border-border bg-white px-3 py-2 text-[14px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border border-border shadow-md">
                  <SelectItem value="remote">Remote only</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                  <SelectItem value="onsite">On-site</SelectItem>
                  <SelectItem value="any">Any</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[13px] text-muted-foreground font-medium">Campaign Autonomy Mode</Label>
              <Select
                value={config.autonomyMode ?? "autonomous"}
                onValueChange={(v) => onChange({ autonomyMode: v as "autonomous" | "strict_control" })}
              >
                <SelectTrigger className="border border-border bg-white px-3 py-2 text-[14px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border border-border shadow-md">
                  <SelectItem value="autonomous">Fully Autonomous (Unattended)</SelectItem>
                  <SelectItem value="strict_control">Strict Control (Prompt on unknown)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] text-muted-foreground font-medium">Unknown Field Fallback</Label>
              <Select
                value={config.unknownFieldStrategy ?? "defer_to_finish_later"}
                onValueChange={(v) => onChange({ unknownFieldStrategy: v as "defer_to_finish_later" | "skip_job" | "pause_campaign" })}
              >
                <SelectTrigger className="border border-border bg-white px-3 py-2 text-[14px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border border-border shadow-md">
                  <SelectItem value="defer_to_finish_later">Defer to "Finish Later" Queue</SelectItem>
                  <SelectItem value="skip_job">Skip Job & Continue</SelectItem>
                  <SelectItem value="pause_campaign">Pause Campaign</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] text-muted-foreground font-medium">Exclude keywords</Label>
            <Input
              value={config.exclude}
              onChange={(e) => onChange({ exclude: e.target.value })}
              placeholder="e.g. unpaid, commission-only, clearance"
              className="bg-white border border-border text-[14px]"
            />
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-accent/20 bg-accent/[0.03] p-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
              <Sparkles className="size-4" strokeWidth={2} />
            </span>
            <span className="flex-1">
              <span className="block text-[14px] font-medium text-foreground">
                AI Free-Text Drafting
              </span>
              <span className="text-[12px] leading-snug text-muted-foreground">
                Generate grounded candidate-truthful drafts for open-ended text fields automatically.
              </span>
            </span>
            <Switch
              checked={config.aiTailor}
              onCheckedChange={(v) => onChange({ aiTailor: v })}
            />
          </label>

          <label className="flex cursor-pointer items-center gap-3 px-1">
            <Switch
              checked={config.onlyEasyApply}
              onCheckedChange={(v) => onChange({ onlyEasyApply: v })}
            />
            <span className="text-[13px] text-foreground">
              Prefer quick-apply listings when a supported workflow exists
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
