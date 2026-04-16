"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { TOOL_TYPE_LABELS, label } from "@/lib/i18n/labels";
import { AgentStatusBadge, ToolCategoryBadge, ToolSchemaViewer } from "@/components/agent";

interface ToolDetail {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  type: string;
  status: string;
  inputSchemaJson: string | null;
  outputSchemaJson: string | null;
  configJson: string | null;
  createdBy: { id: string; name: string | null } | null;
  updatedBy: { id: string; name: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

interface BindingRow {
  id: string;
  agent: { id: string; key: string; name: string; environmentId: string };
  enabled: boolean;
}

export default function ToolDetailPage() {
  const { id: projectId, toolId } = useParams<{ id: string; toolId: string }>();

  const [tool, setTool] = useState<ToolDetail | null>(null);
  const [bindings, setBindings] = useState<BindingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [saving, setSaving] = useState(false);

  const [fName, setFName] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [fType, setFType] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fInput, setFInput] = useState("");
  const [fOutput, setFOutput] = useState("");
  const [fConfig, setFConfig] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projData, toolRes] = await Promise.all([
        apiJson<{ canManage?: boolean }>(`/api/projects/${projectId}`),
        apiFetch(`/api/projects/${projectId}/tools/${toolId}`),
      ]);
      setCanManage(projData.canManage === true);

      if (!toolRes.ok) { setTool(null); setLoading(false); return; }
      const data = await toolRes.json();
      const t = data.tool;
      setTool(t);
      setBindings(data.agentBindings ?? []);

      setFName(t.name);
      setFDesc(t.description ?? "");
      setFCategory(t.category);
      setFType(t.type);
      setFStatus(t.status);
      setFInput(t.inputSchemaJson ?? "");
      setFOutput(t.outputSchemaJson ?? "");
      setFConfig(t.configJson ?? "");
    } catch { /* ignore */ }
    setLoading(false);
  }, [projectId, toolId]);

  useEffect(() => { load(); }, [load]);

  const saveTool = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/tools/${toolId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fName, description: fDesc || null,
          category: fCategory, type: fType, status: fStatus,
          inputSchemaJson: fInput || null,
          outputSchemaJson: fOutput || null,
          configJson: fConfig || null,
        }),
      });
      if (res.ok) { await load(); }
      else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "保存失败");
      }
    } catch { alert("网络错误"); }
    setSaving(false);
  };

  if (loading) {
    return <div className="flex justify-center py-20 text-muted"><Loader2 className="animate-spin" /></div>;
  }

  if (!tool) {
    return (
      <div className="mx-auto max-w-4xl p-4">
        <Link href={`/projects/${projectId}/tools`} className="text-sm text-accent hover:underline">← 返回工具列表</Link>
        <p className="mt-8 text-center text-muted">工具不存在</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <div className="flex items-start gap-3">
        <Link href={`/projects/${projectId}/tools`} className="mt-1 text-muted hover:text-foreground">
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{tool.name}</h1>
            <AgentStatusBadge status={tool.status} />
            <ToolCategoryBadge category={tool.category} />
            <code className="rounded bg-card-bg px-1.5 text-xs text-muted">{tool.key}</code>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            类型: {tool.type} · 创建于 {new Date(tool.createdAt).toLocaleDateString("zh-CN")}
            {tool.description && <> · {tool.description}</>}
          </p>
        </div>
      </div>

      {/* Edit form */}
      <div className="space-y-4 rounded-xl border border-border bg-card-bg p-4">
        <h3 className="text-sm font-semibold">基本信息</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted">名称</label>
            <input value={fName} onChange={(e) => setFName(e.target.value)} disabled={!canManage}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent disabled:opacity-60" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">描述</label>
            <input value={fDesc} onChange={(e) => setFDesc(e.target.value)} disabled={!canManage}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent disabled:opacity-60" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">类别</label>
            <select value={fCategory} onChange={(e) => setFCategory(e.target.value)} disabled={!canManage}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm disabled:opacity-60">
              <option value="builtin">内置</option>
              <option value="api">API</option>
              <option value="internal">内部</option>
              <option value="integration">集成</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">类型</label>
            <select value={fType} onChange={(e) => setFType(e.target.value)} disabled={!canManage}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm disabled:opacity-60">
              {Object.entries(TOOL_TYPE_LABELS).map(([val, lbl]) => (
                <option key={val} value={val}>{lbl}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">状态</label>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} disabled={!canManage}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm disabled:opacity-60">
              <option value="active">活跃</option>
              <option value="archived">已归档</option>
            </select>
          </div>
        </div>
      </div>

      {/* Schema */}
      <div className="space-y-4 rounded-xl border border-border bg-card-bg p-4">
        <h3 className="text-sm font-semibold">Schema & 配置</h3>
        <ToolSchemaViewer label="Input Schema" schema={tool.inputSchemaJson} />
        <ToolSchemaViewer label="Output Schema" schema={tool.outputSchemaJson} />
        <ToolSchemaViewer label="Config JSON" schema={tool.configJson} />

        {canManage && (
          <div className="space-y-3 border-t border-border pt-3">
            <div>
              <label className="mb-1 block text-xs text-muted">Input Schema JSON</label>
              <textarea value={fInput} onChange={(e) => setFInput(e.target.value)} rows={3}
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Output Schema JSON</label>
              <textarea value={fOutput} onChange={(e) => setFOutput(e.target.value)} rows={3}
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Config JSON</label>
              <textarea value={fConfig} onChange={(e) => setFConfig(e.target.value)} rows={3}
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-accent" />
            </div>
          </div>
        )}
      </div>

      {/* Agent Bindings */}
      {bindings.length > 0 && (
        <div className="rounded-xl border border-border bg-card-bg p-4">
          <h3 className="mb-3 text-sm font-semibold">使用此工具的 Agent</h3>
          <ul className="space-y-1.5">
            {bindings.map((b) => (
              <li key={b.id} className="flex items-center gap-2 text-sm">
                <span className={`h-2 w-2 rounded-full ${b.enabled ? "bg-[#2e7a56]" : "bg-[rgba(110,125,118,0.25)]"}`} />
                <Link href={`/projects/${projectId}/agents/${b.agent.id}`} className="font-medium text-accent hover:underline">
                  {b.agent.name}
                </Link>
                <code className="text-[10px] text-muted">{b.agent.key}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Execution placeholder */}
      <div className="rounded-xl border border-dashed border-border p-6 text-center">
        <p className="text-sm font-medium text-muted">工具测试台</p>
        <p className="mt-1 text-xs text-muted">Coming soon — 将支持填写参数并实时测试工具执行</p>
      </div>

      {/* Save button */}
      {canManage && (
        <div className="flex justify-end">
          <button onClick={saveTool} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            保存
          </button>
        </div>
      )}
    </div>
  );
}
