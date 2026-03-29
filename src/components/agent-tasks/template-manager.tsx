"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Workflow,
  Plus,
  Loader2,
  Settings,
  Trash2,
  Globe,
  Lock,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { TemplateEditor } from "./template-editor";

interface PresetTemplate {
  id: string;
  name: string;
  description: string;
  stepCount: number;
  type: "preset";
  enabled: boolean;
}

interface CustomTemplate {
  id: string;
  name: string;
  description: string;
  stepCount: number;
  type: "custom";
  icon: string | null;
  category: string;
  enabled: boolean;
  isOwn: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

type TemplateItem = PresetTemplate | CustomTemplate;

export function TemplateManager() {
  const [presets, setPresets] = useState<PresetTemplate[]>([]);
  const [custom, setCustom] = useState<CustomTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiJson<{ presets: PresetTemplate[]; custom: CustomTemplate[] }>(
        "/api/agent/templates"
      );
      setPresets(data.presets ?? []);
      setCustom(data.custom ?? []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = useCallback(async (id: string) => {
    setDeleting(id);
    try {
      await apiFetch(`/api/agent/templates/${id}`, { method: "DELETE" });
      await load();
    } catch {}
    setDeleting(null);
  }, [load]);

  if (editingId || creating) {
    return (
      <TemplateEditor
        templateId={editingId ?? undefined}
        onSaved={() => {
          setEditingId(null);
          setCreating(false);
          load();
        }}
        onCancel={() => {
          setEditingId(null);
          setCreating(false);
        }}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Workflow size={16} className="text-accent" />
          <h3 className="text-base font-semibold">流程模板管理</h3>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 rounded-lg bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/20 transition-colors"
        >
          <Plus size={14} />
          创建模板
        </button>
      </div>

      {/* 预设模板 */}
      {presets.length > 0 && (
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <Sparkles size={11} />
            系统预设
          </h4>
          <div className="space-y-1.5">
            {presets.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-lg border border-border/40 bg-card px-4 py-3"
              >
                <Workflow size={15} className="text-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {t.description} · {t.stepCount} 步
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground bg-muted/20 rounded px-1.5 py-0.5">
                  内置
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 自定义模板 */}
      <div>
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Settings size={11} />
          自定义模板
        </h4>
        {custom.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/50 px-4 py-8 text-center text-sm text-muted-foreground">
            还没有自定义模板，点击上方「创建模板」开始
          </div>
        ) : (
          <div className="space-y-1.5">
            {custom.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-lg border border-border/40 bg-card px-4 py-3"
              >
                <Workflow size={15} className="text-blue-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.name}</span>
                    {t.isOwn ? (
                      <Lock size={10} className="text-muted-foreground" />
                    ) : (
                      <Globe size={10} className="text-accent" />
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {t.description || t.category} · {t.stepCount} 步 · 使用 {t.usageCount} 次
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {t.isOwn && (
                    <>
                      <button
                        onClick={() => setEditingId(t.id)}
                        className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                        title="编辑"
                      >
                        <Settings size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        disabled={deleting === t.id}
                        className="rounded p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        title="删除"
                      >
                        {deleting === t.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Trash2 size={13} />
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
