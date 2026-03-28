/**
 * 项目 AI 记忆 — 从现有数据自动聚合
 *
 * 不新建数据表，而是从 AuditLog、ProjectEmail、ProjectQuestion、
 * InquiryItem 等已有数据中提取 AI 历史行为，让 AI「记住」
 * 它之前为这个项目做过什么。
 */

import { db } from "@/lib/db";
import { formatDateTimeToronto } from "@/lib/time";

export interface ProjectAiMemory {
  recentAiActions: AiActionRecord[];
  emailHistory: EmailRecord[];
  supplierInteractions: SupplierInteraction[];
  questionHistory: QuestionRecord[];
  summary: string;
}

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

const AI_ACTIONS = ["ai_generate", "ai_send", "ai_analyze"];

const ACTION_LABELS: Record<string, string> = {
  ai_generate: "生成",
  ai_send: "发送",
  ai_analyze: "分析",
};

const TARGET_LABELS: Record<string, string> = {
  project_email: "邮件草稿",
  project_question: "问题邮件",
  report: "周报",
  project: "项目摘要",
  quote_analysis: "报价分析",
};

function fmtDate(d: Date): string {
  return formatDateTimeToronto(d).slice(0, 16);
}

export async function getProjectAiMemory(
  projectId: string
): Promise<ProjectAiMemory> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [auditLogs, emails, questions, inquiryItems] = await Promise.all([
    db.auditLog.findMany({
      where: {
        projectId,
        action: { in: AI_ACTIONS },
        createdAt: { gte: since },
      },
      select: {
        action: true,
        targetType: true,
        afterData: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),

    db.projectEmail.findMany({
      where: { projectId },
      select: {
        toEmail: true,
        toName: true,
        subject: true,
        status: true,
        sentAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),

    db.projectQuestion.findMany({
      where: { projectId },
      select: {
        title: true,
        status: true,
        toRecipients: true,
        generatedSubject: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),

    db.inquiryItem.findMany({
      where: { inquiry: { projectId } },
      select: {
        status: true,
        createdAt: true,
        updatedAt: true,
        supplier: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
  ]);

  const recentAiActions: AiActionRecord[] = auditLogs.map((log) => {
    let detail = "";
    try {
      const data = log.afterData ? JSON.parse(log.afterData as string) : {};
      detail = data.subject || data.title || data.supplier || data.type || "";
    } catch { /* skip */ }

    return {
      action: ACTION_LABELS[log.action] ?? log.action,
      target: TARGET_LABELS[log.targetType] ?? log.targetType,
      detail,
      date: fmtDate(log.createdAt),
    };
  });

  const emailHistory: EmailRecord[] = emails.map((e) => ({
    to: e.toName ? `${e.toName} (${e.toEmail})` : e.toEmail,
    subject: e.subject,
    status: e.status,
    date: fmtDate(e.sentAt ?? e.createdAt),
  }));

  const questionHistory: QuestionRecord[] = questions.map((q) => ({
    title: q.title,
    status: q.status,
    recipient: q.toRecipients,
    date: fmtDate(q.createdAt),
  }));

  const supplierMap = new Map<string, SupplierInteraction>();
  for (const item of inquiryItems) {
    const name = item.supplier.name;
    if (!supplierMap.has(name)) {
      supplierMap.set(name, {
        name,
        status: item.status,
        lastContact: fmtDate(item.updatedAt),
        hasQuoted: item.status === "quoted",
      });
    }
  }
  const supplierInteractions = Array.from(supplierMap.values());

  const summary = buildMemorySummary(
    recentAiActions,
    emailHistory,
    questionHistory,
    supplierInteractions
  );

  return {
    recentAiActions,
    emailHistory,
    supplierInteractions,
    questionHistory,
    summary,
  };
}

function buildMemorySummary(
  actions: AiActionRecord[],
  emails: EmailRecord[],
  questions: QuestionRecord[],
  suppliers: SupplierInteraction[]
): string {
  const parts: string[] = [];

  if (actions.length > 0) {
    parts.push(`AI 在过去 30 天内为该项目执行了 ${actions.length} 次操作`);
  }

  const sentEmails = emails.filter((e) => e.status === "sent");
  if (sentEmails.length > 0) {
    parts.push(`已发送 ${sentEmails.length} 封邮件`);
  }

  const sentQuestions = questions.filter((q) => q.status === "sent");
  if (sentQuestions.length > 0) {
    parts.push(`已发送 ${sentQuestions.length} 封问题澄清邮件`);
  }

  const quotedSuppliers = suppliers.filter((s) => s.hasQuoted);
  const pendingSuppliers = suppliers.filter(
    (s) => s.status === "pending" || s.status === "contacted"
  );
  if (suppliers.length > 0) {
    parts.push(
      `涉及 ${suppliers.length} 家供应商，${quotedSuppliers.length} 家已报价，${pendingSuppliers.length} 家待回复`
    );
  }

  return parts.length > 0 ? parts.join("；") + "。" : "暂无 AI 历史记录。";
}

/**
 * 将 AI 记忆格式化为可注入 prompt 的上下文块
 */
export function buildMemoryBlock(memory: ProjectAiMemory): string {
  if (
    memory.recentAiActions.length === 0 &&
    memory.emailHistory.length === 0 &&
    memory.questionHistory.length === 0 &&
    memory.supplierInteractions.length === 0
  ) {
    return "";
  }

  const lines: string[] = ["\n### AI 历史记忆（你之前为这个项目做过的事）"];
  lines.push(`概览：${memory.summary}`);

  if (memory.recentAiActions.length > 0) {
    lines.push("最近 AI 操作：");
    for (const a of memory.recentAiActions.slice(0, 8)) {
      const detail = a.detail ? ` — ${a.detail}` : "";
      lines.push(`- ${a.date} ${a.action}了${a.target}${detail}`);
    }
  }

  if (memory.emailHistory.length > 0) {
    lines.push("邮件记录：");
    for (const e of memory.emailHistory.slice(0, 5)) {
      lines.push(`- ${e.date} → ${e.to} | ${e.subject} [${e.status}]`);
    }
  }

  if (memory.questionHistory.length > 0) {
    lines.push("问题邮件：");
    for (const q of memory.questionHistory.slice(0, 5)) {
      const to = q.recipient ? ` → ${q.recipient}` : "";
      lines.push(`- ${q.date} ${q.title}${to} [${q.status}]`);
    }
  }

  if (memory.supplierInteractions.length > 0) {
    const quoted = memory.supplierInteractions.filter((s) => s.hasQuoted);
    const pending = memory.supplierInteractions.filter(
      (s) => !s.hasQuoted
    );
    if (quoted.length > 0) {
      lines.push(`已报价供应商：${quoted.map((s) => s.name).join("、")}`);
    }
    if (pending.length > 0) {
      lines.push(`待回复供应商：${pending.map((s) => `${s.name}(${s.status})`).join("、")}`);
    }
  }

  lines.push(
    "请在回答时参考以上历史记录，避免重复建议已经做过的事，优先建议下一步行动。"
  );

  return lines.join("\n");
}
