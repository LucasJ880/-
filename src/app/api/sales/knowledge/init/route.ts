import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createVectorIndexes } from "@/lib/sales/vector-search";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user || user.role !== "admin") {
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
}
