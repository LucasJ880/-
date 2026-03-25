import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { addInquiryItem, toPrismaHttpError } from "@/lib/inquiry/service";
import { isNonEmptyString } from "@/lib/common/validation";

type Params = { params: Promise<{ id: string; inquiryId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId, inquiryId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = await request.json();
  if (!isNonEmptyString(body.supplierId)) {
    return NextResponse.json(
      { error: "supplierId 为必填" },
      { status: 400 }
    );
  }

  try {
    const item = await addInquiryItem(
      { projectId, inquiryId },
      body.supplierId,
      access.user.id,
      body.contactNotes
    );
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    const { msg, status } = toPrismaHttpError(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
