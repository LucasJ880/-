"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2, FileText, Copy, CheckCircle2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

interface Template {
  id: string;
  name: string;
  category: string;
  language: string;
  subject: string;
  body: string;
  variables: string[] | null;
  isDefault: boolean;
  usageCount: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  first_touch: "首次开发",
  follow_up: "跟进",
  after_quote: "报价后",
  after_sample: "样品后",
  re_engage: "重新激活",
  exhibition: "展会后",
};

const CATEGORY_COLORS: Record<string, string> = {
  first_touch: "bg-blue-500/15 text-blue-400",
  follow_up: "bg-amber-500/15 text-amber-400",
  after_quote: "bg-violet-500/15 text-violet-400",
  after_sample: "bg-emerald-500/15 text-emerald-400",
  re_engage: "bg-orange-500/15 text-orange-400",
  exhibition: "bg-cyan-500/15 text-cyan-400",
};

export default function TradeTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    const url = `/api/trade/templates?orgId=default${filter ? `&category=${filter}` : ""}`;
    const res = await apiFetch(url);
    if (res.ok) setTemplates(await res.json());
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCopy = (t: Template) => {
    navigator.clipboard.writeText(`Subject: ${t.subject}\n\n${t.body}`);
    setCopiedId(t.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除该模板？")) return;
    await apiFetch(`/api/trade/templates/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="邮件模板"
        description="外贸开发信模板库 — 首次开发、跟进、报价后、展会后等场景"
      />

      {/* Filter + Actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none"
          >
            <option value="">全部类型</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <span className="text-xs text-muted">{templates.length} 个模板</span>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500"
        >
          <Plus size={14} />
          新建模板
        </button>
      </div>

      {/* Template List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card-bg px-8 py-16 text-center">
          <FileText className="mx-auto mb-3 h-8 w-8 text-muted" />
          <p className="text-sm text-muted">暂无模板，系统将自动生成默认模板</p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border border-border/60 bg-card-bg transition hover:border-border">
              <div
                onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                className="flex cursor-pointer items-center gap-3 p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{t.name}</span>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", CATEGORY_COLORS[t.category] ?? "bg-zinc-500/15 text-zinc-400")}>
                      {CATEGORY_LABELS[t.category] ?? t.category}
                    </span>
                    <span className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] text-zinc-400">{t.language.toUpperCase()}</span>
                    {t.isDefault && <span className="text-[10px] text-muted">内置</span>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">Subject: {t.subject}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCopy(t); }}
                    className="rounded-lg p-1.5 text-muted transition hover:text-foreground"
                  >
                    {copiedId === t.id ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                  {!t.isDefault && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}
                      className="rounded-lg p-1.5 text-muted transition hover:text-red-400"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

              {expandedId === t.id && (
                <div className="border-t border-border/60 p-4">
                  <div className="rounded-lg bg-background p-3">
                    <p className="mb-2 text-xs font-medium text-muted">Subject: {t.subject}</p>
                    <div className="whitespace-pre-wrap text-sm text-foreground">{t.body}</div>
                  </div>
                  {t.variables && (t.variables as string[]).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className="text-[10px] text-muted">变量：</span>
                      {(t.variables as string[]).map((v) => (
                        <span key={v} className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">
                          {`{{${v}}}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreateTemplateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}

function CreateTemplateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("first_touch");
  const [language, setLanguage] = useState("en");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !subject.trim() || !body.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/trade/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: "default", name, category, language, subject, body }),
      });
      if (res.ok) onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card-bg p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-foreground">新建邮件模板</h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="模板名称"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-3">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none">
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none">
              <option value="en">English</option>
              <option value="zh">中文</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
            </select>
          </div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="邮件主题（支持 {{变量}}）"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            placeholder="邮件正文（支持 {{companyName}}、{{contactName}} 等变量）"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
          />
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-muted hover:text-foreground">取消</button>
            <button
              type="submit"
              disabled={saving || !name.trim() || !subject.trim() || !body.trim()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              创建
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
