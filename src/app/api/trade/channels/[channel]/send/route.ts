import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { sendChannelMessage } from "@/lib/trade/channel-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { channel } = await params;
  const body = await request.json();

  if (!body.prospectId || !body.to || !body.content) {
    return NextResponse.json({ error: "prospectId, to, content 必填" }, { status: 400 });
  }

  try {
    const result = await sendChannelMessage({
      orgId: body.orgId ?? "default",
      prospectId: body.prospectId,
      channel: channel as "whatsapp" | "wechat" | "wechat_work",
      to: body.to,
      content: body.content,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "发送失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
