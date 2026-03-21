"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Loader2,
  MessageSquare,
  Pencil,
  Rocket,
  Save,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { AgentStatusBadge, AgentTypeBadge, AgentBindingCard, AgentVersionList } from "@/components/agent";

interface AgentDetail {
  id: string;
  key: string;
  name: string;
  description: string | null;
  type: string;
  status: string;
  environment: { id: string; code: string; name: string };
  modelProvider: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  systemBehaviorNote: string | null;
  extraConfigJson: string | null;
  promptId: string | null;
  knowledgeBaseId: string | null;
  activeVersion: { id: string; version: number } | null;
  createdBy: { id: string; name: string | null } | null;
  updatedBy: { id: string; name: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

interface ToolBinding {
  id: string;
  tool: { id: string; key: string; name: string; category: string; type: string; status: string };
  enabled: boolean;
  sortOrder: number;
  configOverrideJson: string | null;
}

interface VersionItem {
  id: string;
  version: number;
  changeNote: string | null;
  createdBy?: { name: string | null } | null;
  createdAt: string;
}

interface PromptInfo { id: string; key: string; name: string }
interface KbInfo { id: string; key: string; name: string }
interface PromptOption { id: string; key: string; name: string }
interface KbOption { id: string; key: string; name: string }
interface ToolOption { id: string; key: string; name: string; category: string }

const TABS = [
  { key: "config", label: "配置" },
  { key: "bindings", label: "绑定" },
  { key: "tools", label: "工具" },
  { key: "versions", label: "版本" },
  { key: "runtime", label: "Runtime" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function AgentDetailPage() {
  const { id: projectId, agentId } = useParams<{ id: string; agentId: string }>();
  const router = useRouter();

  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [promptInfo, setPromptInfo] = useState<PromptInfo | null>(null);
  const [kbInfo, setKbInfo] = useState<KbInfo | null>(null);
  const [toolBindings, setToolBindings] = useState<ToolBinding[]>([]);
  const [recentVersions, setRecentVersions] = useState<VersionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("config");
  const [saving, setSaving] = useState(false);

  // Config form state
  const [fName, setFName] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fModelProvider, setFModelProvider] = useState("");
  const [fModelName, setFModelName] = useState("");
  const [fTemp, setFTemp] = useState(0.7);
  const [fMaxTokens, setFMaxTokens] = useState(4096);
  const [fBehavior, setFBehavior] = useState("");
  const [fPromptId, setFPromptId] = useState("");
  const [fKbId, setFKbId] = useState("");
  const [fChangeNote, setFChangeNote] = useState("");

  // Options for prompt/kb dropdowns
  const [promptOptions, setPromptOptions] = useState<PromptOption[]>([]);
  const [kbOptions, setKbOptions] = useState<KbOption[]>([]);
  const [toolOptions, setToolOptions] = useState<ToolOption[]>([]);
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(new Set());

  // Publish
  const [publishing, setPublishing] = useState(false);
  const [publishRemark, setPublishRemark] = useState("");
  const [showPublish, setShowPublish] = useState(false);

  // Test conversation
  const [showTestConv, setShowTestConv] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  const [autoRun, setAutoRun] = useState(true);
  const [creatingConv, setCreatingConv] = useState(false);

  // All versions (full list)
  const [allVersions, setAllVersions] = useState<VersionItem[]>([]);
  const [versionsLoaded, setVersionsLoaded] = useState(false);

  const loadAgent = useCallback(async () => {
    setLoading(true);
    try {
      const [projRes, detailRes] = await Promise.all([
        apiFetch(`/api/projects/${projectId}`),
        apiFetch(`/api/projects/${projectId}/agents/${agentId}`),
      ]);
      const projData = await projRes.json();
      setCanManage(projData.canManage === true);

      if (!detailRes.ok) { setAgent(null); setLoading(false); return; }
      const data = await detailRes.json();
      const a = data.agent;
      setAgent(a);
      setPromptInfo(data.prompt ?? null);
      setKbInfo(data.knowledgeBase ?? null);
      setToolBindings(data.toolBindings ?? []);
      setRecentVersions(data.recentVersions ?? []);

      setFName(a.name);
      setFDesc(a.description ?? "");
      setFModelProvider(a.modelProvider);
      setFModelName(a.modelName);
      setFTemp(a.temperature);
      setFMaxTokens(a.maxTokens);
      setFBehavior(a.systemBehaviorNote ?? "");
      setFPromptId(a.promptId ?? "");
      setFKbId(a.knowledgeBaseId ?? "");
      setSelectedToolIds(new Set((data.toolBindings ?? []).filter((b: ToolBinding) => b.enabled).map((b: ToolBinding) => b.tool.id)));
    } catch { /* ignore */ }
    setLoading(false);
  }, [projectId, agentId]);

  const loadOptions = useCallback(async () => {
    if (!agent) return;
    try {
      const [pRes, kbRes, tRes] = await Promise.all([
        apiFetch(`/api/projects/${projectId}/prompts?environmentId=${agent.environment.id}&pageSize=200`),
        apiFetch(`/api/projects/${projectId}/knowledge-bases?environmentId=${agent.environment.id}&pageSize=200`),
        apiFetch(`/api/projects/${projectId}/tools?status=active&pageSize=200`),
      ]);
      const pd = await pRes.json();
      const kd = await kbRes.json();
      const td = await tRes.json();
      setPromptOptions((pd.prompts ?? []).map((p: PromptOption) => ({ id: p.id, key: p.key, name: p.name })));
      setKbOptions((kd.knowledgeBases ?? []).map((k: KbOption) => ({ id: k.id, key: k.key, name: k.name })));
      setToolOptions((td.tools ?? []).map((t: ToolOption & { category: string }) => ({ id: t.id, key: t.key, name: t.name, category: t.category })));
    } catch { /* ignore */ }
  }, [projectId, agent]);

  useEffect(() => { loadAgent(); }, [loadAgent]);
  useEffect(() => { loadOptions(); }, [loadOptions]);

  const loadAllVersions = useCallback(async () => {
    if (versionsLoaded) return;
    try {
      const res = await apiFetch(`/api/projects/${projectId}/agents/${agentId}/versions?pageSize=100`);
      const data = await res.json();
      setAllVersions(data.versions ?? []);
      setVersionsLoaded(true);
    } catch { /* ignore */ }
  }, [projectId, agentId, versionsLoaded]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fName,
          description: fDesc || null,
          modelProvider: fModelProvider,
          modelName: fModelName,
          temperature: fTemp,
          maxTokens: fMaxTokens,
          systemBehaviorNote: fBehavior || null,
          promptId: fPromptId || null,
          knowledgeBaseId: fKbId || null,
          enabledToolIds: [...selectedToolIds],
          changeNote: fChangeNote || "配置更新",
        }),
      });
      if (res.ok) {
        setFChangeNote("");
        await loadAgent();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "保存失败");
      }
    } catch { alert("网络错误"); }
    setSaving(false);
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/agents/${agentId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetEnvironmentCode: "prod", remark: publishRemark }),
      });
      if (res.ok) {
        alert("发布成功");
        setShowPublish(false);
        setPublishRemark("");
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "发布失败");
      }
    } catch { alert("网络错误"); }
    setPublishing(false);
  };

  const handleCreateTestConv = async () => {
    if (!agent) return;
    setCreatingConv(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          environmentId: agent.environment.id,
          agentId: agent.id,
          title: `测试 - ${agent.name}`,
          channel: "internal",
          initialMessage: testMsg.trim() || undefined,
          autoRun: autoRun && !!testMsg.trim(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/projects/${projectId}/conversations/${data.conversation.id}`);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "创建失败");
      }
    } catch { alert("网络错误"); }
    setCreatingConv(false);
  };

  if (loading) {
    return <div className="flex justify-center py-20 text-muted"><Loader2 className="animate-spin" /></div>;
  }

  if (!agent) {
    return (
      <div className="mx-auto max-w-4xl p-4">
        <Link href={`/projects/${projectId}/agents`} className="text-sm text-accent hover:underline">← 返回 Agent 列表</Link>
        <p className="mt-8 text-center text-muted">Agent 不存在</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href={`/projects/${projectId}/agents`} className="mt-1 text-muted hover:text-foreground">
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{agent.name}</h1>
            <AgentStatusBadge status={agent.status} />
            <AgentTypeBadge type={agent.type} />
            <code className="rounded bg-card-bg px-1.5 text-xs text-muted">{agent.key}</code>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {agent.environment.name} ({agent.environment.code})
            {agent.activeVersion && <> · v{agent.activeVersion.version}</>}
            {agent.description && <> · {agent.description}</>}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {canManage && (
            <>
              <button onClick={() => setShowTestConv(true)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-background">
                <MessageSquare size={12} /> 测试会话
              </button>
              <button onClick={() => setShowPublish(true)} className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:bg-accent/90">
                <Rocket size={12} /> 发布
              </button>
            </>
          )}
        </div>
      </div>

      {/* Publish Dialog */}
      {showPublish && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
          <h3 className="mb-2 text-sm font-semibold">发布 Agent 到 prod</h3>
          <p className="mb-3 text-xs text-muted">将当前 Agent 配置（含 Prompt/KB/工具绑定）同步到生产环境。</p>
          <input value={publishRemark} onChange={(e) => setPublishRemark(e.target.value)} placeholder="发布备注（可选）"
            className="mb-3 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent" />
          <div className="flex gap-2">
            <button onClick={() => setShowPublish(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs">取消</button>
            <button onClick={handlePublish} disabled={publishing} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50">
              {publishing ? "发布中..." : "确认发布"}
            </button>
          </div>
        </div>
      )}

      {/* Test Conversation Dialog */}
      {showTestConv && (
        <div className="rounded-xl border border-border bg-card-bg p-4">
          <h3 className="mb-2 text-sm font-semibold">基于此 Agent 创建测试会话</h3>
          <p className="mb-3 text-xs text-muted">将自动使用当前 Agent 的 Prompt/知识库/工具配置。</p>
          <textarea value={testMsg} onChange={(e) => setTestMsg(e.target.value)} placeholder="初始消息（可选，填写后可自动运行 Agent）" rows={2}
            className="mb-3 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent" />
          <label className="mb-3 flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} className="rounded" />
            创建后自动运行 Agent（需填写初始消息）
          </label>
          <div className="flex gap-2">
            <button onClick={() => setShowTestConv(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs">取消</button>
            <button onClick={handleCreateTestConv} disabled={creatingConv} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50">
              {creatingConv ? (autoRun && testMsg.trim() ? "创建并运行中..." : "创建中...") : (autoRun && testMsg.trim() ? "创建并运行" : "创建会话")}
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setActiveTab(t.key);
              if (t.key === "versions") loadAllVersions();
            }}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === t.key
                ? "border-b-2 border-accent text-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Config Tab */}
      {activeTab === "config" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <label className="mb-1 block text-xs text-muted">模型提供方</label>
              <input value={fModelProvider} onChange={(e) => setFModelProvider(e.target.value)} disabled={!canManage}
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent disabled:opacity-60" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">模型名称</label>
              <input value={fModelName} onChange={(e) => setFModelName(e.target.value)} disabled={!canManage}
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent disabled:opacity-60" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Temperature ({fTemp})</label>
              <input type="range" min="0" max="2" step="0.1" value={fTemp} onChange={(e) => setFTemp(Number(e.target.value))} disabled={!canManage}
                className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Max Tokens</label>
              <input type="number" value={fMaxTokens} onChange={(e) => setFMaxTokens(Number(e.target.value))} disabled={!canManage}
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent disabled:opacity-60" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">System Behavior Note</label>
            <textarea value={fBehavior} onChange={(e) => setFBehavior(e.target.value)} disabled={!canManage} rows={3}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent disabled:opacity-60" />
          </div>

          {canManage && (
            <div className="flex items-center gap-3 border-t border-border pt-4">
              <input value={fChangeNote} onChange={(e) => setFChangeNote(e.target.value)} placeholder="变更备注（可选）"
                className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent" />
              <button onClick={saveConfig} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                保存配置
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bindings Tab */}
      {activeTab === "bindings" && (
        <div className="space-y-4">
          <AgentBindingCard prompt={promptInfo} knowledgeBase={kbInfo} toolBindings={toolBindings} />
          {canManage && (
            <div className="space-y-3 rounded-xl border border-border bg-card-bg p-4">
              <h3 className="text-sm font-semibold">修改绑定</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-muted">Prompt</label>
                  <select value={fPromptId} onChange={(e) => setFPromptId(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm">
                    <option value="">不绑定</option>
                    {promptOptions.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.key})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">知识库</label>
                  <select value={fKbId} onChange={(e) => setFKbId(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm">
                    <option value="">不绑定</option>
                    {kbOptions.map((k) => (
                      <option key={k.id} value={k.id}>{k.name} ({k.key})</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-[10px] text-muted">修改绑定后请在「配置」页签点击保存。</p>
            </div>
          )}
        </div>
      )}

      {/* Tools Tab */}
      {activeTab === "tools" && (
        <div className="space-y-4">
          {toolBindings.length > 0 ? (
            <div className="rounded-xl border border-border bg-card-bg p-4">
              <h3 className="mb-3 text-sm font-semibold">已绑定工具</h3>
              <ul className="space-y-2">
                {toolBindings.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 text-sm">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${b.enabled ? "bg-[#2e7a56]" : "bg-[rgba(110,125,118,0.25)]"}`} />
                    <span className="font-medium">{b.tool.name}</span>
                    <code className="text-[10px] text-muted">{b.tool.key}</code>
                    <span className="text-[10px] text-muted">{b.tool.category} · {b.tool.type}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted">暂未绑定工具</p>
          )}

          {canManage && toolOptions.length > 0 && (
            <div className="rounded-xl border border-border bg-card-bg p-4">
              <h3 className="mb-3 text-sm font-semibold">选择工具</h3>
              <div className="space-y-1.5">
                {toolOptions.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedToolIds.has(t.id)}
                      onChange={(e) => {
                        const next = new Set(selectedToolIds);
                        if (e.target.checked) next.add(t.id); else next.delete(t.id);
                        setSelectedToolIds(next);
                      }}
                      className="rounded"
                    />
                    <span>{t.name}</span>
                    <code className="text-[10px] text-muted">{t.key}</code>
                    <span className="text-[10px] text-muted">{t.category}</span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-muted">勾选后请在「配置」页签点击保存以同步工具绑定。</p>
            </div>
          )}
        </div>
      )}

      {/* Versions Tab */}
      {activeTab === "versions" && (
        <div className="space-y-4">
          <AgentVersionList
            versions={allVersions.length > 0 ? allVersions : recentVersions}
            activeVersionId={agent.activeVersion?.id}
          />
        </div>
      )}

      {/* Runtime Tab */}
      {activeTab === "runtime" && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium text-muted">Runtime 模块</p>
          <p className="mt-1 text-xs text-muted">Coming soon — 将支持实时对话、工具调用链路追踪、流式响应</p>
        </div>
      )}
    </div>
  );
}
