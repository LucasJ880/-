import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { markItemReplied, toPrismaHttpError } from "@/lib/inquiry/service";

type Params = {
  params: Promise<{ id: string; inquiryId: string; itemId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId, inquiryId, itemId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = await request.json().catch(() => ({}));

  try {
    const item = await markItemReplied(
      { projectId, inquiryId, itemId },
      body.notes
    );
    return NextResponse.json(item);
  } catch (err) {
    const { msg, status } = toPrismaHttpError(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
