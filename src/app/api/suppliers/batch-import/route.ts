/**
 * 供应商批量导入 API
 *
 * POST /api/suppliers/batch-import
 *
 * 支持两种模式：
 * 1. structured: 直接传 JSON 数组
 * 2. text: 传原始文本（名片/展会笔记/微信记录），AI 解析后导入
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { createSupplier } from "@/lib/supplier/service";
import { parseSupplierFromText, classifySupplier } from "@/lib/supplier/classifier";
import type { CreateSupplierInput } from "@/lib/inquiry/types";

interface BatchImportBody {
  orgId: string;
  source?: string;
  sourceDetail?: string;
  mode: "structured" | "text";
  suppliers?: Partial<CreateSupplierInput>[];
  rawText?: string;
  autoClassify?: boolean;
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body: BatchImportBody = await request.json();

  if (!body.orgId) {
    return NextResponse.json({ error: "缺少 orgId" }, { status: 400 });
  }

  let suppliersToCreate: Partial<CreateSupplierInput>[] = [];

  if (body.mode === "text") {
    if (!body.rawText?.trim()) {
      return NextResponse.json({ error: "缺少 rawText" }, { status: 400 });
    }
    const parsed = await parseSupplierFromText(body.rawText);
    if (parsed.length === 0) {
      return NextResponse.json(
        { error: "未能从文本中识别出供应商信息，请检查内容格式" },
        { status: 400 }
      );
    }
    suppliersToCreate = parsed.map((p) => ({
      name: p.name,
      contactName: p.contactName ?? undefined,
      contactEmail: p.contactEmail ?? undefined,
      contactPhone: p.contactPhone ?? undefined,
      category: p.category ?? undefined,
      region: p.region ?? undefined,
      website: p.website ?? undefined,
      notes: p.notes ?? undefined,
    }));
  } else {
    if (!body.suppliers || body.suppliers.length === 0) {
      return NextResponse.json(
        { error: "suppliers 数组不能为空" },
        { status: 400 }
      );
    }
    suppliersToCreate = body.suppliers;
  }

  const results: { name: string; id: string; status: "created" | "failed"; error?: string }[] = [];
  const createdIds: string[] = [];

  for (const item of suppliersToCreate) {
    const name = item.name?.trim();
    if (!name) {
      results.push({ name: "未知", id: "", status: "failed", error: "名称为空" });
      continue;
    }

    try {
      const supplier = await createSupplier(
        {
          orgId: body.orgId,
          name,
          contactName: item.contactName,
          contactEmail: item.contactEmail,
          contactPhone: item.contactPhone,
          category: item.category,
          region: item.region,
          notes: item.notes,
          website: item.website,
          source: item.source || body.source || null,
          sourceDetail: item.sourceDetail || body.sourceDetail || null,
        } as CreateSupplierInput,
        auth.user.id
      );
      results.push({ name, id: supplier.id, status: "created" });
      createdIds.push(supplier.id);
    } catch (err) {
      results.push({
        name,
        id: "",
        status: "failed",
        error: err instanceof Error ? err.message : "创建失败",
      });
    }
  }

  const created = results.filter((r) => r.status === "created").length;
  const failed = results.filter((r) => r.status === "failed").length;

  if (body.autoClassify !== false && createdIds.length > 0) {
    classifyBatchAsync(createdIds);
  }

  return NextResponse.json({
    total: results.length,
    created,
    failed,
    results,
  });
}

function classifyBatchAsync(ids: string[]) {
  (async () => {
    for (const id of ids) {
      try {
        await classifySupplier(id);
      } catch {
        // non-critical
      }
    }
  })();
}
