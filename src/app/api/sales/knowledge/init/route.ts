import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { createVectorIndexes } from "@/lib/sales/vector-search";

export const POST = withAuth(async (_request, _ctx, user) => {
  if (user.role !== "admin") {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  }

  try {
    await createVectorIndexes();
    return NextResponse.json({ success: true, message: "HNSW 索引创建完成" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "索引创建失败" },
      { status: 500 },
    );
  }
});
