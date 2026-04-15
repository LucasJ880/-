import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { backfillInteractions } from "@/lib/sales/knowledge-pipeline";

export const POST = withAuth(async (request) => {
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
});
