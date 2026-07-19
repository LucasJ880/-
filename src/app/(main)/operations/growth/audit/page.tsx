"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { DIMENSION_LABELS, MARKETING_DIMENSIONS } from "@/lib/marketing/constants";

type FindingDraft = {
  dimension: string;
  severity: string;
  title: string;
  description: string;
  currentValue: string;
  expectedValue: string;
};

export default function MarketingAuditPage() {
  const [scores, setScores] = useState<Record<string, string>>(
    Object.fromEntries(MARKETING_DIMENSIONS.map((d) => [d, "0"])),
  );
  const [context, setContext] = useState({
    geography: "",
    industry: "",
    product: "",
    competitors: "",
    query: "",
  });
  const [findings, setFindings] = useState<FindingDraft[]>([]);
  const [confidence, setConfidence] = useState(100);
  const [notes, setNotes] = useState<string[]>([]);
  const [proposing, setProposing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function proposeFromIntel() {
    setProposing(true);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch("/api/marketing/audits/propose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "生成建议失败");
      const proposal = body.proposal as {
        contexts: Array<{
          geography: string;
          industry: string;
          product: string;
          competitors: string[];
          query: string;
        }>;
        scores: Array<{ dimension: string; score: number; rationale?: string }>;
        findings: Array<{
          dimension: string;
          severity: string;
          title: string;
          description?: string;
          currentValue?: string | null;
          expectedValue?: string | null;
        }>;
        confidence: number;
        notes: string[];
        signalCount: number;
      };
      const ctx = proposal.contexts[0];
      if (ctx) {
        setContext({
          geography: ctx.geography || "",
          industry: ctx.industry || "",
          product: ctx.product || "",
          competitors: (ctx.competitors || []).join(", "),
          query: ctx.query || "",
        });
      }
      const nextScores = { ...scores };
      for (const row of proposal.scores) {
        nextScores[row.dimension] = String(row.score);
      }
      setScores(nextScores);
      setFindings(
        (proposal.findings || []).map((f) => ({
          dimension: f.dimension,
          severity: f.severity,
          title: f.title,
          description: f.description || "",
          currentValue: f.currentValue || "",
          expectedValue: f.expectedValue || "",
        })),
      );
      setConfidence(proposal.confidence ?? 70);
      setNotes(proposal.notes || []);
      setMessage(
        `已根据近 30 天 ${proposal.signalCount} 条情报生成建议分，请人工校准后再保存（不会自动记分）。`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成建议失败");
    } finally {
      setProposing(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const response = await apiFetch("/api/marketing/audits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: notes.length > 0 ? "assisted" : "manual",
        confidence,
        contexts: [
          {
            ...context,
            competitors: context.competitors.split(/\n|,/).map((s) => s.trim()).filter(Boolean),
          },
        ],
        scores: MARKETING_DIMENSIONS.map((d) => ({
          dimension: d,
          score: Number(scores[d]),
          confidence,
        })),
        findings: findings.filter((f) => f.title.trim()),
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      return setError(
        `${body.error || "保存失败"}${
          body.issues?.length
            ? `：${body.issues.map((i: { message: string }) => i.message).join("；")}`
            : ""
        }`,
      );
    }
    setMessage(`体检已保存，总分 ${body.audit.totalScore}/100`);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/operations/growth" className="text-sm text-accent">
            ← 返回增长中心
          </Link>
          <h1 className="mt-2 text-2xl font-bold">营销体检</h1>
          <p className="mt-1 text-sm text-muted">
            可先从市场情报生成建议分，再人工校准保存。上下文必须通过企业事实校验，否则整次检测无效。
          </p>
        </div>
        <button
          type="button"
          onClick={proposeFromIntel}
          disabled={proposing}
          className="inline-flex items-center gap-2 rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-900 hover:bg-violet-100 disabled:opacity-50"
        >
          {proposing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          从情报生成建议
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </div>
      )}
      {notes.length > 0 && (
        <ul className="list-disc space-y-1 rounded-lg border border-border bg-card-bg px-5 py-3 text-xs text-muted">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="space-y-5">
        <section className="rounded-xl border border-border bg-card-bg p-5">
          <h2 className="font-semibold">检测上下文</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(
              [
                ["geography", "地域"],
                ["industry", "行业"],
                ["product", "产品"],
                ["competitors", "竞争对手（逗号分隔）"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="text-sm">
                <span className="mb-1 block text-muted">{l}</span>
                <input
                  value={context[k]}
                  onChange={(e) => setContext({ ...context, [k]: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2"
                />
              </label>
            ))}
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-muted">测试问题/查询</span>
              <textarea
                value={context.query}
                onChange={(e) => setContext({ ...context, query: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
                rows={3}
              />
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card-bg p-5">
          <h2 className="font-semibold">七维评分</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {MARKETING_DIMENSIONS.map((d) => (
              <label key={d} className="text-xs">
                <span className="mb-1 block text-muted">{DIMENSION_LABELS[d]}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={scores[d]}
                  onChange={(e) => setScores({ ...scores, [d]: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-base"
                />
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card-bg p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">发现问题（可编辑）</h2>
            <button
              type="button"
              className="text-xs text-accent"
              onClick={() =>
                setFindings((prev) => [
                  ...prev,
                  {
                    dimension: "SEO",
                    severity: "medium",
                    title: "",
                    description: "",
                    currentValue: "",
                    expectedValue: "",
                  },
                ])
              }
            >
              + 添加
            </button>
          </div>
          {findings.length === 0 ? (
            <p className="mt-3 text-sm text-muted">暂无问题条目。可点「从情报生成建议」或手动添加。</p>
          ) : (
            <div className="mt-3 space-y-4">
              {findings.map((finding, index) => (
                <div key={index} className="grid gap-3 rounded-lg bg-background p-3 sm:grid-cols-2">
                  <select
                    value={finding.dimension}
                    onChange={(e) => {
                      const next = [...findings];
                      next[index] = { ...finding, dimension: e.target.value };
                      setFindings(next);
                    }}
                    className="rounded-lg border border-border bg-card-bg px-3 py-2 text-sm"
                  >
                    {MARKETING_DIMENSIONS.map((d) => (
                      <option key={d} value={d}>
                        {DIMENSION_LABELS[d]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={finding.severity}
                    onChange={(e) => {
                      const next = [...findings];
                      next[index] = { ...finding, severity: e.target.value };
                      setFindings(next);
                    }}
                    className="rounded-lg border border-border bg-card-bg px-3 py-2 text-sm"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                  <input
                    placeholder="问题标题"
                    value={finding.title}
                    onChange={(e) => {
                      const next = [...findings];
                      next[index] = { ...finding, title: e.target.value };
                      setFindings(next);
                    }}
                    className="rounded-lg border border-border bg-card-bg px-3 py-2 text-sm sm:col-span-2"
                  />
                  <textarea
                    placeholder="问题说明"
                    value={finding.description}
                    onChange={(e) => {
                      const next = [...findings];
                      next[index] = { ...finding, description: e.target.value };
                      setFindings(next);
                    }}
                    className="rounded-lg border border-border bg-card-bg px-3 py-2 text-sm sm:col-span-2"
                    rows={2}
                  />
                </div>
              ))}
            </div>
          )}
        </section>

        <button className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white">
          保存可信体检
        </button>
      </form>
    </div>
  );
}
