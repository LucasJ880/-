import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { backfillInteractions } from "@/lib/sales/knowledge-pipeline";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { limit, customerId } = body as {
      limit?: number;
      customerId?: string;
    };

    const result = await backfillInteractions({ limit: limit ?? 50, customerId });

    return NextResponse.json({
      success: true,
      processed: result.processed,
      errors: result.errors.slice(0, 10),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "回填失败" },
      { status: 500 },
    );
  }
}
