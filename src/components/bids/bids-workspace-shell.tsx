"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";

type LoadState = "loading" | "ready" | "error" | "empty";

type ProjectSummary = {
  id: string;
  name: string;
  tenderStatus?: string | null;
  status?: string | null;
  updatedAt?: string;
};

const LINKS: Array<{ href: string; title: string; description: string }> = [
  {
    href: "/projects",
    title: "正在准备的项目",
    description: "查看投标项目列表与详情",
  },
  {
    href: "/projects/intelligence",
    title: "招标机会 / Intelligence",
    description: "项目智能与机会洞察",
  },
  {
    href: "/projects",
    title: "需求与合规",
    description: "在项目详情中继续处理需求与合规材料",
  },
  {
    href: "/suppliers",
    title: "厂家 / 供应商资料",
    description: "供应商与厂家协同资料",
  },
  {
    href: "/capabilities/approvals",
    title: "AI 审批 / 运行",
    description: "审批中心与能力运行入口",
  },
];

export function BidsWorkspaceShell() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const res = await apiFetch("/api/projects?take=6");
      if (!res.ok) throw new Error(`projects ${res.status}`);
      const data = (await res.json()) as
        | { items?: ProjectSummary[]; projects?: ProjectSummary[] }
        | ProjectSummary[];
      const list = Array.isArray(data)
        ? data
        : (data.items ?? data.projects ?? []);
      setProjects(list.slice(0, 6));
      setLoadState(list.length === 0 ? "empty" : "ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 md:px-6">
      <header className="space-y-2">
        <p className="text-[12px] font-medium tracking-wide text-[var(--muted)]">
          招投标中心
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
          投标工作区入口
        </h1>
        <p className="max-w-xl text-[14px] leading-relaxed text-[var(--muted)]">
          汇总现有投标项目、机会洞察与审批入口。本阶段不迁移
          `/projects`，深层链接与核心投标流程保持不变。
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        {LINKS.map((item) => (
          <Link
            key={`${item.href}-${item.title}`}
            href={item.href}
            className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] px-4 py-4 transition-colors hover:bg-[var(--background)]"
          >
            <p className="text-[15px] font-medium">{item.title}</p>
            <p className="mt-1 text-[13px] text-[var(--muted)]">
              {item.description}
            </p>
          </Link>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-medium">最近投标项目</h2>
          <Link
            href="/projects"
            className="text-[13px] text-[var(--accent)] hover:underline"
          >
            全部项目
          </Link>
        </div>

        {loadState === "loading" && (
          <p className="text-[14px] text-[var(--muted)]">正在加载项目摘要…</p>
        )}

        {loadState === "error" && (
          <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/80 px-4 py-4">
            <p className="text-[14px] text-red-800">项目摘要暂时无法加载。</p>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[13px] text-[var(--on-accent)]"
            >
              重新加载
            </button>
          </div>
        )}

        {loadState === "empty" && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] px-4 py-6">
            <p className="text-[14px]">当前没有可展示的投标项目。</p>
            <p className="mt-2 text-[13px] text-[var(--muted)]">
              可从「正在准备的项目」进入现有项目列表创建或继续处理。
            </p>
          </div>
        )}

        {loadState === "ready" && (
          <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--card-bg)]">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-[13px] hover:bg-[var(--background)]"
                >
                  <span className="font-medium">
                    {p.name || "未命名项目"}
                  </span>
                  <span className="shrink-0 text-[var(--muted)]">
                    {p.tenderStatus || p.status || "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
