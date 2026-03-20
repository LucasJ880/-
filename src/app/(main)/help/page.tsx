import Link from "next/link";

const ROUTES = [
  { path: "/", label: "工作台", note: "统计、本周进度、日程、任务片段、快捷入口" },
  { path: "/inbox", label: "收件箱", note: "快速捕获：单条输入 → AI 解析 → 创建任务/日程" },
  { path: "/tasks", label: "任务", note: "列表、筛选、详情与评论/活动" },
  { path: "/organizations", label: "组织", note: "数据隔离边界；新建项目前需有所属组织" },
  { path: "/projects", label: "项目", note: "卡片列表与详情（成员、环境、Prompt、知识库入口）" },
  { path: "/assistant", label: "AI 助手", note: "多轮对话与上下文，适合规划与讨论" },
  { path: "/blinds-orders", label: "工艺单", note: "百叶窗订单（行业模块）" },
  { path: "/settings", label: "设置", note: "Google 日历 OAuth 连接与说明" },
  { path: "/help", label: "本页", note: "功能地图与关系说明" },
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">使用说明 · 功能地图</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          与{" "}
          <code className="rounded bg-background px-1 text-[11px]">docs/PROJECT_AUDIT.md</code>{" "}
          对齐的一页速查；完整 API 与数据模型亦见该文档。
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-background/50 text-xs text-muted">
              <th className="px-4 py-2 font-medium">路径</th>
              <th className="px-4 py-2 font-medium">名称</th>
              <th className="px-4 py-2 font-medium">说明</th>
            </tr>
          </thead>
          <tbody>
            {ROUTES.map((r) => (
              <tr key={r.path} className="border-b border-border/80 last:border-0">
                <td className="px-4 py-2.5 font-mono text-xs">
                  <Link href={r.path} className="text-accent hover:underline">
                    {r.path}
                  </Link>
                </td>
                <td className="px-4 py-2.5 font-medium">{r.label}</td>
                <td className="px-4 py-2.5 text-muted">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card-bg px-5 py-4 text-sm">
        <h2 className="font-semibold">组织与项目</h2>
        <p className="leading-relaxed text-muted">
          <strong className="text-foreground">组织</strong>是一级边界：成员与配额在此管理。
          <strong className="text-foreground">项目</strong>归属在组织下，承载任务、环境、Prompt 与知识库。
          新建项目前请先在「组织」中创建或加入组织。
        </p>
      </div>

      <div className="space-y-2 text-sm text-muted">
        <p>
          <span className="font-medium text-foreground">部署：</span>
          见仓库内{" "}
          <code className="rounded bg-background px-1 text-[11px]">docs/DEPLOY_VERCEL.md</code>
        </p>
        <p>
          <span className="font-medium text-foreground">发布前手工回归：</span>
          <code className="rounded bg-background px-1 text-[11px]">docs/QA_P0_CHECKLIST.md</code>
        </p>
      </div>
    </div>
  );
}
