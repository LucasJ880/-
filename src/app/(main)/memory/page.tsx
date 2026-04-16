"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Brain,
  Plus,
  Loader2,
  Trash2,
  Edit3,
  Search,
  RefreshCw,
  Zap,
  Star,
  Clock,
  X,
  Check,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch, apiJson } from "@/lib/api-fetch";

/* ─── 类型 ─── */

interface MemoryItem {
  id: string;
  memoryType: string;
  layer: number;
  content: string;
  tags: string | null;
  importance: number;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─── 常量 ─── */

const TYPE_LABELS: Record<string, string> = {
  decision: "决策",
  preference: "偏好",
  milestone: "里程碑",
  problem: "问题",
  insight: "洞察",
  fact: "事实",
};

const TYPE_COLORS: Record<string, string> = {
  decision: "bg-purple-500/15 text-purple-400",
  preference: "bg-blue-500/15 text-blue-400",
  milestone: "bg-emerald-500/15 text-emerald-400",
  problem: "bg-red-500/15 text-red-400",
  insight: "bg-amber-500/15 text-amber-400",
  fact: "bg-slate-500/15 text-slate-400",
};

const LAYER_LABELS: Record<number, string> = {
  0: "L0 身份偏好",
  1: "L1 核心记忆",
  2: "L2 按需记忆",
};

const LAYER_COLORS: Record<number, string> = {
  0: "bg-rose-500/15 text-rose-400",
  1: "bg-sky-500/15 text-sky-400",
  2: "bg-zinc-500/15 text-zinc-400",
};

/* ─── 主页面 ─── */

export default function MemoryPage() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterLayer, setFilterLayer] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterLayer !== null) params.set("layer", String(filterLayer));
      if (filterType) params.set("type", filterType);
      if (search.trim()) params.set("search", search.trim());
      params.set("limit", "100");

      const data = await apiJson<{ memories?: MemoryItem[]; total?: number }>(`/api/ai/memory?${params}`);
      setMemories(data.memories ?? []);
      setTotal(data.total ?? 0);
    } catch { /* ignore */ }
    setLoading(false);
  }, [filterLayer, filterType, search]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除此记忆？")) return;
    await apiFetch(`/api/ai/memory?id=${id}`, { method: "DELETE" });
    load();
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      const data = await apiJson<{ backfilled: number }>("/api/ai/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backfill" }),
      });
      alert(`已为 ${data.backfilled} 条记忆生成向量嵌入`);
      load();
    } catch {
      alert("向量回填失败");
    }
    setBackfilling(false);
  };

  const stats = {
    total: memories.length,
    l0: memories.filter((m) => m.layer === 0).length,
    l1: memories.filter((m) => m.layer === 1).length,
    l2: memories.filter((m) => m.layer === 2).length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI 记忆管理"
        description="管理 AI 的长期记忆，让助手更了解你"
      />

      {/* 概览卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="总记忆"
          value={total}
          icon={<Brain size={16} />}
          color="text-violet-400"
        />
        <StatCard
          label="身份偏好"
          value={stats.l0}
          icon={<Star size={16} />}
          color="text-rose-400"
        />
        <StatCard
          label="核心记忆"
          value={stats.l1}
          icon={<Zap size={16} />}
          color="text-sky-400"
        />
        <StatCard
          label="按需记忆"
          value={stats.l2}
          icon={<Clock size={16} />}
          color="text-zinc-400"
        />
      </div>

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            placeholder="搜索记忆内容或标签..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-border bg-card pl-8 pr-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </div>

        <FilterSelect
          value={filterLayer !== null ? String(filterLayer) : ""}
          onChange={(v) => setFilterLayer(v ? parseInt(v) : null)}
          options={[
            { value: "", label: "全部层级" },
            { value: "0", label: "L0 身份偏好" },
            { value: "1", label: "L1 核心记忆" },
            { value: "2", label: "L2 按需记忆" },
          ]}
        />

        <FilterSelect
          value={filterType ?? ""}
          onChange={(v) => setFilterType(v || null)}
          options={[
            { value: "", label: "全部类型" },
            ...Object.entries(TYPE_LABELS).map(([k, v]) => ({ value: k, label: v })),
          ]}
        />

        <button
          onClick={handleBackfill}
          disabled={backfilling}
          className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/30 transition-colors disabled:opacity-50"
          title="为缺失向量的记忆补充 Embedding"
        >
          {backfilling ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          向量回填
        </button>

        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus size={12} />
          添加记忆
        </button>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        </div>
      ) : memories.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-2">
          {memories.map((m) =>
            editingId === m.id ? (
              <EditMemoryCard
                key={m.id}
                memory={m}
                onSave={() => { setEditingId(null); load(); }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <MemoryCard
                key={m.id}
                memory={m}
                onEdit={() => setEditingId(m.id)}
                onDelete={() => handleDelete(m.id)}
              />
            ),
          )}
        </div>
      )}

      {showCreate && (
        <CreateMemoryModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}

/* ─── 子组件 ─── */

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className={cn("flex items-center gap-1.5 text-xs mb-1", color)}>
        {icon}
        {label}
      </div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-md border border-border bg-card pl-2.5 pr-7 py-1.5 text-xs outline-none focus:border-primary"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
      />
    </div>
  );
}

function MemoryCard({
  memory: m,
  onEdit,
  onDelete,
}: {
  memory: MemoryItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = m.content.length > 120;

  return (
    <div className="rounded-lg border border-border bg-card p-3 hover:border-muted transition-colors">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {/* 标签行 */}
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", LAYER_COLORS[m.layer])}>
              {LAYER_LABELS[m.layer] ?? `L${m.layer}`}
            </span>
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", TYPE_COLORS[m.memoryType])}>
              {TYPE_LABELS[m.memoryType] ?? m.memoryType}
            </span>
            <ImportanceStars count={m.importance} />
            {m.accessCount > 0 && (
              <span className="text-[10px] text-muted" title="被引用次数">
                引用 {m.accessCount} 次
              </span>
            )}
          </div>

          {/* 内容 */}
          <div
            className={cn(
              "text-sm leading-relaxed whitespace-pre-wrap",
              !expanded && isLong && "line-clamp-2",
            )}
          >
            {m.content}
          </div>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-primary/70 hover:text-primary mt-0.5"
            >
              {expanded ? "收起" : "展开"}
            </button>
          )}

          {/* 标签 */}
          {m.tags && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {m.tags.split(",").map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted"
                >
                  {tag.trim()}
                </span>
              ))}
            </div>
          )}

          {/* 底栏 */}
          <div className="flex items-center gap-3 mt-2 text-[10px] text-muted">
            <span>创建 {formatDate(m.createdAt)}</span>
            {m.lastAccessedAt && (
              <span>最近引用 {formatDate(m.lastAccessedAt)}</span>
            )}
          </div>
        </div>

        {/* 操作 */}
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="rounded p-1 hover:bg-muted/30 text-muted hover:text-foreground transition-colors"
            title="编辑"
          >
            <Edit3 size={13} />
          </button>
          <button
            onClick={onDelete}
            className="rounded p-1 hover:bg-red-500/10 text-muted hover:text-red-400 transition-colors"
            title="删除"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function EditMemoryCard({
  memory: m,
  onSave,
  onCancel,
}: {
  memory: MemoryItem;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState(m.content);
  const [memoryType, setMemoryType] = useState(m.memoryType);
  const [layer, setLayer] = useState(m.layer);
  const [tags, setTags] = useState(m.tags ?? "");
  const [importance, setImportance] = useState(m.importance);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/ai/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: m.id, content, memoryType, layer, tags, importance }),
      });
      onSave();
    } catch {
      alert("保存失败");
    }
    setSaving(false);
  };

  return (
    <div className="rounded-lg border-2 border-primary/40 bg-card p-3 space-y-2">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        className="w-full rounded-md border border-border bg-background p-2 text-sm outline-none focus:border-primary resize-y"
      />

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={layer}
          onChange={(e) => setLayer(parseInt(e.target.value))}
          className="rounded border border-border bg-background px-2 py-1 text-xs"
        >
          <option value={0}>L0 身份偏好</option>
          <option value={1}>L1 核心记忆</option>
          <option value={2}>L2 按需记忆</option>
        </select>

        <select
          value={memoryType}
          onChange={(e) => setMemoryType(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-xs"
        >
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted">重要度</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setImportance(n)}
              className={cn(
                "text-xs",
                n <= importance ? "text-amber-400" : "text-muted/30",
              )}
            >
              <Star size={12} fill={n <= importance ? "currentColor" : "none"} />
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="标签(逗号分隔)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="flex-1 min-w-[120px] rounded border border-border bg-background px-2 py-1 text-xs outline-none"
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="flex items-center gap-1 rounded px-2.5 py-1 text-xs hover:bg-muted/30"
        >
          <X size={12} /> 取消
        </button>
        <button
          onClick={handleSave}
          disabled={saving || content.trim().length < 2}
          className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          保存
        </button>
      </div>
    </div>
  );
}

function CreateMemoryModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [content, setContent] = useState("");
  const [memoryType, setMemoryType] = useState("fact");
  const [layer, setLayer] = useState(1);
  const [tags, setTags] = useState("");
  const [importance, setImportance] = useState(3);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/ai/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memoryType,
          content: content.trim(),
          layer,
          tags: tags || undefined,
          importance,
        }),
      });
      onCreated();
    } catch {
      alert("创建失败");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Brain size={15} className="text-violet-400" />
            添加记忆
          </h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted/30">
            <X size={14} />
          </button>
        </div>

        <div className="space-y-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            placeholder="输入记忆内容，例如：我喜欢简洁的邮件风格、我的工厂主要生产LED灯具..."
            className="w-full rounded-md border border-border bg-background p-2.5 text-sm outline-none focus:border-primary resize-y"
          />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted mb-0.5 block">层级</label>
              <select
                value={layer}
                onChange={(e) => setLayer(parseInt(e.target.value))}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
              >
                <option value={0}>L0 身份偏好（始终加载）</option>
                <option value={1}>L1 核心记忆（高频加载）</option>
                <option value={2}>L2 按需记忆（话题匹配）</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted mb-0.5 block">类型</label>
              <select
                value={memoryType}
                onChange={(e) => setMemoryType(e.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
              >
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] text-muted mb-0.5 block">标签（逗号分隔）</label>
            <input
              type="text"
              placeholder="例如: 外贸,LED,报价策略"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs outline-none"
            />
          </div>

          <div>
            <label className="text-[10px] text-muted mb-0.5 block">重要度</label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setImportance(n)}
                  className={cn("p-0.5", n <= importance ? "text-amber-400" : "text-muted/30")}
                >
                  <Star size={16} fill={n <= importance ? "currentColor" : "none"} />
                </button>
              ))}
              <span className="ml-1 text-xs text-muted">{importance}/5</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs hover:bg-muted/30"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || content.trim().length < 2}
            className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportanceStars({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-px" title={`重要度 ${count}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          size={9}
          className={i < count ? "text-amber-400" : "text-muted/20"}
          fill={i < count ? "currentColor" : "none"}
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Brain size={40} className="text-muted/30 mb-3" />
      <h3 className="text-sm font-medium text-muted mb-1">暂无记忆</h3>
      <p className="text-xs text-muted/60 max-w-xs">
        AI 会在对话中自动学习和记忆你的偏好、决策和关键信息。你也可以手动添加。
      </p>
    </div>
  );
}

/* ─── 工具 ─── */

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}
