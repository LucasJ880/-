import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit/logger";
import { db } from "@/lib/db";
import { requireTenantContext } from "@/lib/tenancy";
import { verifyUnlockCode } from "@/lib/blinds/unlock-code";

const TARGET_TYPE = "quote_discount_settings";

interface DiscountLogBody {
  before?: Record<string, number> | null;
  after?: Record<string, number> | null;
  code?: string;
}

/**
 * POST — 客户端折扣变更审计（校验当前企业行折扣解锁码哈希）
 */
export async function POST(request: Request) {
  const tenant = await requireTenantContext(request as import("next/server").NextRequest);
  if (tenant instanceof NextResponse) return tenant;

  const body = (await request.json().catch(() => null)) as DiscountLogBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const row = await db.quoteDiscountSettings.findUnique({
    where: { orgId: tenant.orgId },
    select: { lineDiscountUnlockCodeHash: true },
  });
  const matched = await verifyUnlockCode(code, row?.lineDiscountUnlockCodeHash);
  if (!matched) {
    return NextResponse.json({ error: "Invalid code" }, { status: 403 });
  }

  const before = normalizeDiscountMap(body.before);
  const after = normalizeDiscountMap(body.after);

  const diff: Record<string, { from: number | null; to: number | null }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const b = before[k] ?? null;
    const a = after[k] ?? null;
    if (b !== a) diff[k] = { from: b, to: a };
  }

  if (Object.keys(diff).length === 0) {
    return NextResponse.json({ ok: true, changed: false });
  }

  await logAudit({
    userId: tenant.userId,
    orgId: tenant.orgId,
    action: "update",
    targetType: TARGET_TYPE,
    beforeData: { discounts: before },
    afterData: { discounts: after, diff },
    request: request as import("next/server").NextRequest,
  });

  return NextResponse.json({ ok: true, changed: true, diff });
}

export async function GET(request: Request) {
  const tenant = await requireTenantContext(request as import("next/server").NextRequest);
  if (tenant instanceof NextResponse) return tenant;

  if (tenant.orgRole !== "org_admin") {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10) || 20),
  );

  const where = {
    targetType: TARGET_TYPE,
    orgId: tenant.orgId,
  } as const;

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
    }),
  ]);

  const items = rows.map((r) => {
    const before = safeParseJson(r.beforeData);
    const after = safeParseJson(r.afterData);
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      user: r.user
        ? { id: r.user.id, name: r.user.name, email: r.user.email, avatar: r.user.avatar }
        : null,
      ip: r.ip,
      userAgent: r.userAgent,
      before: (before as { discounts?: Record<string, number> } | null)?.discounts ?? null,
      after: (after as { discounts?: Record<string, number> } | null)?.discounts ?? null,
      diff:
        (after as { diff?: Record<string, { from: number | null; to: number | null }> } | null)
          ?.diff ?? null,
    };
  });

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

function normalizeDiscountMap(
  raw: Record<string, number> | null | undefined,
): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0 && n <= 1) {
      out[k] = Math.round(n * 10000) / 10000;
    }
  }
  return out;
}

function safeParseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
