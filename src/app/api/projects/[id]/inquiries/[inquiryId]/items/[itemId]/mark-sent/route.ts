import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { markItemSent, toPrismaHttpError } from "@/lib/inquiry/service";
import { isValidSentVia } from "@/lib/inquiry/types";

type Params = {
  params: Promise<{ id: string; inquiryId: string; itemId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId, inquiryId, itemId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = await request.json();
  if (!isValidSentVia(body.sentVia)) {
    return NextResponse.json(
      { error: "sentVia 必须为 email / phone / wechat / other" },
      { status: 400 }
    );
  }

  try {
    const item = await markItemSent(
      { projectId, inquiryId, itemId },
      { sentVia: body.sentVia }
    );
    return NextResponse.json(item);
  } catch (err) {
    const { msg, status } = toPrismaHttpError(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
