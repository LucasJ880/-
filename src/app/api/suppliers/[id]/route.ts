import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import {
  getSupplier,
  updateSupplier,
  deleteSupplier,
} from "@/lib/supplier/service";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supplier = await getSupplier(id);
  if (!supplier) {
    return NextResponse.json({ error: "供应商不存在" }, { status: 404 });
  }
  return NextResponse.json(supplier);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
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
  try {
    await deleteSupplier(id);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "删除失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
