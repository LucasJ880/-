/**
 * 销售 FAQ API
 *
 * GET  /api/sales/faqs       — 查询 FAQ 列表
 * POST /api/sales/faqs       — 手动创建 FAQ
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const language = url.searchParams.get("language");
  const status = url.searchParams.get("status") || "active";
  const search = url.searchParams.get("q");

  const faqs = await db.salesFAQ.findMany({
    where: {
      userId: user.id,
      ...(category ? { category } : {}),
      ...(language ? { language } : {}),
      status,
      ...(search
        ? {
            OR: [
              { question: { contains: search, mode: "insensitive" } },
              { answer: { contains: search, mode: "insensitive" } },
              { productTags: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ frequency: "desc" }, { createdAt: "desc" }],
    take: 50,
  });

  return NextResponse.json(faqs);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await request.json();

  if (!body.question || !body.answer) {
    return NextResponse.json(
      { error: "缺少必填字段: question, answer" },
      { status: 400 }
    );
  }

  const faq = await db.salesFAQ.create({
    data: {
      userId: user.id,
      question: body.question,
      answer: body.answer,
      language: body.language || "zh",
      category: body.category || "other",
      categoryLabel: body.categoryLabel || "其他",
      productTags: body.productTags || null,
      frequency: 1,
      status: "active",
    },
  });

  return NextResponse.json(faq, { status: 201 });
}
