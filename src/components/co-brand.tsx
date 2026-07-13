"use client";

/* eslint-disable @next/next/no-img-element */

import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useLocale } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

const QINGYAN_LOGO = "/icons/icon-192x192.png";

/**
 * 品牌区：青砚 logo +「青砚」+ 可选「× 公司 logo」
 * - collapsed：侧栏收起时只显示图标
 * - variant：sidebar 深色底 / header 浅色底
 */
export function CoBrand({
  size = "md",
  collapsed = false,
  variant = "sidebar",
}: {
  size?: "sm" | "md";
  collapsed?: boolean;
  variant?: "sidebar" | "header";
}) {
  const { m } = useLocale();
  const { user } = useCurrentUser();
  const company = user?.companies?.[0];

  const isSidebar = variant === "sidebar";
  const nameCls = cn(
    "font-semibold tracking-[0.08em] shrink-0",
    size === "md" ? "text-[15px]" : "text-[14px]",
    isSidebar ? "text-brand-gradient" : "text-foreground",
  );
  const xCls = isSidebar ? "text-white/35" : "text-foreground/40";
  const iconSize = collapsed ? "h-8 w-8" : size === "md" ? "h-7 w-7" : "h-6 w-6";
  const companyLogoCls = cn(
    "shrink-0 object-contain",
    collapsed ? "h-5 w-5" : size === "md" ? "h-7 max-w-[80px]" : "h-6 max-w-[64px]",
    isSidebar ? "rounded-md bg-white/5 p-0.5" : "rounded-md",
  );

  if (collapsed) {
    return (
      <span
        className="flex flex-col items-center gap-1"
        title={company ? `${m.app_name} × ${company.name}` : m.app_name}
      >
        <img
          src={QINGYAN_LOGO}
          alt={m.app_name}
          className={`${iconSize} rounded-lg object-cover`}
        />
        {company && (
          <img
            src={company.logoUrl}
            alt={company.name}
            className={companyLogoCls}
          />
        )}
      </span>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      <img
        src={QINGYAN_LOGO}
        alt={m.app_name}
        className={`${iconSize} shrink-0 rounded-lg object-cover`}
      />
      <span className={nameCls}>{m.app_name}</span>
      {company && (
        <>
          <span className={cn("text-[13px] font-light shrink-0", xCls)}>×</span>
          <img
            src={company.logoUrl}
            alt={company.name}
            title={company.name}
            className={companyLogoCls}
          />
        </>
      )}
    </span>
  );
}
