import Link from "next/link";
import { BarChart3, BookOpen, CalendarDays, Clapperboard, ExternalLink, Megaphone, ShieldCheck, Users } from "lucide-react";

/**
 * 运营模块 M1 — 统一发布入口
 * 发布引擎为自托管 Postiz（部署手册见 deploy/postiz/README.md），
 * 部署完成后在 Vercel 配置 NEXT_PUBLIC_POSTIZ_URL 即启用入口。
 */
const POSTIZ_URL = process.env.NEXT_PUBLIC_POSTIZ_URL;

export default function OperationsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">运营 · 统一发布</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Facebook / Instagram 多账号矩阵的排期发布，由自托管 Postiz 提供。
          在这里统一上传素材、编排发布计划，替代逐平台手动发帖。
        </p>
      </div>

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
              <div className="font-semibold">打开发布日历（Postiz）</div>
              <div className="mt-0.5 text-xs text-muted">
                多账号排期、内容日历、发布状态一站管理
              </div>
            </div>
          </div>
          <ExternalLink className="h-4 w-4 text-muted" />
        </a>
      ) : (
        <div className="space-y-3 rounded-xl border border-border bg-card-bg px-5 py-4 text-sm">
          <h2 className="font-semibold">发布引擎尚未接入</h2>
          <p className="leading-relaxed text-muted">
            Postiz 部署完成后，在部署环境配置{" "}
            <code className="rounded bg-background px-1 text-[11px]">
              NEXT_PUBLIC_POSTIZ_URL
            </code>{" "}
            即可启用本入口。部署步骤见仓库{" "}
            <code className="rounded bg-background px-1 text-[11px]">
              deploy/postiz/README.md
            </code>
            。
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

      <div className="space-y-3 rounded-xl border border-border bg-card-bg px-5 py-4 text-sm">
        <h2 className="font-semibold">路线图</h2>
        <ul className="space-y-1.5 leading-relaxed text-muted">
          <li>M1（完成）：Postiz 统一发布 + 矩阵账号台账 + Aivora 视频管道骨架</li>
          <li>M2（完成）：AI 差异化文案变体 + 规则拦截与抽检审核队列</li>
          <li>M3（完成）：小红书 PostFlow worker 半自动发布 + FFmpeg 视频去重化</li>
          <li>M4（完成）：数据看板 + 运营技能包 22 条（选题 / 笔记 / 评论 / 广告 / 复盘）</li>
          <li>M4.5（完成）：品牌记忆中枢 + AI 品牌预审 + 内容日历选题规划</li>
          <li>M5：Postiz Analytics 互动数据回流 + 技能执行入口接入运营助理</li>
        </ul>
      </div>
    </div>
  );
}
