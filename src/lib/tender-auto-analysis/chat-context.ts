/**
 * Phase G — Tender 项目会话的 Package 检索范围（复用既有 agent-core runtime）
 *
 * 目标（任务书 §八）：Tender 项目里的对话默认理解 = 当前项目 + 当前 tender package +
 * 当前/最新 package 分析 + 相关来源。不新建第二套聊天系统——只提供一个 grounded 上下文块，
 * 由 conversation/adapter 注入 systemPrompt。
 *
 * Grounded 原则：只注入最新有效 TenderAnalysisRun 的结构化结论；明确要求模型对未覆盖内容
 * 回答"暂无依据"，不得编造。
 */

import { db } from "@/lib/db";
import { isTenderPackageAiExperienceEnabledWithEnv } from "./auto-flags";

const MAX_REQUIREMENTS = 24;
const MAX_CLARIFICATIONS = 10;
const MAX_TOTAL_CHARS = 6000;

const READY_STATUSES = ["REVIEW_REQUIRED", "APPROVED"];

function briefBlock(summaryJson: unknown): {
  buyer: string | null;
  product: string | null;
  blockers: string[];
} {
  const brief =
    summaryJson && typeof summaryJson === "object"
      ? ((summaryJson as Record<string, unknown>).brief as
          | Record<string, unknown>
          | undefined)
      : undefined;
  if (!brief) return { buyer: null, product: null, blockers: [] };
  const asStr = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return {
    buyer: asStr(brief.buyer),
    product: asStr(brief.product),
    blockers: Array.isArray(brief.blockers)
      ? (brief.blockers as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
  };
}

export type TenderContextData = {
  status: string;
  summaryText: string | null;
  summaryJson: unknown;
  requirements: Array<{
    originalRequirement: string;
    mandatory: boolean;
    complianceStatus: string;
  }>;
  clarifications: Array<{ question: string; priority: string }>;
  risksText: string | null;
};

/** 纯函数：把已加载的分析数据格式化为 grounded 上下文块。 */
export function formatTenderPackageContext(
  data: TenderContextData,
): string {
  const b = briefBlock(data.summaryJson);
  const notReady = !READY_STATUSES.includes(data.status);

  const parts: string[] = [];
  parts.push(
    "【本项目招标分析（青砚 Package AI）——请优先基于以下已核实结论回答；未覆盖的内容请明确回答“暂无依据/需人工确认”，不要编造数量/规格/日期/电机/面料/质保/价格等信息】",
  );
  if (notReady) {
    parts.push(`（注意：当前分析状态为 ${data.status}，结论可能不完整或过期。）`);
  }
  if (data.summaryText) parts.push(`项目摘要：${data.summaryText}`);
  if (b.buyer) parts.push(`采购单位：${b.buyer}`);
  if (b.product) parts.push(`产品/服务：${b.product}`);

  if (data.requirements.length > 0) {
    const lines = data.requirements.map(
      (r) =>
        `- ${r.mandatory ? "[强制] " : ""}${r.originalRequirement}${
          r.complianceStatus === "NEEDS_CLARIFICATION" ? "（需澄清）" : ""
        }`,
    );
    parts.push(`关键要求：\n${lines.join("\n")}`);
  }

  if (data.risksText && data.risksText.trim()) {
    parts.push(`风险与冲突：\n${data.risksText.slice(0, 1200)}`);
  }

  if (data.clarifications.length > 0) {
    const lines = data.clarifications.map((c) => `- [${c.priority}] ${c.question}`);
    parts.push(`待澄清问题：\n${lines.join("\n")}`);
  }

  let out = parts.join("\n\n");
  if (out.length > MAX_TOTAL_CHARS) out = out.slice(0, MAX_TOTAL_CHARS) + "…";
  return out;
}

/**
 * 构建 Tender package 上下文块（无有效分析时返回 null → 退回普通会话）。
 * 只在 workDomain==="tender" 或存在 tender 分析 run 的项目生效。
 */
export async function buildTenderPackageContext(
  projectId: string,
): Promise<string | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { workDomain: true, orgId: true },
  });

  // EXPERIENCE 主开关：OFF（生产默认）时绝不注入新 package 上下文，会话保持既有行为。
  if (
    !isTenderPackageAiExperienceEnabledWithEnv({ orgId: project?.orgId ?? null })
  ) {
    return null;
  }

  // 取最新有效分析（就绪优先；否则最新一条，用于说明状态）
  const run =
    (await db.tenderAnalysisRun.findFirst({
      where: { projectId, status: { in: READY_STATUSES } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, summaryText: true, summaryJson: true },
    })) ??
    (await db.tenderAnalysisRun.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, summaryText: true, summaryJson: true },
    }));

  // 非 tender 项目且无任何分析 → 不注入
  if ((project?.workDomain ?? "").toLowerCase() !== "tender" && !run) {
    return null;
  }
  if (!run) return null;

  const [requirements, clarifications, risksSection] = await Promise.all([
    db.tenderExtractedRequirement.findMany({
      where: { analysisRunId: run.id },
      orderBy: [{ mandatory: "desc" }, { createdAt: "asc" }],
      take: MAX_REQUIREMENTS,
      select: {
        requirementCode: true,
        originalRequirement: true,
        mandatory: true,
        complianceStatus: true,
      },
    }),
    db.tenderClarificationQuestion.findMany({
      where: { analysisRunId: run.id, status: "OPEN" },
      orderBy: { createdAt: "asc" },
      take: MAX_CLARIFICATIONS,
      select: { question: true, priority: true },
    }),
    db.tenderAnalysisSection.findFirst({
      where: { runId: run.id, sectionKey: "RISKS" },
      select: { contentZh: true },
    }),
  ]);

  return formatTenderPackageContext({
    status: run.status,
    summaryText: run.summaryText,
    summaryJson: run.summaryJson,
    requirements: requirements.map((r) => ({
      originalRequirement: r.originalRequirement,
      mandatory: r.mandatory,
      complianceStatus: r.complianceStatus,
    })),
    clarifications: clarifications.map((c) => ({
      question: c.question,
      priority: c.priority,
    })),
    risksText: risksSection?.contentZh ?? null,
  });
}
