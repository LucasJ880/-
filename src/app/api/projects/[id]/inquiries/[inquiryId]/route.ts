import { NextRequest, NextResponse } from "next/server";
import {
  requireProjectReadAccess,
  requireProjectWriteAccess,
} from "@/lib/projects/access";
import { getInquiry, updateInquiry, toPrismaHttpError } from "@/lib/inquiry/service";

type Params = { params: Promise<{ id: string; inquiryId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id: projectId, inquiryId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  try {
    const inquiry = await getInquiry({ projectId, inquiryId });
    return NextResponse.json(inquiry);
  } catch (err) {
    const { msg, status } = toPrismaHttpError(err);
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: projectId, inquiryId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = await request.json();
  try {
    const inquiry = await updateInquiry({ projectId, inquiryId }, body);
    return NextResponse.json(inquiry);
  } catch (err) {
    const { msg, status } = toPrismaHttpError(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
