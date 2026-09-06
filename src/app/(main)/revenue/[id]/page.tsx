"use client";

/**
 * Revenue Opportunity 详情：RFQ + 证据 + 评分解释 + 缺失信息 + 回复草稿审批 + 阶段流转 + 结果 + Agent Run 轨迹
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Play, Check, X, Send } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { getOpportunityStageLabel } from "@/lib/revenue-spine/opportunity-stage";
import { RFQ_FIELD_LABELS, type RfqField } from "@/lib/revenue-spine/rfq/types";

type Json = Record<string, unknown>;

interface Detail {
  opportunity: Json & {
    id: string;
    title: string;
    stage: string;
    score: number | null;
    scoreGrade: string | null;
    estimatedValue: number | null;
    market: string | null;
    buyerType: string | null;
    nextActionType: string | null;
    nextFollowupAt: string | null;
    nextActionReason: string | null;
    fdeSourced: boolean;
    fdeInfluenced: boolean;
    customer: { id: string; name: string; email: string | null; phone: string | null; contactName: string | null; country: string | null };
    rfq: (Json & { status: string; missingFields: string[] | null; evidence: Array<{ id: string; field: string; value: string | null; confidence: number; evidenceText: string | null; extractedBy: string; sourceInteractionId: string | null }> }) | null;
    assessments: Array<{ id: string; score: number; grade: string; reasoning: string; dimensionsJson: Array<{ label: string; score: number; max: number; reason: string }>; recommendedNextAction: string | null; createdAt: string }>;
    salesActions: Array<{ id: string; title: string; status: string; actionType: string | null; priority: string; dueAt: string | null; pendingActionId: string | null; agentRunId: string | null; executedAt: string | null; recommendedAction: Json | null }>;
    interactions: Array<{ id: string; direction: string | null; channel: string | null; summary: string; content: string | null; createdAt: string }>;
  };
  allowedTransitions: string[];
  outcomes: Array<{ id: string; outcomeType: string; actionType: string; actionOccurredAt: string; revenueImpact: number | null; sourceType: string; salesActionId: string | null }>;
  pendingApprovals: Array<{ id: string; status: string; title: string; preview: string; createdAt: string; expiresAt: string; failureReason: string | null }>;
  runs: Array<{ id: string; status: string; intent: string | null; createdAt: string; events: Array<{ eventType: string; title: string | null; payload: Json | null; createdAt: string }> }>;
}

const RFQ_ORDER: RfqField[] = [
  "productName", "productCategory", "quantity", "unit", "material", "composition", "size", "color", "customLogo", "customization",
  "packaging", "certification", "sampleRequired", "targetPrice", "currency", "destinationCountry", "destinationCity", "incoterm",
  "requiredDeliveryDate", "buyerType", "application",
];

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  return String(v);
}

export default function RevenueOpportunityPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [data, setData] = useState<Detail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inbound, setInbound] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/revenue/opportunities/${encodeURIComponent(id)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "加载失败");
      setData(body as Detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(
    async (key: string, url: string, body: Json, method: "POST" = "POST") => {
      setBusy(key);
      setError(null);
      try {
        const res = await apiFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((json as Json)?.error as string ?? "操作失败");
        await load();
        return json;
      } catch (e) {
        setError(e instanceof Error ? e.message : "操作失败");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  if (!data) {
    return (
      <div className="space-y-4">
        <Link href="/revenue" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> 收入驾驶舱</Link>
        {error ? <div className="text-sm text-red-400">{error}</div> : <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> 加载中…</div>}
      </div>
    );
  }
  const o = data.opportunity;
  const rfq = o.rfq;
  const latestAssessment = o.assessments[0] ?? null;
  const pending = data.pendingApprovals.filter((p) => p.status === "pending");

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={<Link href="/revenue" className="hover:text-foreground">收入驾驶舱</Link>}
        title={o.customer.name}
        description={o.title}
        meta={
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded border border-border px-2 py-0.5">{getOpportunityStageLabel(o.stage)}</span>
            {o.scoreGrade ? <span className="rounded border border-border px-2 py-0.5">{o.scoreGrade} {o.score}/100</span> : null}
            {o.market ? <span className="rounded border border-border px-2 py-0.5">{o.market}</span> : null}
            {o.fdeInfluenced ? <span className="rounded border border-emerald-500/40 px-2 py-0.5 text-emerald-400">FDE influenced</span> : null}
            {o.fdeSourced ? <span className="rounded border border-emerald-500/40 px-2 py-0.5 text-emerald-400">FDE sourced</span> : null}
          </div>
        }
        actions={
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void post("fde", `/api/revenue/opportunities/${o.id}/run-fde`, {})}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted/30 disabled:opacity-50"
          >
            {busy === "fde" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} 重跑 Inbound FDE
          </button>
        }
      />
      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 客户 + 下一步 */}
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <div className="mb-2 font-medium">客户</div>
          <dl className="space-y-1 text-xs">
            <div><dt className="inline text-muted">联系人：</dt><dd className="inline">{o.customer.contactName ?? "—"}</dd></div>
            <div><dt className="inline text-muted">邮箱：</dt><dd className="inline">{o.customer.email ?? "—"}</dd></div>
            <div><dt className="inline text-muted">电话：</dt><dd className="inline">{o.customer.phone ?? "—"}</dd></div>
            <div><dt className="inline text-muted">国家：</dt><dd className="inline">{o.customer.country ?? o.market ?? "—"}</dd></div>
            <div><dt className="inline text-muted">买家类型：</dt><dd className="inline">{o.buyerType ?? "—"}</dd></div>
            <div><dt className="inline text-muted">预估金额：</dt><dd className="inline">{o.estimatedValue ?? "—"}</dd></div>
          </dl>
          <div className="mt-4 mb-1 font-medium">Next action</div>
          <div className="text-xs">
            <div>{o.nextActionType ?? "—"}{o.nextFollowupAt ? ` · ${new Date(o.nextFollowupAt).toLocaleString()}` : ""}</div>
            <div className="text-muted">{o.nextActionReason ?? ""}</div>
          </div>
          <div className="mt-4 mb-1 font-medium">阶段流转</div>
          <div className="flex flex-wrap gap-1">
            {data.allowedTransitions.map((t) => (
              <button
                key={t}
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  const reason = t === "lost" || t === "disqualified" ? window.prompt("原因（可选）") ?? "" : "";
                  const estimated = t === "won" ? Number(window.prompt("成交金额（可空）") ?? "") : NaN;
                  void post(`t:${t}`, `/api/revenue/opportunities/${o.id}/transition`, { to: t, reason, ...(Number.isFinite(estimated) && estimated > 0 ? { estimatedValue: estimated } : {}) });
                }}
                className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted/30 disabled:opacity-50"
              >
                → {getOpportunityStageLabel(t)}
              </button>
            ))}
          </div>
        </section>

        {/* RFQ */}
        <section className="rounded-xl border border-border bg-card p-4 text-sm lg:col-span-2">
          <div className="mb-2 flex items-center gap-2 font-medium">RFQ <span className="text-xs text-muted">{rfq ? `${rfq.status} · v${String(rfq.version)}` : "尚未抽取"}</span></div>
          {rfq ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-3">
              {RFQ_ORDER.map((f) => {
                const missing = Array.isArray(rfq.missingFields) && rfq.missingFields.includes(f);
                return (
                  <div key={f} className={missing ? "text-amber-400" : ""}>
                    <span className="text-muted">{RFQ_FIELD_LABELS[f].zh}：</span>
                    {missing ? "缺失" : fmt(rfq[f])}
                  </div>
                );
              })}
            </div>
          ) : null}
          {rfq?.evidence?.length ? (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-muted">证据（{rfq.evidence.length}）</summary>
              <ul className="mt-2 space-y-1">
                {rfq.evidence.slice(0, 40).map((e) => (
                  <li key={e.id} className="rounded border border-border px-2 py-1">
                    <span className="font-medium">{e.field}</span> = {e.value ?? "—"} <span className="text-muted">({e.extractedBy}, {Math.round(e.confidence * 100)}%)</span>
                    <div className="text-muted">“{e.evidenceText ?? ""}”</div>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 评分 */}
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <div className="mb-2 font-medium">Opportunity Score {latestAssessment ? `${latestAssessment.score}/100 · ${latestAssessment.grade}` : ""}</div>
          {latestAssessment ? (
            <>
              <ul className="space-y-1 text-xs">
                {latestAssessment.dimensionsJson.map((d) => (
                  <li key={d.label} className="flex gap-2">
                    <span className="w-40 shrink-0 text-muted">{d.label}</span>
                    <span className="w-12 shrink-0 tabular-nums">{d.score}/{d.max}</span>
                    <span>{d.reason}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-xs"><span className="text-muted">建议：</span>{latestAssessment.recommendedNextAction ?? "—"}</div>
            </>
          ) : (
            <div className="text-xs text-muted">尚未评分</div>
          )}
        </section>

        {/* 审批 */}
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <div className="mb-2 font-medium">回复草稿审批（{pending.length} 待批）</div>
          {data.pendingApprovals.length === 0 ? <div className="text-xs text-muted">尚无草稿</div> : null}
          <ul className="space-y-3">
            {data.pendingApprovals.map((p) => (
              <li key={p.id} className="rounded border border-border p-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.title}</span>
                  <span className="rounded bg-muted/40 px-1.5 py-0.5">{p.status}</span>
                  <span className="ml-auto text-muted">{new Date(p.createdAt).toLocaleString()}</span>
                </div>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/20 p-2 font-sans">{p.preview}</pre>
                {p.failureReason ? <div className="mt-1 text-red-400">{p.failureReason}</div> : null}
                {p.status === "pending" ? (
                  <div className="mt-2 flex gap-2">
                    <button type="button" disabled={busy !== null} onClick={() => void post(`a:${p.id}`, `/api/ai/pending-actions/${p.id}`, { decision: "approve" }, "POST")} className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-white disabled:opacity-50"><Check className="h-3 w-3" /> 批准并发送</button>
                    <button type="button" disabled={busy !== null} onClick={() => void post(`r:${p.id}`, `/api/ai/pending-actions/${p.id}`, { decision: "reject", reason: "人工拒绝" }, "POST")} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 disabled:opacity-50"><X className="h-3 w-3" /> 拒绝</button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 互动 */}
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <div className="mb-2 font-medium">互动</div>
          <form
            className="mb-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!inbound.trim()) return;
              void post("inbound", `/api/revenue/opportunities/${o.id}/interactions`, { direction: "inbound", channel: "email", content: inbound }).then(() => setInbound(""));
            }}
          >
            <input value={inbound} onChange={(e) => setInbound(e.target.value)} placeholder="记录客户来信内容（触发 CUSTOMER_REPLIED + 重跑 FDE）" className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs" />
            <button type="submit" disabled={busy !== null} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs disabled:opacity-50"><Send className="h-3 w-3" /> 记录</button>
          </form>
          <ul className="space-y-2 text-xs">
            {o.interactions.map((i) => (
              <li key={i.id} className="rounded border border-border p-2">
                <div className="text-muted">{i.direction ?? "—"} · {i.channel ?? "—"} · {new Date(i.createdAt).toLocaleString()}</div>
                <div className="whitespace-pre-wrap">{i.content ?? i.summary}</div>
              </li>
            ))}
          </ul>
        </section>

        {/* 行动 + 结果 + Run */}
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <div className="mb-2 font-medium">FDE 行动</div>
          <ul className="space-y-1 text-xs">
            {o.salesActions.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-2">
                <span className="rounded bg-muted/40 px-1.5">{a.status}</span>
                <span className="text-muted">{a.actionType ?? "—"}</span>
                <span>{a.title}</span>
                {a.executedAt ? <span className="text-emerald-400">executed {new Date(a.executedAt).toLocaleString()}</span> : null}
              </li>
            ))}
          </ul>
          <div className="mt-4 mb-2 font-medium">Business Outcomes</div>
          <ul className="space-y-1 text-xs">
            {data.outcomes.length === 0 ? <li className="text-muted">尚无结果（等待客户回复 / 报价 / 成交）</li> : null}
            {data.outcomes.map((oc) => (
              <li key={oc.id} className="flex flex-wrap gap-2">
                <span className="font-medium">{oc.outcomeType}</span>
                <span className="text-muted">{oc.actionType}</span>
                <span className="text-muted">{new Date(oc.actionOccurredAt).toLocaleString()}</span>
                {oc.revenueImpact ? <span className="text-emerald-400">{oc.revenueImpact}</span> : null}
                {oc.salesActionId ? <span className="text-muted">action {oc.salesActionId.slice(-6)}</span> : null}
              </li>
            ))}
          </ul>
          <div className="mt-4 mb-2 font-medium">Agent Runs</div>
          <ul className="space-y-2 text-xs">
            {data.runs.map((r) => (
              <li key={r.id}>
                <details>
                  <summary className="cursor-pointer">{r.status} · {r.intent ?? ""} · {new Date(r.createdAt).toLocaleString()} · {r.events.length} events</summary>
                  <ul className="mt-1 space-y-0.5 pl-3 text-muted">
                    {r.events.map((e, i) => (
                      <li key={i}><span className="text-foreground">{e.eventType}</span> {e.title ?? ""}</li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
