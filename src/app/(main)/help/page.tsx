import Link from "next/link";
import { redirect } from "next/navigation";
import { buildHelpMap } from "@/lib/navigation/help-map";
import { loadPageNavigationContext } from "@/lib/navigation/page-context-server";

/**
 * 使用说明 · 功能地图（VIS-1b：从当前用户侧栏可见的导航树生成，spec navigation/entry-visibility）
 * 名称与一句说明取自导航注册表；侧栏看不到的入口不在这里出现。
 */
export default async function HelpPage() {
  const ctx = await loadPageNavigationContext();
  if (!ctx) redirect("/login");
  const groups = buildHelpMap(ctx);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">使用说明 · 功能地图</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">你在侧栏能看到的全部入口，以及每个入口是做什么的。</p>
      </div>

      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.group} className="overflow-hidden rounded-xl border border-border bg-card-bg">
            <h2 className="border-b border-border bg-background/50 px-4 py-2 text-xs font-medium text-muted">{g.label}</h2>
            <ul className="divide-y divide-border/80">
              {g.entries.map((e) => (
                <li key={e.key} className="flex flex-col gap-0.5 px-4 py-2.5 text-sm sm:flex-row sm:items-baseline sm:gap-4">
                  <span className={e.depth > 0 ? "shrink-0 pl-4 font-medium sm:w-40" : "shrink-0 font-medium sm:w-40"}>
                    {e.href ? (
                      <Link href={e.href} className="text-accent hover:underline">
                        {e.label}
                      </Link>
                    ) : (
                      e.label
                    )}
                  </span>
                  <span className="text-muted">{e.description}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
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
