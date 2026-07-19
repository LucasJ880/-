"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";

type Review = {
  id: string;
  status: string;
  outcome: string | null;
  narrative: string | null;
  reasonTagsJson: string | null;
  priceAnalysisJson: string | null;
};

export function ProjectReviewCard({
  projectId,
  onConfirmed,
}: {
  projectId: string;
  /** 复盘确认后回调（例如刷新本项目提出的企业规则） */
  onConfirmed?: () => void;
}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiJson<{ reviews: Review[] }>(
        `/api/projects/${projectId}/reviews`,
      );
      setReviews(res.reviews ?? []);
    } catch {
      setReviews([]);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const draft = reviews.find((r) => r.status === "draft");
  const confirmed = reviews.find((r) => r.status === "confirmed");

  const confirm = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await apiJson(`/api/projects/${projectId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", reviewId: draft.id }),
      });
      await load();
      onConfirmed?.();
    } catch {
      /* ignore */
    }
    setBusy(false);
  };

  if (loading) return null;
  if (!draft && !confirmed) return null;

  const show = draft || confirmed;
  let tags: string[] = [];
  let priceLines: string[] = [];
  try {
    tags = JSON.parse(show!.reasonTagsJson || "[]") as string[];
  } catch {
    tags = [];
  }
  try {
    const p = JSON.parse(show!.priceAnalysisJson || "null") as {
      summaryLines?: string[];
    } | null;
    priceLines = p?.summaryLines ?? [];
  } catch {
    priceLines = [];
  }

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <ClipboardCheck size={16} className="text-accent/70" />
        项目复盘
        <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px]">
          {show!.status === "draft" ? "待确认草稿" : "已确认"}
        </span>
      </h3>
      <p className="mt-2 text-[12px] text-muted">
        结果：{show!.outcome || "—"}
      </p>
      {priceLines.length ? (
        <pre className="mt-2 whitespace-pre-wrap rounded bg-muted/20 p-2 text-[11px]">
          {priceLines.join("\n")}
        </pre>
      ) : null}
      {tags.length ? (
        <p className="mt-2 text-[12px]">原因标签：{tags.join("、")}</p>
      ) : null}
      {show!.narrative ? (
        <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed">
          {show!.narrative}
        </p>
      ) : null}
      {draft ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void confirm()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : null}
          确认写入企业记忆
        </button>
      ) : (
        <p className="mt-2 text-[10px] text-muted">
          已确认，后续相似项目可检索到本复盘经验。
        </p>
      )}
    </div>
  );
}
