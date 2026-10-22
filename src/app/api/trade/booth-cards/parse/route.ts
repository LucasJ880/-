/**
 * POST /api/trade/booth-cards/parse — 解析展会速记卡表格（只读，不写库）
 *
 * multipart/form-data：file（xlsx / xls / csv）
 * 返回每一行清洗后的卡片与问题；页面据此预览，再逐张调 /api/trade/booth-cards/ingest。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { BOOTH_CARD_ROLES, parseBoothCardSheet } from "@/lib/trade/booth-cards";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 500;

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, BOOTH_CARD_ROLES);
  if (auth instanceof NextResponse) return auth;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传文件" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "文件超过 5 MB" }, { status: 400 });
  }

  const name = file.name.toLowerCase();
  let parsed;
  try {
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      parsed = parseBoothCardSheet(await file.text());
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      parsed = parseBoothCardSheet(await file.arrayBuffer());
    } else {
      return NextResponse.json({ error: "仅支持 xlsx、xls、csv" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "文件无法解析，请用模板另存为 xlsx 或 csv" }, { status: 400 });
  }

  if (parsed.missingColumns.length) {
    return NextResponse.json(
      { error: `缺少必需的列：${parsed.missingColumns.join("、")}（请用模板的列名）`, unknownColumns: parsed.unknownColumns },
      { status: 400 },
    );
  }
  if (parsed.cards.length === 0) {
    return NextResponse.json({ error: "表格里没有数据行" }, { status: 400 });
  }
  if (parsed.cards.length > MAX_ROWS) {
    return NextResponse.json({ error: `一次最多 ${MAX_ROWS} 张卡，请分批上传` }, { status: 400 });
  }

  return NextResponse.json({
    total: parsed.cards.length,
    valid: parsed.cards.filter((c) => c.errors.length === 0).length,
    unknownColumns: parsed.unknownColumns,
    cards: parsed.cards,
  });
}
