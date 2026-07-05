import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { requireSupplierOrgAccess } from "@/lib/supplier/access";
import { updateSupplier, deleteSupplier } from "@/lib/supplier/service";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const access = await requireSupplierOrgAccess(auth.user, id);
  if (!access.ok) return access.response;

  return NextResponse.json(access.supplier);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const access = await requireSupplierOrgAccess(auth.user, id);
  if (!access.ok) return access.response;

  const body = await request.json();

  try {
    const supplier = await updateSupplier(id, body);
    return NextResponse.json(supplier);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "更新失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const access = await requireSupplierOrgAccess(auth.user, id);
  if (!access.ok) return access.response;

  try {
    await deleteSupplier(id);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "删除失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
