import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { markItemDeclined, toPrismaHttpError } from "@/lib/inquiry/service";

type Params = {
  params: Promise<{ id: string; inquiryId: string; itemId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId, inquiryId, itemId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  try {
    const item = await markItemDeclined({ projectId, inquiryId, itemId });
    return NextResponse.json(item);
  } catch (err) {
    const { msg, status } = toPrismaHttpError(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
