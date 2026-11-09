import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink, Megaphone } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { visibleOperationsCards } from "@/lib/navigation/operations-index";
import { loadPageNavigationContext } from "@/lib/navigation/page-context-server";

/**
 * 内容运营入口
 * VIS-1b：卡片逐张按路由门判定，只列对当前用户放行的（平台 super_admin 全部显示）；一张都没有时显示空态
 * （spec navigation/entry-visibility「/operations 索引只列放行的卡片」）。
 */
const POSTIZ_URL = process.env.NEXT_PUBLIC_POSTIZ_URL;

export default async function OperationsPage() {
  const ctx = await loadPageNavigationContext();
  if (!ctx) redirect("/login");
  const cards = visibleOperationsCards(ctx);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title="内容运营"
        description="统一管理市场情报、品牌资产、内容计划、审核与多渠道发布。"
      />

      {POSTIZ_URL ? (
        <a
          href={POSTIZ_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between rounded-xl border border-border bg-card-bg px-5 py-4 transition-colors hover:border-accent"
        >
          <div className="flex items-center gap-3">
            <Megaphone className="h-5 w-5 text-accent" />
            <div>
              <div className="font-semibold">发布排期</div>
              <div className="mt-0.5 text-xs text-muted">
                多账号排期、内容日历、发布状态一站管理
              </div>
            </div>
          </div>
          <ExternalLink className="h-4 w-4 text-muted" />
        </a>
      ) : (
        <div className="space-y-3 rounded-xl border border-border bg-card-bg px-5 py-4 text-sm">
          <h2 className="font-semibold">发布服务暂不可用</h2>
          <p className="leading-relaxed text-muted">
            当前仍可使用市场情报、品牌记忆、内容日历和审核队列。发布排期恢复后会自动出现在这里。
          </p>
        </div>
      )}

      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card-bg px-5 py-8 text-center text-sm text-muted">
          暂无可用的运营入口
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className={`flex items-center gap-3 rounded-xl border ${card.highlight ? "border-accent/40" : "border-border"} bg-card-bg px-5 py-4 transition-colors hover:border-accent`}
            >
              <card.icon className="h-5 w-5 shrink-0 text-accent" />
              <div>
                <div className="font-semibold">{card.title}</div>
                <div className="mt-0.5 text-xs text-muted">{card.description}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
