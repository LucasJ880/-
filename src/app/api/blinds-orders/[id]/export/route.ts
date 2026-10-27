import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateBlindsExcel } from "@/lib/blinds/excel-export";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveOrderAccess, type OrderAccessRow } from "@/lib/fulfillment/service";

export const GET = withAuth(async (_request, ctx, user) => {
  const { id } = await ctx.params;

  const order = await db.blindsOrder.findUnique({
    where: { id },
    include: {
      items: { orderBy: { itemNumber: "asc" } },
      customer: { select: { orgId: true } },
      project: { select: { orgId: true } },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "工艺单不存在" }, { status: 404 });
  }
  // PERM-3：导出与读同范围
  const access = await resolveOrderAccess(user, order as unknown as OrderAccessRow);
  if (!access.canRead) {
    return NextResponse.json({ error: "工艺单不存在" }, { status: 404 });
  }

  if (order.items.length === 0) {
    return NextResponse.json({ error: "工艺单无窗户数据，无法导出" }, { status: 400 });
  }

  const buffer = await generateBlindsExcel(order);

  const filename = encodeURIComponent(`${order.code}_工艺单.xlsx`);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
});
