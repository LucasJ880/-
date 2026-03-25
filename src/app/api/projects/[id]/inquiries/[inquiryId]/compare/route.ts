import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { compareQuotes, toPrismaHttpError } from "@/lib/inquiry/service";

type Params = { params: Promise<{ id: string; inquiryId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id: projectId, inquiryId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  try {
    const rows = await compareQuotes({ projectId, inquiryId });
    return NextResponse.json(rows);
  } catch (err) {
    const { msg, status } = toPrismaHttpError(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
