import { NextResponse, type NextRequest } from "next/server";
import { requireTenantContext } from "@/lib/tenancy";
import { loadOrderForExport, buildOrderContext } from "@/lib/vinyl/order-service";
import { generateVinylExcel } from "@/lib/vinyl/excel-export";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  const loaded = await loadOrderForExport(tenant.orgId, id);
  if (!loaded) return NextResponse.json({ error: "工艺单不存在" }, { status: 404 });
  if (loaded.exportData.items.length === 0) {
    return NextResponse.json({ error: "工艺单无窗户数据，无法导出" }, { status: 400 });
  }

  const orderCtx = await buildOrderContext(tenant.orgId, loaded.exportData.louverSize);
  const buffer = await generateVinylExcel({
    ...loaded.exportData,
    panelCodeOverrides: orderCtx.panelCodeOverrides,
  });

  const filename = encodeURIComponent(`${loaded.order.code}_Vinyl工艺单.xlsx`);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
