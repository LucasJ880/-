import Link from "next/link";
import { BarChart3, BookOpen, CalendarDays, Clapperboard, ExternalLink, Megaphone, Search, ShieldCheck, TrendingUp, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";

/**
 * 内容运营入口
 */
const POSTIZ_URL = process.env.NEXT_PUBLIC_POSTIZ_URL;

export default function OperationsPage() {
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/operations/growth"
          className="flex items-center gap-3 rounded-xl border border-accent/40 bg-card-bg px-5 py-4 transition-colors hover:border-accent"
        >
          <TrendingUp className="h-5 w-5 shrink-0 text-accent" />
          <div>
            <div className="font-semibold">增长中心</div>
            <div className="mt-0.5 text-xs text-muted">
              企业事实、七维体检、增长任务、推广计划与营销实验闭环
            </div>
          </div>
        </Link>
        <Link
          href="/marketing/employee"
          className="flex items-center gap-3 rounded-xl border border-accent/40 bg-card-bg px-5 py-4 transition-colors hover:border-accent"
        >
          <Megaphone className="h-5 w-5 shrink-0 text-accent" />
          <div>
            <div className="font-semibold">营销数字员工</div>
            <div className="mt-0.5 text-xs text-muted">
              产品档案、客户研究、竞品、文案、邮件与广告规划（副作用须审批）
            </div>
          </div>
        </Link>
        <Link
          href="/operations/intelligence"
          className="flex items-center gap-3 rounded-xl border border-border bg-card-bg px-5 py-4 transition-colors hover:border-accent"
        >
          <Search className="h-5 w-5 shrink-0 text-accent" />
          <div>
            <div className="font-semibold">市场情报</div>
            <div className="mt-0.5 text-xs text-muted">
              调用青砚营销分析，拆解竞品全渠道打法并设计首个增长实验
            </div>
          </div>
        </Link>
        <Link
          href="/operations/matrix"
          className="flex items-center gap-3 rounded-xl border border-border bg-card-bg px-5 py-4 transition-colors hover:border-accent"
        >
          <Users className="h-5 w-5 shrink-0 text-accent" />
          <div>
            <div className="font-semibold">矩阵账号</div>
            <div className="mt-0.5 text-xs text-muted">
              英文社媒 + 小红书账号台账，按账号组管理通道与配额
            </div>
          </div>
        </Link>
        <Link
          href="/operations/assets"
          className="flex items-center gap-3 rounded-xl border border-border bg-card-bg px-5 py-4 transition-colors hover:border-accent"
        >
          <Clapperboard className="h-5 w-5 shrink-0 text-accent" />
          <div>
            <div className="font-semibold">视频资产</div>
            <div className="mt-0.5 text-xs text-muted">
              Aivora 成片自动入库，AI 差异化文案后扇出派发到矩阵账号
            </div>
          </div>
        </Link>
        <Link
          href="/operations/review"
          className="flex items-center gap-3 rounded-xl border border-border bg-card-bg px-5 py-4 transition-colors hover:border-accent"
        >
          <ShieldCheck className="h-5 w-5 shrink-0 text-accent" />
          <div>
            <div className="font-semibold">发布审核队列</div>
            <div className="mt-0.5 text-xs text-muted">
              抽检任务与规则拦截任务在此人工通过或驳回
            </div>
          </div>
        </Link>
        <Link
          href="/operations/dashboard"
          className="flex items-center gap-3 rounded-xl border border-border bg-card-bg px-5 py-4 transition-colors hover:border-accent"
        >
          <BarChart3 className="h-5 w-5 shrink-0 text-accent" />
          <div>
            <div className="font-semibold">数据看板</div>
            <div className="mt-0.5 text-xs text-muted">
              账号健康、发布任务状态与近 14 天发布趋势
            </div>
          </div>
        </Link>
        <Link
          href="/operations/brand"
          className="flex items-center gap-3 rounded-xl border border-border bg-card-bg px-5 py-4 transition-colors hover:border-accent"
        >
          <BookOpen className="h-5 w-5 shrink-0 text-accent" />
          <div>
            <div className="font-semibold">品牌记忆</div>
            <div className="mt-0.5 text-xs text-muted">
              统一品牌语料，文案变体与内容技能自动引用，口径一致
            </div>
          </div>
        </Link>
        <Link
          href="/operations/calendar"
          className="flex items-center gap-3 rounded-xl border border-border bg-card-bg px-5 py-4 transition-colors hover:border-accent"
        >
          <CalendarDays className="h-5 w-5 shrink-0 text-accent" />
          <div>
            <div className="font-semibold">内容日历</div>
            <div className="mt-0.5 text-xs text-muted">
              AI 按品牌记忆批量出选题，审核后关联视频扇出
            </div>
          </div>
        </Link>
      </div>

    </div>
  );
}
