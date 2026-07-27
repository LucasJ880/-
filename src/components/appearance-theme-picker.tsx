"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  UI_THEME_DESCRIPTIONS,
  UI_THEME_LABELS,
  UI_THEMES,
  useUiTheme,
  type UiTheme,
} from "@/lib/theme";

function ThemePreview({ theme }: { theme: UiTheme }) {
  const isGlass = theme === "glass";
  return (
    <div
      className={cn(
        "relative h-24 overflow-hidden rounded-lg border",
        isGlass
          ? "border-white/10 bg-[#0c1210]"
          : "border-border bg-[#f2f0eb]",
      )}
    >
      <div
        className={cn(
          "absolute inset-y-2 left-2 w-6 rounded-md",
          isGlass ? "bg-[#121a18]" : "bg-[#111b1d]",
        )}
      />
      <div
        className={cn(
          "absolute inset-y-3 right-3 left-10 rounded-md border p-2",
          isGlass
            ? "border-white/10 bg-white/[0.06] backdrop-blur-sm"
            : "border-[rgba(26,36,32,0.08)] bg-[#faf8f4]",
        )}
      >
        <div
          className={cn(
            "mb-1.5 h-2 w-10 rounded-full",
            isGlass ? "bg-[#3dff9a]/70" : "bg-[#2b6055]/70",
          )}
        />
        <div
          className={cn(
            "h-1.5 w-16 rounded-full",
            isGlass ? "bg-white/20" : "bg-[rgba(26,36,32,0.12)]",
          )}
        />
        <div
          className={cn(
            "mt-1 h-1.5 w-12 rounded-full",
            isGlass ? "bg-white/10" : "bg-[rgba(26,36,32,0.08)]",
          )}
        />
      </div>
    </div>
  );
}

export function AppearanceThemePicker() {
  const { theme, setTheme } = useUiTheme();

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {UI_THEMES.map((option) => {
        const selected = theme === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => setTheme(option)}
            className={cn(
              "rounded-xl border p-3 text-left transition-colors",
              selected
                ? "border-accent bg-accent-soft ring-1 ring-accent/30"
                : "border-border bg-card-bg hover:border-border-strong",
            )}
          >
            <ThemePreview theme={option} />
            <div className="mt-3 flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {UI_THEME_LABELS[option]}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {UI_THEME_DESCRIPTIONS[option]}
                </p>
              </div>
              {selected ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[color:var(--on-accent)]">
                  <Check size={12} strokeWidth={2.5} />
                </span>
              ) : (
                <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border border-border" />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
