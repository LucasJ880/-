import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateBlindsExcel } from "@/lib/blinds/excel-export";
import { withAuth } from "@/lib/common/api-helpers";

export const GET = withAuth(async (_request, ctx) => {
  const { id } = await ctx.params;

  const order = await db.blindsOrder.findUnique({
    where: { id },
    include: {
      items: { orderBy: { itemNumber: "asc" } },
    },
  });

  if (!order) {
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
