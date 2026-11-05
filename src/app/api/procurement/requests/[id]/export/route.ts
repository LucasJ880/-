/** GET /api/procurement/requests/{id}/export?format=md|csv（org_viewer+）：申请卡 Markdown / 明细 CSV（继承读权限；不含附件内容） */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { requireRequestAccess, schemaGate } from "@/lib/procurement-records/access";
import { lineItemsCsv, requestCardMarkdown } from "@/lib/procurement-records/export";
import { getRequestDetail } from "@/lib/procurement-records/views";

export const GET = withAuth<{ id: string }>(async (request, ctx, user) => {
  const gate = schemaGate("read");
  if (gate) return gate;
  const { id } = await ctx.params;
  const a = await requireRequestAccess(user, id, "org_viewer");
  if (a instanceof NextResponse) return a;
  const d = await getRequestDetail(id);
  if (!d) return NextResponse.json({ error: "申请不存在" }, { status: 404 });
  const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "md";
  const body = format === "csv" ? lineItemsCsv(d) : requestCardMarkdown(d);
  return new NextResponse(body, {
    headers: {
      "content-type": format === "csv" ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="records-request-${id}.${format}"`,
      "cache-control": "private, no-store",
    },
  });
});
