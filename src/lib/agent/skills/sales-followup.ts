/**
 * 销售跟进 Skill — 分析客户状态并生成跟进建议
 *
 * 接收客户 ID（通过 input.customerId），查询客户的
 * 机会、互动历史和报价，生成 AI 跟进策略和邮件草稿。
 */

import { createCompletion } from "@/lib/ai/client";
import { getExpertSystemPrompt } from "@/lib/ai/expert-roles";
import { db } from "@/lib/db";
import { registerSkill } from "./registry";
import type { SkillContext, SkillResult } from "../types";

async function execute(ctx: SkillContext): Promise<SkillResult> {
  const customerId = (ctx.input.customerId as string) || "";
  if (!customerId) {
    return {
      success: false,
      data: {},
      summary: "缺少 customerId",
      error: "缺少 customerId 参数",
    };
  }

  try {
    const customer = await db.salesCustomer.findUnique({
      where: { id: customerId },
      include: {
        opportunities: {
          orderBy: { updatedAt: "desc" },
          take: 5,
        },
        interactions: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { createdBy: { select: { name: true } } },
        },
        quotes: {
          orderBy: { createdAt: "desc" },
          take: 5,
          include: { items: true },
        },
      },
    });

    if (!customer) {
      return {
        success: false,
        data: {},
        summary: "客户不存在",
        error: "未找到客户",
      };
    }

    const contextLines: string[] = [
      `客户: ${customer.name}`,
      `电话: ${customer.phone || "无"}`,
      `邮箱: ${customer.email || "无"}`,
      `地址: ${customer.address || "无"}`,
      `来源: ${customer.source || "未知"}`,
      `状态: ${customer.status}`,
      customer.notes ? `备注: ${customer.notes}` : "",
      "",
      "## 销售机会",
    ];

    for (const opp of customer.opportunities) {
      contextLines.push(
        `- ${opp.title} | 阶段: ${opp.stage} | 优先级: ${opp.priority}` +
        (opp.estimatedValue ? ` | 预估: $${opp.estimatedValue}` : "") +
        (opp.nextFollowupAt ? ` | 下次跟进: ${new Date(opp.nextFollowupAt).toISOString().slice(0, 10)}` : "") +
        ` | 最后更新: ${new Date(opp.updatedAt).toISOString().slice(0, 10)}`
      );
    }

    contextLines.push("", "## 互动历史 (最近10条)");
    for (const int of customer.interactions) {
      contextLines.push(
        `- [${new Date(int.createdAt).toISOString().slice(0, 10)}] ` +
        `${int.type}${int.direction ? ` (${int.direction})` : ""}: ${int.summary}` +
        (int.content ? `\n  ${int.content.slice(0, 200)}` : "")
      );
    }

    contextLines.push("", "## 报价记录");
    for (const q of customer.quotes) {
      const itemSummary = q.items.map((i) => `${i.product}-${i.fabric}`).join(", ");
      contextLines.push(
        `- v${q.version} | 状态: ${q.status} | 总价: $${Number(q.grandTotal).toFixed(2)} | 产品: ${itemSummary} | ${new Date(q.createdAt).toISOString().slice(0, 10)}`
      );
    }

    const expertPrompt = getExpertSystemPrompt("sales_advisor") || "";

    const userPrompt = `以下是一个客户的完整销售资料：

${contextLines.filter(Boolean).join("\n")}

请基于以上信息，生成一份完整的跟进策略：

1. **客户状态评估**：判断客户当前所处阶段、活跃度、成交概率
2. **跟进策略建议**：
   - 推荐的跟进方式（电话/邮件/微信）
   - 跟进时机建议
   - 沟通要点
3. **跟进邮件草稿**（英文，可直接发送给客户）
4. **下一步行动清单**（按优先级排列）
5. **风险提示**（如果有）`;

    const result = await createCompletion({
      systemPrompt: expertPrompt,
      userPrompt,
      mode: "balanced",
    });

    return {
      success: true,
      data: {
        customerId,
        customerName: customer.name,
        analysis: result,
      },
      summary: `为 ${customer.name} 生成了跟进策略和邮件草稿`,
    };
  } catch (err) {
    return {
      success: false,
      data: {},
      summary: "跟进分析失败",
      error: err instanceof Error ? err.message : "未知错误",
    };
  }
}

registerSkill({
  id: "sales_followup",
  name: "销售跟进策略",
  description: "分析客户互动历史、机会状态和报价记录，生成跟进策略和邮件草稿",
  domain: "execution",
  riskLevel: "low",
  requiresApproval: false,
  execute,
  expertRoleId: "sales_advisor",
});
