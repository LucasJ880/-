import { redirect } from "next/navigation";
import { buildHelpMap, buildHelpTasks } from "@/lib/navigation/help-map";
import { loadPageNavigationContext } from "@/lib/navigation/page-context-server";
import { HelpEntryName } from "./entry-name";

/**
 * 使用说明（VIS-1b：从当前用户侧栏可见的导航生成；NAV-1b：先指路再列全部入口）
 * spec navigation/entry-visibility：
 *   - 「我想做什么」：每行绑定一个入口，入口不可见的行不出现，一行都没有时整节不出现；
 *   - 「全部入口」：分段与顺序同该用户的侧栏（两段式用户先「常用」再「更多」里的各分组）；
 *   - 入口名称经 HelpEntryName 按当前界面语言取，与侧栏同名（NAV-1a，spec navigation/entry-naming）。
 * 侧栏看不到的入口不在这里出现。
 */
export default async function HelpPage() {
  const ctx = await loadPageNavigationContext();
  if (!ctx) redirect("/login");
  const groups = buildHelpMap(ctx);
  const tasks = buildHelpTasks(ctx);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">使用说明</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {tasks.length > 0 ? "先看『我想做什么』；找不到再看下面的全部入口。" : "你在侧栏能看到的全部入口，以及每个入口是做什么的。"}
        </p>
      </div>

      {tasks.length > 0 && (
        <section className="space-y-3" aria-labelledby="help-tasks-heading">
          <h2 id="help-tasks-heading" className="text-base font-semibold">
            我想做什么
          </h2>
          <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
            <div className="hidden border-b border-border bg-background/50 px-4 py-2 text-xs font-medium text-muted sm:grid sm:grid-cols-[minmax(0,5fr)_minmax(0,3fr)_minmax(0,8fr)] sm:gap-4">
              <span>我想…</span>
              <span>点哪里</span>
              <span>进去后</span>
            </div>
            <ul className="divide-y divide-border/80">
              {tasks.map((t) => (
                <li
                  key={`${t.entryKey}:${t.want}`}
                  className="flex flex-col gap-1 px-4 py-2.5 text-sm sm:grid sm:grid-cols-[minmax(0,5fr)_minmax(0,3fr)_minmax(0,8fr)] sm:items-baseline sm:gap-4"
                >
                  <span className="font-medium">{t.want}</span>
                  <span className="font-medium">
                    <HelpEntryName label={t.entry.label} labelKey={t.entry.labelKey} href={t.entry.href} />
                  </span>
                  <span className="text-muted">{t.then}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="space-y-3" aria-labelledby="help-all-heading">
        <h2 id="help-all-heading" className="text-base font-semibold">
          全部入口
        </h2>
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.group} className="overflow-hidden rounded-xl border border-border bg-card-bg">
              <h3 className="border-b border-border bg-background/50 px-4 py-2 text-xs font-medium text-muted">
                {g.section === "more" ? `更多 · ${g.label}` : g.label}
              </h3>
              <ul className="divide-y divide-border/80">
                {g.entries.map((e) => (
                  <li key={e.key} className="flex flex-col gap-0.5 px-4 py-2.5 text-sm sm:flex-row sm:items-baseline sm:gap-4">
                    <span className={e.depth > 0 ? "shrink-0 pl-4 font-medium sm:w-40" : "shrink-0 font-medium sm:w-40"}>
                      <HelpEntryName label={e.label} labelKey={e.labelKey} href={e.href} />
                    </span>
                    <span className="text-muted">{e.description}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
