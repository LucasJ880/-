/**
 * 知识提取 API
 *
 * POST /api/sales/knowledge/extract
 *
 * 从客户互动中提取话术模板和 FAQ
 * 支持：
 * - interactionId: 从单条互动提取
 * - customerId: 从客户的所有互动批量提取
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import {
  extractKnowledgeFromInteraction,
  extractKnowledgeFromCustomer,
} from "@/lib/ai/knowledge-extractor";

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();

  if (body.interactionId) {
    const result = await extractKnowledgeFromInteraction(
      body.interactionId,
      user.id
    );
    return NextResponse.json({
      source: "interaction",
      interactionId: body.interactionId,
      playbooks: result.playbooks.length,
      faqs: result.faqs.length,
      data: result,
    });
  }

  if (body.customerId) {
    const result = await extractKnowledgeFromCustomer(
      body.customerId,
      user.id
    );
    return NextResponse.json({
      source: "customer",
      customerId: body.customerId,
      totalPlaybooks: result.totalPlaybooks,
      totalFaqs: result.totalFaqs,
    });
  }

  return NextResponse.json(
    { error: "需提供 interactionId 或 customerId" },
    { status: 400 }
  );
});
