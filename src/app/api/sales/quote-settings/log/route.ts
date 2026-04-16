import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { logAudit } from "@/lib/audit/logger";
import { db } from "@/lib/db";

const SETTINGS_CODE = "sunny2026";
const TARGET_TYPE = "quote_discount_settings";

function isAdmin(role: string): boolean {
  return role === "admin" || role === "super_admin";
}

interface DiscountLogBody {
  before?: Record<string, number> | null;
  after?: Record<string, number> | null;
  code?: string;
}

export const POST = withAuth(async (request, _ctx, user) => {
  const body = (await request.json().catch(() => null)) as DiscountLogBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (body.code !== SETTINGS_CODE) {
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
    userId: user.id,
    action: "update",
    targetType: TARGET_TYPE,
    beforeData: { discounts: before },
    afterData: { discounts: after, diff },
    request,
  });

  return NextResponse.json({ ok: true, changed: true, diff });
});

export const GET = withAuth(async (request, _ctx, user) => {
  if (!isAdmin(user.role)) {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10) || 20),
  );

  const where = { targetType: TARGET_TYPE } as const;

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
});

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
