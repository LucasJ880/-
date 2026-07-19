"use client";

import { useCallback, useEffect, useState } from "react";
import { Lightbulb, Loader2 } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";

type Insight = {
  id: string;
  kind: string;
  title: string;
  content: string;
  status: string;
  source: string;
};

export function ProjectInsightsPanel({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const [items, setItems] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiJson<{ insights: Insight[] }>(
        `/api/projects/${projectId}/insights`,
      );
      setItems(res.insights ?? []);
    } catch {
      setItems([]);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, decision: "confirm" | "reject") => {
    setBusyId(id);
    try {
      await apiJson(`/api/projects/${projectId}/insights/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      await load();
    } catch {
      /* ignore */
    }
    setBusyId(null);
  };

  const drafts = items.filter((i) => i.status === "draft");
  const confirmed = items.filter((i) => i.status === "confirmed").slice(0, 8);

  if (loading) return null;
  if (drafts.length === 0 && confirmed.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Lightbulb size={16} className="text-accent/70" />
        项目结论 / Insight
      </h3>

      {drafts.length > 0 ? (
        <div className="mt-3 space-y-2">
          <div className="text-[11px] font-medium text-muted">
            待确认（来自 AI 聊天/分析）
          </div>
          {drafts.map((i) => (
            <div
              key={i.id}
              className="rounded-lg border border-border/60 px-3 py-2 text-[12px]"
            >
              <div className="font-medium">
                [{i.kind}] {i.title}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-muted">
                {i.content.slice(0, 400)}
              </p>
              {canManage ? (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === i.id}
                    onClick={() => void decide(i.id, "confirm")}
                    className="rounded-md bg-accent px-2.5 py-1 text-[11px] text-white disabled:opacity-50"
                  >
                    {busyId === i.id ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      "确认写入记忆"
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === i.id}
                    onClick={() => void decide(i.id, "reject")}
                    className="rounded-md border border-border px-2.5 py-1 text-[11px]"
                  >
                    拒绝
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {confirmed.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          <div className="text-[11px] font-medium text-muted">已确认</div>
          {confirmed.map((i) => (
            <div key={i.id} className="text-[12px]">
              <span className="text-muted">[{i.kind}]</span> {i.title}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
