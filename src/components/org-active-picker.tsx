"use client";

import { Building2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type OrgActiveOption = {
  id: string;
  name: string;
  code: string;
  myRole?: string | null;
  memberCount?: number;
  projectCount?: number;
};

export function OrgActivePicker({
  organizations,
  selectedId,
  busyId,
  onSelect,
  title = "选择当前工作组织",
  description = "选定后将作为默认组织，登出再登录也会沿用，直到你在侧栏更换。",
  className,
}: {
  organizations: OrgActiveOption[];
  selectedId?: string | null;
  busyId?: string | null;
  onSelect: (orgId: string) => void;
  title?: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)}>
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <Building2 size={22} />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1.5 text-sm text-muted">{description}</p>
      </div>
      <div className="max-h-[min(360px,50vh)] space-y-2 overflow-y-auto">
        {organizations.map((org) => {
          const busy = busyId === org.id;
          const selected = selectedId === org.id;
          return (
            <button
              key={org.id}
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => onSelect(org.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
                selected
                  ? "border-accent/40 bg-accent/5"
                  : "border-border bg-card-bg hover:border-accent/30 hover:bg-accent/[0.03]",
                busyId && !busy && "opacity-50"
              )}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-sm font-bold text-accent">
                {org.name[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {org.name}
                </p>
                <p className="truncate text-xs text-muted">
                  {org.code}
                  {typeof org.memberCount === "number"
                    ? ` · ${org.memberCount} 人`
                    : ""}
                  {typeof org.projectCount === "number"
                    ? ` · ${org.projectCount} 项目`
                    : ""}
                </p>
              </div>
              {busy ? (
                <Loader2 size={16} className="shrink-0 animate-spin text-accent" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
