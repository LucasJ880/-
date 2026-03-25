"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Tag,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface TagItem {
  id: string;
  key: string;
  label: string;
  category: string;
  color: string;
  status: string;
  createdAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  quality: "质量",
  issue: "问题",
  business: "业务",
  reviewer: "评审",
};

const CATEGORY_OPTIONS = [
  { value: "quality", label: "质量" },
  { value: "issue", label: "问题" },
  { value: "business", label: "业务" },
  { value: "reviewer", label: "评审" },
];

export default function FeedbackTagsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [canManage, setCanManage] = useState(false);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [formKey, setFormKey] = useState("");
  const [formLabel, setFormLabel] = useState("");
  const [formCategory, setFormCategory] = useState("quality");
  const [formColor, setFormColor] = useState("#6b7280");
  const [formSaving, setFormSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [projRes, tagRes] = await Promise.all([
        apiFetch(`/api/projects/${projectId}`).then((r) => r.json()),
        apiFetch(`/api/projects/${projectId}/evaluation-tags`).then((r) => r.json()),
      ]);
      setCanManage(!!projRes.canManage);
      setTags(tagRes.tags ?? []);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function createTag() {
    if (!formKey.trim() || !formLabel.trim()) return;
    setFormSaving(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/evaluation-tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: formKey.trim(),
          label: formLabel.trim(),
          category: formCategory,
          color: formColor,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "创建失败");
      }
      setShowForm(false);
      setFormKey("");
      setFormLabel("");
      setFormCategory("quality");
      setFormColor("#6b7280");
      loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "创建失败");
    } finally {
      setFormSaving(false);
    }
  }

  async function updateTag(tagId: string) {
    setEditSaving(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/evaluation-tags/${tagId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: editLabel.trim() || undefined,
          category: editCategory || undefined,
          color: editColor || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "更新失败");
      }
      setEditingId(null);
      loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "更新失败");
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleStatus(tag: TagItem) {
    const newStatus = tag.status === "active" ? "archived" : "active";
    try {
      const res = await apiFetch(`/api/projects/${projectId}/evaluation-tags/${tag.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "操作失败");
      }
      loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作失败");
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <button
        type="button"
        onClick={() => router.push(`/projects/${projectId}`)}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} /> 返回项目
      </button>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Tag size={20} /> 评估标签管理
          </h1>
          <p className="mt-1 text-sm text-muted">
            管理项目级的评价标签，用于对反馈进行归类
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            <Plus size={14} /> 新建标签
          </button>
        )}
      </div>

      {showForm && (
        <div className="rounded-xl border border-border bg-card-bg p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Key *</label>
              <input
                value={formKey}
                onChange={(e) => setFormKey(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                placeholder="如 good_answer"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">名称 *</label>
              <input
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                placeholder="e.g. 优质回答"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">分类</label>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
              >
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">颜色</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={formColor}
                  onChange={(e) => setFormColor(e.target.value)}
                  className="h-8 w-8 cursor-pointer rounded border border-border"
                />
                <span className="text-xs text-muted">{formColor}</span>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              取消
            </button>
            <button
              type="button"
              onClick={createTag}
              disabled={!formKey.trim() || !formLabel.trim() || formSaving}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {formSaving ? <Loader2 size={12} className="animate-spin" /> : null}
              创建
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted" /></div>
      ) : tags.length === 0 ? (
        <div className="py-16 text-center">
          <Tag className="mx-auto mb-2 text-muted" size={32} />
          <p className="text-sm text-muted">暂无标签</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tags.map((tag) => (
            <div key={tag.id} className="flex items-center gap-3 rounded-xl border border-border bg-card-bg p-3">
              <div className="h-4 w-4 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />

              {editingId === tag.id ? (
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  <input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    className="rounded border border-border bg-background px-2 py-1 text-sm"
                    placeholder="名称"
                  />
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="rounded border border-border bg-background px-2 py-1 text-xs"
                  >
                    {CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <input
                    type="color"
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    className="h-6 w-6 cursor-pointer rounded"
                  />
                  <button
                    type="button"
                    onClick={() => updateTag(tag.id)}
                    disabled={editSaving}
                    className="rounded bg-accent px-2 py-1 text-xs text-white"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded border border-border px-2 py-1 text-xs text-muted"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex-1">
                    <span className="font-medium text-sm">{tag.label}</span>
                    <code className="ml-2 text-[10px] text-muted">{tag.key}</code>
                  </div>

                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]"
                  )}>
                    {CATEGORY_LABELS[tag.category] ?? tag.category}
                  </span>

                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    tag.status === "active"
                      ? "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]"
                      : "bg-[rgba(110,125,118,0.06)] text-[#8a9590]"
                  )}>
                    {tag.status === "active" ? "活跃" : "已归档"}
                  </span>

                  <span className="text-[10px] text-muted">
                    {new Date(tag.createdAt).toLocaleDateString("zh-CN")}
                  </span>

                  {canManage && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(tag.id);
                          setEditLabel(tag.label);
                          setEditCategory(tag.category);
                          setEditColor(tag.color);
                        }}
                        className="rounded px-2 py-0.5 text-[10px] text-accent hover:underline"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleStatus(tag)}
                        className="rounded px-2 py-0.5 text-[10px] text-muted hover:text-foreground"
                      >
                        {tag.status === "active" ? "归档" : "恢复"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
