"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookMarked, ExternalLink, Loader2 } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";

type Rule = {
  id: string;
  title: string;
  content: string;
  category: string;
  status: string;
};

const STATUS_LABEL: Record<string, string> = {
  proposed: "待确认",
  active: "已生效",
  rejected: "已拒绝",
  archived: "已归档",
};

export function ProjectOrgRulesCard({
  projectId,
  refreshKey = 0,
}: {
  projectId: string;
  /** 外部变更（如复盘刚确认）时递增以重新拉取 */
  refreshKey?: number;
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [canDecide, setCanDecide] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiJson<{
        rules: Rule[];
        canDecide?: boolean;
      }>(`/api/projects/${projectId}/org-rules`);
      setRules(res.rules ?? []);
      setCanDecide(!!res.canDecide);
    } catch {
      setRules([]);
      setCanDecide(false);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load, refreshKey]);

  const decide = async (ruleId: string, decision: "activate" | "reject") => {
    setBusyId(ruleId);
    try {
      await apiJson(`/api/projects/${projectId}/org-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decide", ruleId, decision }),
      });
      await load();
    } catch {
      /* ignore */
    }
    setBusyId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card-bg px-5 py-4 text-xs text-muted">
        <Loader2 size={14} className="animate-spin" />
        加载本项目规则…
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card-bg/60 px-5 py-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <BookMarked size={16} className="text-accent/70" />
          本项目提出的规则
        </h3>
        <p className="mt-2 text-[12px] text-muted">
          确认复盘后，系统会按原因标签提出企业规则草案。暂无来自本项目的规则。
        </p>
        <Link
          href="/projects/intelligence"
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
        >
          打开项目智能中心
          <ExternalLink size={11} />
        </Link>
      </div>
    );
  }

  const proposed = rules.filter((r) => r.status === "proposed");
  const others = rules.filter((r) => r.status !== "proposed");

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <BookMarked size={16} className="text-accent/70" />
          本项目提出的规则
          <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] font-normal">
            {rules.length}
          </span>
        </h3>
        <Link
          href="/projects/intelligence"
          className="inline-flex shrink-0 items-center gap-1 text-[11px] text-accent hover:underline"
        >
          智能中心
          <ExternalLink size={11} />
        </Link>
      </div>
      <p className="mt-1 text-[11px] text-muted">
        草案需组织管理员确认后，才会作为企业生效规则注入其他项目 AI 上下文。
      </p>

      {proposed.length > 0 ? (
        <div className="mt-3 space-y-2">
          <div className="text-[11px] font-medium text-muted">待确认草案</div>
          {proposed.map((r) => (
            <div
              key={r.id}
              className="rounded-lg border border-border/60 px-3 py-2 text-[12px]"
            >
              <div className="font-medium">
                <span className="text-muted">[{r.category}]</span> {r.title}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-muted">
                {r.content.slice(0, 280)}
                {r.content.length > 280 ? "…" : ""}
              </p>
              {canDecide ? (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void decide(r.id, "activate")}
                    className="rounded-md bg-accent px-2.5 py-1 text-[11px] text-white disabled:opacity-50"
                  >
                    确认为生效规则
                  </button>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void decide(r.id, "reject")}
                    className="rounded-md border border-border px-2.5 py-1 text-[11px] disabled:opacity-50"
                  >
                    拒绝
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-muted">
                  需组织管理员在此页或智能中心确认。
                </p>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {others.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-[12px]">
          {others.map((r) => (
            <li
              key={r.id}
              className="rounded border border-border/50 px-2.5 py-1.5"
            >
              <span className="text-muted">
                [{STATUS_LABEL[r.status] || r.status}] [{r.category}]
              </span>{" "}
              {r.title}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
