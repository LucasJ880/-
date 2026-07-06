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

export function OrgSelectBanner({ onSelected }: { onSelected?: () => void }) {
  const { ambiguous, loading, organizations } = useCurrentOrgId();

  if (loading || !ambiguous) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
        <Building2 size={13} />
        您属于多个组织，请先选择当前要操作的组织：
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
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
            className="rounded-md border border-amber-400/60 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100"
          >
            {org.name}
          </button>
        ))}
      </div>
    </div>
  );
}
