"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  GripVertical,
  Trash2,
  ChevronDown,
  ChevronRight,
  Save,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  Shield,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiJson } from "@/lib/api-fetch";

interface SkillOption {
  id: string;
  name: string;
  domain: string;
  description: string;
  riskLevel: string;
  requiresApproval: boolean;
}

interface StepDraft {
  _key: string;
  skillId: string;
  title: string;
  description: string;
  riskLevel: "low" | "medium" | "high";
  requiresApproval: boolean;
}

interface TemplateDraft {
  name: string;
  description: string;
  icon: string;
  category: string;
  isPublic: boolean;
  steps: StepDraft[];
}

interface Props {
  templateId?: string;
  onSaved: () => void;
  onCancel: () => void;
}

const RISK_OPTIONS = [
  { value: "low", label: "低", color: "text-green-600 bg-green-500/10" },
  { value: "medium", label: "中", color: "text-amber-600 bg-amber-500/10" },
  { value: "high", label: "高", color: "text-red-600 bg-red-500/10" },
] as const;

const CATEGORY_OPTIONS = [
  { value: "custom", label: "自定义" },
  { value: "quote", label: "报价" },
  { value: "bid", label: "投标" },
  { value: "inspection", label: "巡检" },
  { value: "followup", label: "跟进" },
];

let stepCounter = 0;
function newStepKey() {
  return `step_${++stepCounter}_${Date.now()}`;
}

export function TemplateEditor({ templateId, onSaved, onCancel }: Props) {
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateDraft>({
    name: "",
    description: "",
    icon: "",
    category: "custom",
    isPublic: false,
    steps: [],
  });

  useEffect(() => {
    const loadData = async () => {
      try {
        const { skills: s } = await apiJson<{ skills: SkillOption[] }>("/api/agent/skills");
        setSkills(s);

        if (templateId) {
          const { template } = await apiJson<{ template: { name: string; description: string; icon: string; category: string; isPublic: boolean; steps: Array<Omit<StepDraft, "_key">> } }>(
            `/api/agent/templates/${templateId}`
          );
          setDraft({
            name: template.name,
            description: template.description ?? "",
            icon: template.icon ?? "",
            category: template.category,
            isPublic: template.isPublic,
            steps: (template.steps ?? []).map((s) => ({ ...s, _key: newStepKey() })),
          });
        }
      } catch {}
      setLoading(false);
    };
    loadData();
  }, [templateId]);

  const addStep = useCallback(() => {
    const firstSkill = skills[0];
    const newStep: StepDraft = {
      _key: newStepKey(),
      skillId: firstSkill?.id ?? "",
      title: "",
      description: "",
      riskLevel: firstSkill?.riskLevel as "low" | "medium" | "high" ?? "low",
      requiresApproval: firstSkill?.requiresApproval ?? false,
    };
    setDraft((d) => ({ ...d, steps: [...d.steps, newStep] }));
    setExpandedStep(newStep._key);
  }, [skills]);

  const updateStep = useCallback((key: string, patch: Partial<StepDraft>) => {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s) => (s._key === key ? { ...s, ...patch } : s)),
    }));
  }, []);

  const removeStep = useCallback((key: string) => {
    setDraft((d) => ({
      ...d,
      steps: d.steps.filter((s) => s._key !== key),
    }));
  }, []);

  const moveStep = useCallback((key: string, dir: -1 | 1) => {
    setDraft((d) => {
      const idx = d.steps.findIndex((s) => s._key === key);
      if (idx < 0) return d;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= d.steps.length) return d;
      const arr = [...d.steps];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return { ...d, steps: arr };
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft.name.trim() || draft.steps.length === 0) return;

    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        icon: draft.icon.trim() || undefined,
        category: draft.category,
        isPublic: draft.isPublic,
        steps: draft.steps.map(({ _key, ...rest }) => rest),
      };

      if (templateId) {
        await apiFetch(`/api/agent/templates/${templateId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch("/api/agent/templates", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } catch {}
    setSaving(false);
  }, [draft, templateId, onSaved]);

  const handleSkillChange = useCallback((key: string, skillId: string) => {
    const skill = skills.find((s) => s.id === skillId);
    updateStep(key, {
      skillId,
      title: skill?.name ?? "",
      riskLevel: (skill?.riskLevel as "low" | "medium" | "high") ?? "low",
      requiresApproval: skill?.requiresApproval ?? false,
    });
  }, [skills, updateStep]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const canSave = draft.name.trim().length > 0 && draft.steps.length > 0 && draft.steps.every((s) => s.skillId && s.title.trim());

  return (
    <div className="space-y-5">
      {/* 头部 */}
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="p-1 hover:bg-muted/30 rounded">
          <ArrowLeft size={16} className="text-muted-foreground" />
        </button>
        <h3 className="text-base font-semibold">
          {templateId ? "编辑模板" : "创建自定义模板"}
        </h3>
      </div>

      {/* 基础信息 */}
      <div className="space-y-3 rounded-lg border border-border/50 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">模板名称 *</label>
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="例如：供应商催促流程"
            className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">描述</label>
          <textarea
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            placeholder="简要说明模板用途"
            rows={2}
            className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">分类</label>
            <select
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={draft.isPublic}
                onChange={(e) => setDraft((d) => ({ ...d, isPublic: e.target.checked }))}
                className="rounded"
              />
              <span className="text-xs">对团队可见</span>
            </label>
          </div>
        </div>
      </div>

      {/* 步骤列表 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold">
            步骤 ({draft.steps.length})
          </h4>
          <button
            onClick={addStep}
            className="flex items-center gap-1 rounded-md bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
          >
            <Plus size={12} />
            添加步骤
          </button>
        </div>

        {draft.steps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/50 px-4 py-8 text-center text-sm text-muted-foreground">
            暂无步骤，点击「添加步骤」开始构建流程
          </div>
        ) : (
          <div className="space-y-2">
            {draft.steps.map((step, idx) => {
              const isExpanded = expandedStep === step._key;
              const skill = skills.find((s) => s.id === step.skillId);
              const RiskIcon = step.riskLevel === "high" ? ShieldAlert : step.riskLevel === "medium" ? AlertTriangle : Shield;

              return (
                <div
                  key={step._key}
                  className="rounded-lg border border-border/50 bg-card"
                >
                  {/* 步骤头 */}
                  <button
                    type="button"
                    onClick={() => setExpandedStep(isExpanded ? null : step._key)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                  >
                    <GripVertical size={14} className="text-muted-foreground/40 shrink-0" />
                    <span className="text-xs text-muted-foreground w-5 shrink-0">
                      {idx + 1}.
                    </span>
                    <span className="text-sm font-medium flex-1 truncate">
                      {step.title || "（未命名）"}
                    </span>
                    {skill && (
                      <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted/30">
                        {skill.domain}
                      </span>
                    )}
                    <RiskIcon size={12} className={cn(
                      step.riskLevel === "high" ? "text-red-500" :
                      step.riskLevel === "medium" ? "text-amber-500" : "text-green-500"
                    )} />
                    {step.requiresApproval && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-600">
                        需审批
                      </span>
                    )}
                    {isExpanded ? (
                      <ChevronDown size={14} className="text-muted-foreground" />
                    ) : (
                      <ChevronRight size={14} className="text-muted-foreground" />
                    )}
                  </button>

                  {/* 展开详情 */}
                  {isExpanded && (
                    <div className="border-t border-border/30 px-4 py-3 space-y-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">选择技能 *</label>
                        <select
                          value={step.skillId}
                          onChange={(e) => handleSkillChange(step._key, e.target.value)}
                          className="w-full rounded-md border border-border/50 bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                        >
                          <option value="">-- 选择技能 --</option>
                          {skills.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.domain})
                            </option>
                          ))}
                        </select>
                        {skill && (
                          <p className="mt-1 text-[10px] text-muted-foreground">{skill.description}</p>
                        )}
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">步骤标题 *</label>
                        <input
                          value={step.title}
                          onChange={(e) => updateStep(step._key, { title: e.target.value })}
                          placeholder="用户可见的步骤名称"
                          className="w-full rounded-md border border-border/50 bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">说明</label>
                        <input
                          value={step.description}
                          onChange={(e) => updateStep(step._key, { description: e.target.value })}
                          placeholder="可选的步骤说明"
                          className="w-full rounded-md border border-border/50 bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>

                      <div className="flex items-center gap-4">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-muted-foreground">风险等级</label>
                          <div className="flex gap-1">
                            {RISK_OPTIONS.map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => updateStep(step._key, { riskLevel: opt.value })}
                                className={cn(
                                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                                  step.riskLevel === opt.value ? opt.color : "text-muted-foreground bg-muted/20"
                                )}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <label className="flex items-center gap-2 mt-4 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={step.requiresApproval}
                            onChange={(e) => updateStep(step._key, { requiresApproval: e.target.checked })}
                            className="rounded"
                          />
                          <span className="text-xs">需要人工审批</span>
                        </label>
                      </div>

                      {/* 操作栏 */}
                      <div className="flex items-center gap-2 pt-1 border-t border-border/20">
                        {idx > 0 && (
                          <button
                            type="button"
                            onClick={() => moveStep(step._key, -1)}
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            上移
                          </button>
                        )}
                        {idx < draft.steps.length - 1 && (
                          <button
                            type="button"
                            onClick={() => moveStep(step._key, 1)}
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            下移
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeStep(step._key)}
                          className="ml-auto flex items-center gap-1 text-[10px] text-red-500 hover:text-red-600"
                        >
                          <Trash2 size={10} />
                          删除
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-between pt-2 border-t border-border/30">
        <button
          onClick={onCancel}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={!canSave || saving}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {templateId ? "保存修改" : "创建模板"}
        </button>
      </div>
    </div>
  );
}
