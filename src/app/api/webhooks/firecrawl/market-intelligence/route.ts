import { NextRequest, NextResponse } from "next/server";
import { processFirecrawlMarketWebhook } from "@/lib/market-intelligence/service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  try {
    const result = await processFirecrawlMarketWebhook(
      rawBody,
      request.headers.get("x-firecrawl-signature"),
      request.headers.get("x-qingyan-webhook-token"),
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_signature") {
      return NextResponse.json({ error: "签名校验失败" }, { status: 401 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Webhook 内容不是有效 JSON" }, { status: 400 });
    }
    console.error("[market-intelligence/webhook]", error);
    return NextResponse.json({ error: "Webhook 处理失败" }, { status: 500 });
  }
}
