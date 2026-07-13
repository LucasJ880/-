"use client";

/* eslint-disable @next/next/no-img-element */

import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useLocale } from "@/lib/i18n/context";

/**
 * 左上角品牌区：
 * - 用户有公司归属时显示「青砚 × 公司logo」联合品牌
 * - 否则显示「青砚 Beta」
 */
export function CoBrand({ size = "md" }: { size?: "sm" | "md" }) {
  const { m } = useLocale();
  const { user } = useCurrentUser();
  const company = user?.companies?.[0];

  const nameCls =
    size === "md"
      ? "text-[15px] font-semibold tracking-[0.08em] text-brand-gradient"
      : "text-[14px] font-semibold tracking-[0.06em] text-foreground";

  if (company) {
    const logoSize = size === "md" ? "h-7 w-7" : "h-6 w-6";
    const xCls = size === "md" ? "text-white/35" : "text-foreground/40";
    return (
      <span className="flex items-center gap-2">
        <span className={nameCls}>{m.app_name}</span>
        <span className={`text-[13px] font-light ${xCls}`}>×</span>
        <img
          src={company.logoUrl}
          alt={company.name}
          title={company.name}
          className={`${logoSize} rounded-full object-cover ring-1 ring-white/10`}
        />
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className={nameCls}>{m.app_name}</span>
      <span
        className="ml-0.5 rounded-full border border-[rgba(80,160,140,0.2)] bg-[rgba(43,96,85,0.15)] px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-emerald-300/60"
        title="当前为早期版本，欢迎反馈"
      >
        Beta
      </span>
    </span>
  );
}
