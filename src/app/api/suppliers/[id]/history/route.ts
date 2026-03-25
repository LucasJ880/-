import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { getSupplier, getSupplierHistory } from "@/lib/supplier/service";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supplier = await getSupplier(id);
  if (!supplier) {
    return NextResponse.json({ error: "供应商不存在" }, { status: 404 });
  }

  const history = await getSupplierHistory(id);
  return NextResponse.json(history);
}
