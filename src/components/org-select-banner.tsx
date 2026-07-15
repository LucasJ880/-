"use client";

/**
 * 多组织未选定「当前组织」时的内联选择横幅。
 *
 * 用户点选后写入本地记忆（persistSelectedOrgId），apiFetch 会自动为
 * sales / trade 域请求附加 orgId，页面数据随之恢复，无需跳转组织页。
 */

import { Building2 } from "lucide-react";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { persistSelectedOrgId } from "@/lib/org-selection";
import { cn } from "@/lib/utils";

export function OrgSelectBanner({
  onSelected,
  variant = "default",
}: {
  onSelected?: () => void;
  variant?: "default" | "assistant";
}) {
  const { ambiguous, loading, organizations } = useCurrentOrgId();

  if (loading || !ambiguous) return null;

  const assistant = variant === "assistant";

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5",
        assistant
          ? "border-black/[0.07] bg-[#f6f7f7]"
          : "border-amber-300 bg-amber-50",
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 text-xs font-medium",
            assistant ? "text-[#323735]" : "text-amber-900",
          )}
        >
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md",
              assistant ? "bg-white text-[#2b6055] shadow-xs" : "",
            )}
          >
            <Building2 size={13} />
          </span>
          选择本次工作的组织
        </div>
        <div className="flex flex-wrap gap-1.5 sm:ml-auto">
          {organizations.map((org) => (
            <button
              key={org.id}
              type="button"
              onClick={() => {
                persistSelectedOrgId(org.id);
                // 页面数据大多在初始加载时已带错误返回，默认整页刷新兜底
                if (onSelected) onSelected();
                else window.location.reload();
              }}
              className={cn(
                "min-h-8 rounded-md border bg-white px-3 py-1 text-xs font-medium transition-colors",
                assistant
                  ? "border-black/10 text-[#252927] hover:border-[#2b6055]/30 hover:bg-[#edf3f1] hover:text-[#2b6055]"
                  : "border-amber-400/60 text-amber-900 hover:bg-amber-100",
              )}
            >
              {org.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
