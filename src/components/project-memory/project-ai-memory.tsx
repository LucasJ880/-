"use client";

import { useEffect, useState } from "react";
import {
  Brain,
  Loader2,
  Mail,
  FileQuestion,
  Sparkles,
  Package,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface AiActionRecord {
  action: string;
  target: string;
  detail: string;
  date: string;
}

interface EmailRecord {
  to: string;
  subject: string;
  status: string;
  date: string;
}

interface SupplierInteraction {
  name: string;
  status: string;
  lastContact: string;
  hasQuoted: boolean;
}

interface QuestionRecord {
  title: string;
  status: string;
  recipient: string | null;
  date: string;
}

interface ProjectAiMemory {
  recentAiActions: AiActionRecord[];
  emailHistory: EmailRecord[];
  supplierInteractions: SupplierInteraction[];
  questionHistory: QuestionRecord[];
  summary: string;
}

const STATUS_LABELS: Record<string, string> = {
  sent: "已发送",
  draft: "草稿",
  pending: "待处理",
  contacted: "已联系",
  quoted: "已报价",
  declined: "已谢绝",
};

export function ProjectAiMemory({ projectId }: { projectId: string }) {
  const [memory, setMemory] = useState<ProjectAiMemory | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/memory`);
      if (res.ok) setMemory(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const isEmpty =
    !memory ||
    (memory.recentAiActions.length === 0 &&
      memory.emailHistory.length === 0 &&
      memory.questionHistory.length === 0 &&
      memory.supplierInteractions.length === 0);

  if (!expanded && isEmpty && !loading) return null;

  const toggleSection = (key: string) =>
    setActiveSection((prev) => (prev === key ? null : key));

  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium">AI 记忆</span>
          {memory && !isEmpty && (
            <span className="text-xs text-muted ml-1">
              {memory.recentAiActions.length} 条历史
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/40 px-4 pb-4">
          {loading && !memory ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载 AI 记忆…
            </div>
          ) : isEmpty ? (
            <div className="py-6 text-center text-sm text-muted">
              AI 尚未为该项目执行过操作，暂无记忆数据
            </div>
          ) : (
            <>
              <div className="mt-3 rounded-md bg-[rgba(43,96,85,0.06)] px-3 py-2 text-xs text-foreground/80">
                {memory!.summary}
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-muted">
                  以下信息会自动注入 AI 对话上下文
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); load(); }}
                  className="flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
                  刷新
                </button>
              </div>

              <div className="mt-2 space-y-1">
                {memory!.recentAiActions.length > 0 && (
                  <MemorySection
                    title="AI 操作记录"
                    icon={<Sparkles className="h-3.5 w-3.5" />}
                    count={memory!.recentAiActions.length}
                    open={activeSection === "actions"}
                    onToggle={() => toggleSection("actions")}
                  >
                    {memory!.recentAiActions.map((a, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs py-1">
                        <span className="text-muted whitespace-nowrap">{a.date}</span>
                        <span>
                          {a.action}了{a.target}
                          {a.detail && (
                            <span className="text-muted ml-1">— {a.detail}</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </MemorySection>
                )}

                {memory!.emailHistory.length > 0 && (
                  <MemorySection
                    title="邮件记录"
                    icon={<Mail className="h-3.5 w-3.5" />}
                    count={memory!.emailHistory.length}
                    open={activeSection === "emails"}
                    onToggle={() => toggleSection("emails")}
                  >
                    {memory!.emailHistory.map((e, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs py-1">
                        <span className="text-muted whitespace-nowrap">{e.date}</span>
                        <span className="truncate">
                          → {e.to}
                          <span className="text-muted ml-1">| {e.subject}</span>
                        </span>
                        <StatusBadge status={e.status} />
                      </div>
                    ))}
                  </MemorySection>
                )}

                {memory!.questionHistory.length > 0 && (
                  <MemorySection
                    title="问题邮件"
                    icon={<FileQuestion className="h-3.5 w-3.5" />}
                    count={memory!.questionHistory.length}
                    open={activeSection === "questions"}
                    onToggle={() => toggleSection("questions")}
                  >
                    {memory!.questionHistory.map((q, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs py-1">
                        <span className="text-muted whitespace-nowrap">{q.date}</span>
                        <span className="truncate">{q.title}</span>
                        <StatusBadge status={q.status} />
                      </div>
                    ))}
                  </MemorySection>
                )}

                {memory!.supplierInteractions.length > 0 && (
                  <MemorySection
                    title="供应商互动"
                    icon={<Package className="h-3.5 w-3.5" />}
                    count={memory!.supplierInteractions.length}
                    open={activeSection === "suppliers"}
                    onToggle={() => toggleSection("suppliers")}
                  >
                    <div className="flex flex-wrap gap-1.5 py-1">
                      {memory!.supplierInteractions.map((s, i) => (
                        <span
                          key={i}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                            s.hasQuoted
                              ? "bg-[rgba(46,122,86,0.1)] text-[#2e7a56]"
                              : "bg-[rgba(110,125,118,0.08)] text-muted"
                          )}
                        >
                          {s.name}
                          <span className="text-[10px]">
                            ({STATUS_LABELS[s.status] ?? s.status})
                          </span>
                        </span>
                      ))}
                    </div>
                  </MemorySection>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MemorySection({
  title,
  icon,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border/40">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/5"
      >
        <span className="text-accent">{icon}</span>
        <span className="font-medium flex-1">{title}</span>
        <span className="text-muted">{count}</span>
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted" />
        )}
      </button>
      {open && <div className="border-t border-border/30 px-3 pb-2">{children}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;
  const color =
    status === "sent"
      ? "text-[#2e7a56] bg-[rgba(46,122,86,0.08)]"
      : status === "quoted"
        ? "text-accent bg-[rgba(43,96,85,0.08)]"
        : "text-muted bg-[rgba(110,125,118,0.06)]";

  return (
    <span className={cn("ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px]", color)}>
      {label}
    </span>
  );
}
