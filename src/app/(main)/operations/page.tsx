import { ExternalLink, Megaphone } from "lucide-react";

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

      <div className="space-y-3 rounded-xl border border-border bg-card-bg px-5 py-4 text-sm">
        <h2 className="font-semibold">路线图</h2>
        <ul className="space-y-1.5 leading-relaxed text-muted">
          <li>M1（当前）：Postiz 统一发布 Facebook / Instagram 矩阵账号</li>
          <li>M2：青砚素材中心，视频 API 自动拉取 + AI 差异化文案 + 一键分发</li>
          <li>M3：统一数据看板 + 小红书半自动流程</li>
          <li>M4：统一客服收件箱</li>
        </ul>
      </div>
    </div>
  );
}
