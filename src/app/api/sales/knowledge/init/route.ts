import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { createVectorIndexes } from "@/lib/sales/vector-search";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";

export const POST = withAuth(async (_request, _ctx, user) => {
  // PERM-4a：平台运维动作（建向量索引）只限平台 super_admin
  if (!isPlatformSuperAdmin(user.role)) {
    return NextResponse.json({ error: "需要平台管理员权限" }, { status: 403 });
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
