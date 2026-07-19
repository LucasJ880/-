/**
 * 企业项目规则：从已确认复盘/Insight 提出草案，人工确认后生效
 */

import { db } from "@/lib/db";

export type RuleCategory =
  | "price"
  | "tech"
  | "qualification"
  | "execution"
  | "competition"
  | "general";

/** 供单测与提案逻辑共用 */
export function categorizeTag(tag: string): RuleCategory {
  const t = tag.toLowerCase();
  if (/价格|报价|毛利|成本|溢价|运费/.test(t)) return "price";
  if (/认证|规格|技术|样品|测试/.test(t)) return "tech";
  if (/canadian|资格|bond|保险|site visit|制造商/.test(t)) return "qualification";
  if (/提交|文件|addendum|供应商回复|表格/.test(t)) return "execution";
  if (/竞争|竞品|现有供应商|指定品牌/.test(t)) return "competition";
  return "general";
}

/** 复盘确认后：按原因标签提出规则草案（不自动 active） */
export async function proposeRulesFromConfirmedReview(input: {
  orgId: string | null | undefined;
  projectId: string;
  reviewId: string;
  outcome: string | null;
  reasonTags: string[];
  narrative: string | null;
  priceSummary?: string | null;
}) {
  if (!input.orgId) return [];
  if (!input.reasonTags.length && !input.narrative) return [];

  const created: string[] = [];
  const tags = input.reasonTags.slice(0, 6);

  for (const tag of tags) {
    const category = categorizeTag(tag);
    const title =
      input.outcome === "lost" || input.outcome === "no_bid"
        ? `避免重复失败：${tag}`
        : `复用经验：${tag}`;
    const content = [
      `来源项目复盘（outcome=${input.outcome || "unknown"}）。`,
      `规则要点：${tag}`,
      input.priceSummary ? `价格参考：${input.priceSummary}` : "",
      input.narrative ? `背景：${input.narrative.slice(0, 400)}` : "",
      "注意：需人工确认后才成为企业生效规则；不得无提示复制到新项目。",
    ]
      .filter(Boolean)
      .join("\n");

    // 同 org + 同标题 已有 proposed/active 则跳过
    const exists = await db.organizationProjectRule.findFirst({
      where: {
        orgId: input.orgId,
        title,
        status: { in: ["proposed", "active"] },
      },
      select: { id: true },
    });
    if (exists) continue;

    const row = await db.organizationProjectRule.create({
      data: {
        orgId: input.orgId,
        title,
        content,
        category,
        status: "proposed",
        sourceProjectId: input.projectId,
        sourceReviewId: input.reviewId,
        evidenceJson: JSON.stringify({
          outcome: input.outcome,
          tag,
          at: new Date().toISOString(),
        }),
      },
      select: { id: true },
    });
    created.push(row.id);
  }

  return created;
}

export async function listOrgProjectRules(input: {
  orgId: string;
  status?: string;
  sourceProjectId?: string;
  limit?: number;
}) {
  return db.organizationProjectRule.findMany({
    where: {
      orgId: input.orgId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.sourceProjectId
        ? { sourceProjectId: input.sourceProjectId }
        : {}),
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: Math.min(input.limit ?? 50, 100),
  });
}

/** 本项目提出的企业规则（不限 org 传入，按 sourceProjectId） */
export async function listRulesSourcedFromProject(projectId: string) {
  return db.organizationProjectRule.findMany({
    where: { sourceProjectId: projectId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 30,
    select: {
      id: true,
      orgId: true,
      title: true,
      content: true,
      category: true,
      status: true,
      sourceReviewId: true,
      confirmedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function decideOrgProjectRule(input: {
  ruleId: string;
  orgId: string;
  userId: string;
  decision: "activate" | "reject" | "archive";
}) {
  const rule = await db.organizationProjectRule.findFirst({
    where: { id: input.ruleId, orgId: input.orgId },
  });
  if (!rule) throw new Error("规则不存在");

  const status =
    input.decision === "activate"
      ? "active"
      : input.decision === "reject"
        ? "rejected"
        : "archived";

  return db.organizationProjectRule.update({
    where: { id: rule.id },
    data: {
      status,
      ...(input.decision === "activate"
        ? { confirmedAt: new Date(), confirmedById: input.userId }
        : {}),
    },
  });
}

/** 注入聊天/分析：仅 active 规则 */
export async function buildActiveOrgRulesBlock(orgId: string | null | undefined) {
  if (!orgId) return "";
  const rules = await db.organizationProjectRule.findMany({
    where: { orgId, status: "active" },
    orderBy: { confirmedAt: "desc" },
    take: 20,
    select: { title: true, content: true, category: true },
  });
  if (!rules.length) return "";
  return [
    "【企业已确认项目规则】",
    ...rules.map(
      (r) => `- [${r.category}] ${r.title}: ${r.content.slice(0, 220)}`,
    ),
  ].join("\n");
}
