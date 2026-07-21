/**
 * 组织通用知识库工具 — 数字员工检索平台真相源
 */

import { registry } from "../tool-registry";
import type { ToolExecutionContext } from "../types";
import {
  formatOrgKnowledgeHits,
  searchOrgKnowledge,
} from "@/lib/knowledge/org-knowledge";
import { db } from "@/lib/db";

async function assertOrgAccess(ctx: ToolExecutionContext) {
  if (ctx.hasMembership === true) return null;
  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } },
    select: { status: true },
  });
  if (membership?.status !== "active") {
    return {
      success: false as const,
      data: null,
      error: "无权访问该组织知识库（需要企业成员身份）",
    };
  }
  return null;
}

registry.register({
  name: "org_search_knowledge",
  description:
    "在当前组织的通用知识库中向量/关键词检索（含 Markdown/Obsidian 导入内容）。只读；不修改知识库、不访问本地 Obsidian。",
  domain: "system",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "检索问题或关键词" },
      category: { type: "string", description: "可选分类过滤" },
      limit: { type: "number", description: "返回条数，默认 8" },
    },
    required: ["query"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const denied = await assertOrgAccess(ctx);
    if (denied) return denied;
    const query = String(ctx.args.query || "").trim();
    if (!query) {
      return { success: false, data: null, error: "query 不能为空" };
    }
    const result = await searchOrgKnowledge({
      orgId: ctx.orgId,
      query,
      category:
        typeof ctx.args.category === "string" ? ctx.args.category : undefined,
      limit: typeof ctx.args.limit === "number" ? ctx.args.limit : 8,
    });
    return {
      success: true,
      data: {
        mode: result.mode,
        hits: result.hits,
        context: formatOrgKnowledgeHits(result.hits),
      },
    };
  },
});
