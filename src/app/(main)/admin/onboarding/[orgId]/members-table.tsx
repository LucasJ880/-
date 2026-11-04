import { CheckCircle2 } from "lucide-react";
import type { OnboardingStatus as Status } from "@/lib/organizations/onboarding";
import { orgRoleLabel, platformRoleLabel } from "@/lib/permissions-client";

/**
 * 组织开通详情页的成员表（从 page.tsx 拆出，openspec change hide-wechat-entry / COLLAB-1）。
 * showWechat=false（微信入口开关关闭）时不渲染"微信"列；为 true 时与改动前相同。
 */
export function MembersTable({ members, showWechat }: { members: Status["members"]; showWechat: boolean }) {
  if (!members.length) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[520px] text-xs">
        <thead className="bg-background/60 text-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">成员</th>
            <th className="px-3 py-2 text-left font-medium">平台角色</th>
            <th className="px-3 py-2 text-left font-medium">企业角色</th>
            {showWechat && <th className="px-3 py-2 text-left font-medium">微信</th>}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId} className="border-t border-border/60">
              <td className="px-3 py-2">
                {m.name}
                <span className="ml-2 text-muted">{m.email}</span>
              </td>
              <td className="px-3 py-2">{platformRoleLabel(m.platformRole)}</td>
              <td className="px-3 py-2">{orgRoleLabel(m.orgRole)}</td>
              {showWechat && (
                <td className="px-3 py-2">
                  {m.wechatBound ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 size={12} /> 已绑定
                    </span>
                  ) : (
                    <span className="text-muted">未绑定</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
