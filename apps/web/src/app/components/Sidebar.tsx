import { useState, useEffect, useRef } from "react";
import {
  Rocket,
  LineChart,
  Send,
  FileText,
  CircleHelp,
  Settings,
  Sparkles,
  ChevronUp,
  CreditCard,
  User,
  LogOut,
} from "lucide-react";
import { cn } from "./ui/utils";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./ui/tooltip";
import { Logo } from "./Logo";

const NAV = [
  { id: "dashboard", label: "Launchpad", icon: Rocket },
  { id: "insights", label: "Insights", icon: LineChart },
  { id: "applications", label: "Applications", icon: Send },
  { id: "answers", label: "Answer Center", icon: CircleHelp },
  { id: "resume", label: "Resume & Profile", icon: FileText },
];

export function Sidebar({
  active,
  onSelect,
  user,
  onSignOut,
}: {
  active: string;
  onSelect: (id: string) => void;
  user: { name: string; email: string };
  onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const val = localStorage.getItem("sidebar-open");
    if (val === "false") {
      setOpen(false);
    } else {
      setOpen(true);
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const clickedButton = menuRef.current?.contains(target);
      const clickedPopover = popoverRef.current?.contains(target);

      if (!clickedButton && !clickedPopover) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const toggleSidebar = () => {
    const newVal = !open;
    setOpen(newVal);
    localStorage.setItem("sidebar-open", String(newVal));
  };

  const isOpen = !mounted || open;
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <TooltipProvider delayDuration={150}>
      {/* Spacer keeps layout at the collapsed rail width; the aside expands as an overlay. */}
      <div className={cn("hidden lg:block shrink-0 transition-[width] duration-300 relative", isOpen ? "w-64" : "w-[84px]")}>
        <aside
          className={cn(
            "fixed left-0 top-0 z-40 flex h-screen flex-col gap-6 overflow-hidden border-r border-border bg-white/70 py-7 backdrop-blur-xl transition-[width,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            isOpen
              ? "w-64 shadow-[0_20px_60px_-20px_rgba(10,36,114,0.25)]"
              : "w-[84px]"
          )}
        >
          {/* Brand/Header */}
          {isOpen ? (
            <div className="group/header relative flex flex-col items-start px-6 w-full shrink-0">
              <div className="flex items-center">
                <Logo className="size-12 text-primary shrink-0" />
                <div className="ml-2.5 min-w-0 leading-tight">
                  <div className="whitespace-nowrap font-display text-[19.5px] font-extrabold text-primary tracking-tight">
                    RapidApply
                  </div>
                  <div className="whitespace-nowrap text-[12.5px] text-muted-foreground mt-0.5">
                    one click. every board.
                  </div>
                </div>
              </div>
              <div className="absolute -top-3.5 right-4 opacity-100 lg:opacity-0 lg:group-hover/header:opacity-100 transition-opacity duration-200">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={toggleSidebar}
                      className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer shrink-0"
                    >
                      <svg className="size-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2 11C2 7.22876 2 5.34315 3.17157 4.17157C4.34315 3 6.22876 3 10 3H14C17.7712 3 19.6569 3 20.8284 4.17157C22 5.34315 22 7.22876 22 11V13C22 16.7712 22 18.6569 20.8284 19.8284C19.6569 21 17.7712 21 14 21H10C6.22876 21 4.34315 21 3.17157 19.8284C2 18.6569 2 16.7712 2 13V11Z" stroke="currentColor" strokeWidth="1.5"></path>
                        <path d="M9 21L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"></path>
                      </svg>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Close sidebar</TooltipContent>
                </Tooltip>
              </div>
            </div>
          ) : (
            <div className="flex justify-center w-full shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="group/logo relative cursor-pointer size-12">
                    <div className="transition-all duration-150 group-hover/logo:opacity-0 group-hover/logo:scale-95 text-primary">
                      <Logo className="size-12" />
                    </div>
                    <button
                      onClick={toggleSidebar}
                      className="absolute inset-0 grid size-12 place-items-center rounded-md border border-white/40 bg-white/80 text-muted-foreground hover:bg-muted hover:text-foreground opacity-0 scale-95 transition-all duration-150 group-hover/logo:opacity-100 group-hover/logo:scale-100 cursor-pointer"
                    >
                      <svg className="size-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2 11C2 7.22876 2 5.34315 3.17157 4.17157C4.34315 3 6.22876 3 10 3H14C17.7712 3 19.6569 3 20.8284 4.17157C22 5.34315 22 7.22876 22 11V13C22 16.7712 22 18.6569 20.8284 19.8284C19.6569 21 17.7712 21 14 21H10C6.22876 21 4.34315 21 3.17157 19.8284C2 18.6569 2 16.7712 2 13V11Z" stroke="currentColor" strokeWidth="1.5"></path>
                        <path d="M9 21L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"></path>
                      </svg>
                    </button>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">Open sidebar</TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Nav — icons pinned to a fixed column so nothing shifts on expand */}
          <nav className="flex flex-col gap-1 px-4 w-full shrink-0">
            {NAV.map(({ id, label, icon: Icon }) => {
              const buttonEl = (
                <button
                  key={id}
                  onClick={() => onSelect(id)}
                  className={cn(
                    "flex items-center rounded-md py-2.5 text-left transition-colors cursor-pointer w-full",
                    active === id
                      ? "bg-primary/8 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <span className="grid w-[52px] shrink-0 place-items-center">
                    <Icon className="size-[20px]" strokeWidth={2} />
                  </span>
                  <span
                    className={cn(
                      "min-w-0 whitespace-nowrap text-[14px] transition-all duration-300",
                      isOpen ? "opacity-100 ml-0" : "opacity-0 w-0 h-0 overflow-hidden ml-0 pointer-events-none",
                      active === id && "font-medium"
                    )}
                  >
                    {label}
                  </span>
                </button>
              );

              return isOpen ? (
                buttonEl
              ) : (
                <Tooltip key={id}>
                  <TooltipTrigger asChild>{buttonEl}</TooltipTrigger>
                  <TooltipContent side="right">{label}</TooltipContent>
                </Tooltip>
              );
            })}
          </nav>

          {/* Subtle Premium Upgrade Card */}
          {isOpen ? (
            <div className="mx-4 mt-auto mb-2 rounded-xl border border-primary/10 bg-primary/[0.02] p-4 text-[12.5px] leading-relaxed relative overflow-hidden group shrink-0">
              {/* background design */}
              <div className="absolute -right-6 -bottom-6 size-16 rounded-full bg-primary/5 blur-xl group-hover:bg-primary/10 transition-all duration-300" />
              <div className="font-bold text-foreground flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-primary shrink-0" />
                Development build
              </div>
              <p className="text-muted-foreground mt-1 leading-snug">
                Billing and usage limits are <span className="font-semibold text-foreground">not active</span> yet.
              </p>
              <button
                onClick={() => onSelect("pricing")}
                className="mt-3 flex items-center gap-1 text-[12.5px] font-bold text-primary hover:text-[#123a9e] transition-colors cursor-pointer"
              >
                View product status →
              </button>
            </div>
          ) : (
            <div className="mt-auto mb-2 mx-auto shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onSelect("pricing")}
                    className="flex size-10 items-center justify-center rounded-lg border border-primary/15 bg-primary/[0.03] text-primary hover:bg-primary hover:text-white transition-all cursor-pointer"
                  >
                    <Sparkles className="size-4.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Product status</TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Profile/Account Footer */}
          <div className="px-4 shrink-0 relative" ref={menuRef}>
            {isOpen ? (
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg border border-border/60 bg-white/40 p-2 text-left hover:bg-muted/50 hover:border-border transition-all cursor-pointer",
                  menuOpen && "bg-muted/80 border-border"
                )}
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-[12px] font-bold">
                  {initials}
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-[13px] font-bold text-foreground">
                  {user.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                  {user.email}
                  </div>
                </div>
                <ChevronUp className={cn("size-3.5 text-muted-foreground transition-transform duration-200", menuOpen && "rotate-180")} />
              </button>
            ) : (
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className={cn(
                  "mx-auto flex size-10 items-center justify-center rounded-full border border-border/60 bg-white/40 hover:bg-muted/50 transition-all cursor-pointer",
                  menuOpen && "bg-muted/80"
                )}
              >
                <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary text-[11px] font-bold">
                  {initials}
                </div>
              </button>
            )}
          </div>
        </aside>

        {/* Menu Popover - Rendered OUTSIDE aside to avoid clipping */}
        {menuOpen && (
          <div
            ref={popoverRef}
            className={cn(
              "fixed z-50 rounded-xl border border-border bg-white p-1.5 shadow-xl backdrop-blur-md flex flex-col gap-0.5 w-52",
              isOpen ? "left-[244px] bottom-6" : "left-[76px] bottom-6"
            )}
          >
            <div className="px-2.5 py-1.5 border-b border-border/40 mb-1">
              <div className="truncate text-[12.5px] font-bold text-foreground">{user.name}</div>
              <div className="truncate text-[10px] text-muted-foreground">{user.email}</div>
            </div>
            <button
              onClick={() => {
                onSelect("resume");
                setMenuOpen(false);
              }}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors"
            >
              <User className="size-4" />
              Resume &amp; Profile
            </button>
            <button
              onClick={() => {
                onSelect("pricing");
                setMenuOpen(false);
              }}
              className="flex items-center justify-between rounded-md px-2.5 py-2 text-left text-[13px] text-primary hover:bg-primary/5 cursor-pointer transition-colors font-semibold"
            >
              <span className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                Product status
              </span>
            </button>
            <button
              onClick={() => {
                onSelect("pricing");
                setMenuOpen(false);
              }}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors"
            >
              <CreditCard className="size-4" />
              Billing
            </button>
            <button
              onClick={() => {
                onSelect("settings");
                setMenuOpen(false);
              }}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors"
            >
              <Settings className="size-4" />
              Settings
            </button>
            <div className="h-px bg-border/40 my-1" />
            <button
              onClick={() => {
                void onSignOut();
                setMenuOpen(false);
              }}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-muted-foreground hover:bg-red-50 hover:text-red-600 cursor-pointer transition-colors"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
