"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2, BookOpen, Trash2, Edit3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

interface KnowledgeItem {
  id: string;
  category: string;
  title: string;
  content: string;
  tags: string | null;
  language: string;
  createdAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  product: "产品",
  faq: "常见问题",
  case_study: "成功案例",
  certification: "认证资质",
  process: "生产工艺",
};

const CATEGORY_COLORS: Record<string, string> = {
  product: "bg-blue-500/15 text-blue-400",
  faq: "bg-amber-500/15 text-amber-400",
  case_study: "bg-emerald-500/15 text-emerald-400",
  certification: "bg-violet-500/15 text-violet-400",
  process: "bg-cyan-500/15 text-cyan-400",
};

export default function TradeKnowledgePage() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const url = `/api/trade/knowledge?orgId=default${filter ? `&category=${filter}` : ""}`;
    const res = await apiFetch(url);
    if (res.ok) setItems(await res.json());
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除？")) return;
    await apiFetch(`/api/trade/knowledge/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="产品知识库" description="AI 生成开发信和回复建议时会自动引用这些资料" />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none">
            <option value="">全部类型</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <span className="text-xs text-muted">{items.length} 条</span>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500">
          <Plus size={14} /> 添加知识
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card-bg px-8 py-16 text-center">
          <BookOpen className="mx-auto mb-3 h-8 w-8 text-muted" />
          <p className="text-sm text-muted">暂无知识条目</p>
          <p className="mt-1 text-xs text-muted">添加产品信息、FAQ、成功案例等，AI 将在生成开发信和回复时自动引用</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border border-border/60 bg-card-bg transition hover:border-border">
              <div onClick={() => setExpandedId(expandedId === item.id ? null : item.id)} className="flex cursor-pointer items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", CATEGORY_COLORS[item.category] ?? "bg-zinc-500/15 text-zinc-400")}>
                      {CATEGORY_LABELS[item.category] ?? item.category}
                    </span>
                  </div>
                  {item.tags && (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {item.tags.split(",").map((t, i) => (
                        <span key={i} className="text-[10px] text-muted">#{t.trim()}</span>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }} className="rounded-lg p-1.5 text-muted transition hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
              {expandedId === item.id && (
                <div className="border-t border-border/60 p-4">
                  <div className="whitespace-pre-wrap rounded-lg bg-background p-3 text-sm text-foreground">{item.content}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateKnowledgeModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
    </div>
  );
}

function CreateKnowledgeModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("product");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/trade/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: "default", title, category, content, tags: tags.trim() || undefined }),
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
        <h2 className="text-lg font-semibold text-foreground">添加知识条目</h2>
        <p className="mt-1 text-xs text-muted">AI 将在生成开发信和分析客户回复时自动引用这些资料</p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题（如：斑马帘面料产品介绍）" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
          <div className="grid grid-cols-2 gap-3">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none">
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="标签（逗号分隔）" className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
          </div>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} placeholder="详细内容（产品规格、优势、认证、工艺、常见问题解答等）..." className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none" />
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-muted hover:text-foreground">取消</button>
            <button type="submit" disabled={saving || !title.trim() || !content.trim()} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
              {saving && <Loader2 size={14} className="animate-spin" />}
              添加
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
