"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, Play, RefreshCw, Workflow } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

interface FlowReadiness { key: string; env: string; configured: boolean }
interface WorkflowRun { id: string; flowKey: string; status: string; error: string | null; createdAt: string }
interface AutomationData {
  readiness: { configured: boolean; secretConfigured: boolean; flows: FlowReadiness[] };
  runs: WorkflowRun[];
}

const FLOW_LABELS: Record<string, { name: string; description: string }> = {
  "sync-metrics": { name: "同步渠道数据", description: "从 Google Ads / Meta / 小红书 / GA4 等拉取周花费与 KPI，经 marketing.metrics.upsert 幂等写回青砚。" },
  "health-scan": { name: "营销健康检查", description: "运行只读检查，不会自动发布或修改预算。" },
  "daily-brief": { name: "微信推广日报", description: "生成日报并推送给组织负责人和管理员。" },
  "experiment-review": { name: "实验复盘", description: "汇总赛马数据，给出方向性结论供人工确认。" },
  "mmm-run": { name: "Meridian MMM", description: "需要先在 MMM 页面建立版本化数据集。" },
};

export default function MarketingAutomationsPage() {
  const [data, setData] = useState<AutomationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await apiFetch("/api/marketing/automations");
    const body = await response.json();
    if (response.ok) setData(body); else setError(body.error || "自动流状态加载失败");
    setLoading(false);
  }, []);
  useEffect(() => { load().catch(() => setError("自动流状态加载失败")); }, [load]);

  async function run(flowKey: string) {
    setRunning(flowKey); setError(null); setMessage(null);
    const response = await apiFetch("/api/marketing/automations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flowKey }),
    });
    const body = await response.json();
    if (!response.ok) setError(body.error || "自动流启动失败");
    else if (body.run?.status === "skipped") setMessage("流程边界已就绪，但 Activepieces Webhook 尚未配置；未执行任何外部动作。 ");
    else setMessage("请求已提交给 Activepieces，可在下方查看运行状态。 ");
    setRunning(null); await load();
  }

  return <div className="mx-auto max-w-5xl space-y-5 pb-10">
    <div><Link href="/operations/growth" className="text-sm text-accent">← 返回增长中心</Link><h1 className="mt-2 flex items-center gap-2 text-2xl font-bold"><Workflow size={24}/>智能自动流</h1><p className="mt-1 text-sm text-muted">青砚保存业务事实和审批，Activepieces 只负责连接、调度、重试和外部执行。</p></div>
    {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {message && <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
    {loading && !data ? <div className="flex justify-center py-20"><Loader2 className="animate-spin"/></div> : data && <>
      <section className="rounded-xl border border-border bg-card-bg p-5">
        <div className="flex items-center justify-between"><div><h2 className="font-semibold">接入状态</h2><p className="mt-1 text-sm text-muted">密钥与至少一个流程地址配置后即可运行。</p></div><button onClick={load} className="rounded-lg border border-border p-2"><RefreshCw size={16}/></button></div>
        <div className="mt-4 flex items-center gap-2 text-sm">{data.readiness.configured ? <CheckCircle2 className="text-emerald-600" size={18}/> : <CircleAlert className="text-amber-600" size={18}/>}<strong>{data.readiness.configured ? "Activepieces 已接入" : "等待配置 Activepieces"}</strong></div>
      </section>
      <section className="grid gap-3 sm:grid-cols-2">
        {data.readiness.flows.map((flow) => <div key={flow.key} className="rounded-xl border border-border bg-card-bg p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{FLOW_LABELS[flow.key]?.name || flow.key}</h3><p className="mt-1 text-sm text-muted">{FLOW_LABELS[flow.key]?.description}</p></div>{flow.configured ? <CheckCircle2 className="shrink-0 text-emerald-600" size={18}/> : <CircleAlert className="shrink-0 text-amber-600" size={18}/>}</div>{flow.key === "mmm-run" ? <Link href="/operations/growth/mmm" className="mt-4 inline-flex text-sm text-accent">前往 MMM →</Link> : <button onClick={() => run(flow.key)} disabled={running === flow.key} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-50">{running === flow.key ? <Loader2 size={14} className="animate-spin"/> : <Play size={14}/>}运行一次</button>}</div>)}
      </section>
      <section className="rounded-xl border border-border bg-card-bg p-5"><h2 className="font-semibold">最近运行</h2><div className="mt-3 space-y-2">{data.runs.length === 0 ? <p className="text-sm text-muted">暂无运行记录。</p> : data.runs.map((run) => <div key={run.id} className="flex items-start justify-between gap-3 rounded-lg bg-background p-3 text-sm"><div><div className="font-medium">{FLOW_LABELS[run.flowKey]?.name || run.flowKey}</div>{run.error && <div className="mt-1 text-xs text-amber-700">{run.error}</div>}</div><div className="text-right"><div className="rounded-full border border-border px-2 py-0.5 text-xs">{run.status}</div><div className="mt-1 text-xs text-muted">{new Date(run.createdAt).toLocaleString()}</div></div></div>)}</div></section>
    </>}
  </div>;
}
