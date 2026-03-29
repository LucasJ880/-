"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Bot,
  Workflow,
  Play,
  ShieldCheck,
  LayoutDashboard,
  Settings,
  ChevronRight,
  ChevronLeft,
  X,
  Lightbulb,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "qingyan_agent_guide_seen";

interface GuideStep {
  icon: React.ElementType;
  iconColor: string;
  title: string;
  description: string;
  tips: string[];
  visual?: "create" | "execute" | "approve" | "template" | "dashboard";
}

const GUIDE_STEPS: GuideStep[] = [
  {
    icon: Bot,
    iconColor: "text-blue-500 bg-blue-500/10",
    title: "什么是 AI 任务？",
    description:
      "AI 任务是青砚的自动化工作流。你描述一个目标（如「准备投标报价」），AI 会自动拆解成多个步骤，依次执行，关键节点等你审批。",
    tips: [
      "AI 不会直接修改你的正式数据",
      "高风险操作必须经过你的确认",
      "每一步都有执行记录可追溯",
    ],
    visual: "create",
  },
  {
    icon: Workflow,
    iconColor: "text-accent bg-accent/10",
    title: "两种创建方式",
    description:
      "你可以从预设模板或自定义模板中选择一个流程，一键启动；也可以用自然语言描述你的需求，AI 自动规划步骤。",
    tips: [
      "预设模板：「项目巡检」「投标报价准备」，适合常规场景",
      "自定义模板：你可以自由组合技能，保存为模板反复使用",
      "自由描述：AI 根据你的意图智能编排步骤",
    ],
    visual: "template",
  },
  {
    icon: Play,
    iconColor: "text-emerald-500 bg-emerald-500/10",
    title: "执行与审批",
    description:
      "任务创建后自动执行。遇到中/高风险步骤时会暂停，等待你审批。你可以查看 AI 的分析结果，选择「确认执行」或「驳回」。",
    tips: [
      "低风险步骤（如读取数据、分析）自动执行",
      "中风险步骤（如修改报价）需要你确认",
      "高风险步骤（如发送邮件）必须授权",
      "审批有倒计时，超时会自动升级提醒",
    ],
    visual: "approve",
  },
  {
    icon: LayoutDashboard,
    iconColor: "text-violet-500 bg-violet-500/10",
    title: "查看结果与巡检",
    description:
      "任务完成后，可以展开查看每一步的详情。系统还支持定时自动巡检，每天检查活跃项目并在仪表盘展示结果。",
    tips: [
      "点击任务行可展开步骤时间线",
      "每一步显示 AI 输出摘要和检查报告",
      "仪表盘的「自动巡检」卡片显示最近巡检记录",
    ],
    visual: "dashboard",
  },
  {
    icon: Settings,
    iconColor: "text-orange-500 bg-orange-500/10",
    title: "自定义你的流程",
    description:
      "点击标题栏的齿轮图标进入模板管理，你可以创建自己的自动化流程模板：选择步骤、设置风险等级、决定哪些步骤需要审批。",
    tips: [
      "模板可设为「对团队可见」共享给其他成员",
      "创建任务时会同时显示预设和自定义模板",
      "使用次数会自动统计，帮你评估模板价值",
    ],
    visual: "template",
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreateTask?: () => void;
}

export function AgentTaskGuide({ open, onClose, onCreateTask }: Props) {
  const [step, setStep] = useState(0);

  const handleClose = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {}
    onClose();
  }, [onClose]);

  const handleNext = useCallback(() => {
    if (step < GUIDE_STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      handleClose();
    }
  }, [step, handleClose]);

  const handlePrev = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  if (!open) return null;

  const current = GUIDE_STEPS[step];
  const Icon = current.icon;
  const isLast = step === GUIDE_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl">
        {/* 顶部进度 */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-1.5">
            {GUIDE_STEPS.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1 rounded-full transition-all duration-300",
                  i === step ? "w-6 bg-accent" : i < step ? "w-3 bg-accent/40" : "w-3 bg-border"
                )}
              />
            ))}
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-muted/30 transition-colors"
          >
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-6 pb-2 pt-3">
          {/* 图标 + 标题 */}
          <div className="flex items-center gap-3 mb-3">
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", current.iconColor)}>
              <Icon size={20} />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                步骤 {step + 1} / {GUIDE_STEPS.length}
              </div>
              <h3 className="text-base font-semibold text-foreground">{current.title}</h3>
            </div>
          </div>

          {/* 描述 */}
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">{current.description}</p>

          {/* 视觉示意 */}
          <StepVisual type={current.visual} />

          {/* 要点 */}
          <div className="mt-4 space-y-1.5">
            {current.tips.map((tip, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <Lightbulb size={11} className="mt-0.5 shrink-0 text-amber-500" />
                <span className="text-foreground/80">{tip}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between border-t border-border/30 px-5 py-3 mt-3">
          <button
            onClick={handlePrev}
            disabled={step === 0}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={14} />
            上一步
          </button>

          <div className="flex items-center gap-2">
            {isLast && onCreateTask && (
              <button
                onClick={() => {
                  handleClose();
                  onCreateTask();
                }}
                className="flex items-center gap-1.5 rounded-lg bg-blue-500/10 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-500/20 transition-colors"
              >
                <Sparkles size={13} />
                立即试试
              </button>
            )}
            <button
              onClick={handleNext}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
            >
              {isLast ? "完成" : "下一步"}
              {!isLast && <ChevronRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 检查用户是否已看过指引
 */
export function hasSeenGuide(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * 重置指引状态（调试用）
 */
export function resetGuide(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function StepVisual({ type }: { type?: string }) {
  if (type === "create") {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-2 w-2 rounded-full bg-blue-500" />
          <div className="h-2 w-16 rounded bg-foreground/15" />
          <div className="ml-auto h-5 w-14 rounded bg-blue-500/20 flex items-center justify-center">
            <span className="text-[8px] text-blue-600 font-medium">+ 新建</span>
          </div>
        </div>
        <div className="space-y-1.5 pl-4">
          <FlowStep label="1. 项目分析" status="done" />
          <FlowStep label="2. 生成报价草稿" status="active" />
          <FlowStep label="3. 风险审查" status="pending" />
          <FlowStep label="4. 输出报价单" status="pending" />
        </div>
      </div>
    );
  }

  if (type === "approve") {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck size={13} className="text-amber-500" />
          <span className="text-xs font-medium">待审批：生成报价草稿</span>
          <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-600">中风险</span>
        </div>
        <p className="text-[10px] text-muted-foreground mb-2">
          AI 已生成 12 项报价行项目，总金额 ¥284,500，建议利润率 18%
        </p>
        <div className="flex gap-2">
          <div className="h-6 rounded bg-emerald-500/20 px-2 flex items-center">
            <span className="text-[9px] text-emerald-600 font-medium">✓ 确认执行</span>
          </div>
          <div className="h-6 rounded border border-red-500/30 px-2 flex items-center">
            <span className="text-[9px] text-red-500">✕ 驳回</span>
          </div>
        </div>
      </div>
    );
  }

  if (type === "template") {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-1.5">
        <div className="flex items-center gap-2 rounded border border-accent/30 bg-accent/5 px-2.5 py-1.5">
          <Sparkles size={11} className="text-accent" />
          <span className="text-[10px] font-medium">投标报价准备</span>
          <span className="ml-auto text-[8px] text-muted-foreground">预设 · 4 步</span>
        </div>
        <div className="flex items-center gap-2 rounded border border-border/40 px-2.5 py-1.5">
          <Workflow size={11} className="text-blue-500" />
          <span className="text-[10px] font-medium">供应商催促流程</span>
          <span className="ml-auto text-[8px] text-muted-foreground">自定义 · 3 步</span>
        </div>
        <div className="flex items-center gap-2 rounded border border-dashed border-border/40 px-2.5 py-1.5">
          <span className="text-[10px] text-muted-foreground">+ 自由描述你的需求...</span>
        </div>
      </div>
    );
  }

  if (type === "dashboard") {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
        <div className="flex items-center gap-2 mb-2">
          <LayoutDashboard size={12} className="text-violet-500" />
          <span className="text-[10px] font-semibold">自动巡检</span>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="text-[9px]">项目 A — 正常</span>
            <span className="ml-auto text-[8px] text-muted-foreground">今天 08:00</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-red-500" />
            <span className="text-[9px]">项目 B — 2 项异常</span>
            <span className="ml-auto text-[8px] text-muted-foreground">今天 08:00</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="text-[9px]">项目 C — 正常</span>
            <span className="ml-auto text-[8px] text-muted-foreground">今天 08:00</span>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function FlowStep({ label, status }: { label: string; status: "done" | "active" | "pending" }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "done" ? "bg-emerald-500" : status === "active" ? "bg-blue-500 animate-pulse" : "bg-border"
        )}
      />
      <span
        className={cn(
          "text-[10px]",
          status === "done"
            ? "text-emerald-600"
            : status === "active"
            ? "text-blue-600 font-medium"
            : "text-muted-foreground"
        )}
      >
        {label}
      </span>
      {status === "done" && <span className="text-[8px] text-emerald-500">✓</span>}
      {status === "active" && <span className="text-[8px] text-blue-500">执行中...</span>}
    </div>
  );
}
