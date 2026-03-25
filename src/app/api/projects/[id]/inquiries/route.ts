import { NextRequest, NextResponse } from "next/server";
import {
  requireProjectReadAccess,
  requireProjectWriteAccess,
} from "@/lib/projects/access";
import { listInquiries, createInquiry } from "@/lib/inquiry/service";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const inquiries = await listInquiries(projectId);
  return NextResponse.json(inquiries);
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = await request.json();
  try {
    const inquiry = await createInquiry(
      { projectId, ...body },
      access.user.id
    );
    return NextResponse.json(inquiry, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "创建失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
