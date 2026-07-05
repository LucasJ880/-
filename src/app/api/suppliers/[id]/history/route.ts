import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { requireSupplierOrgAccess } from "@/lib/supplier/access";
import { getSupplierHistory } from "@/lib/supplier/service";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const access = await requireSupplierOrgAccess(auth.user, id);
  if (!access.ok) return access.response;

  const history = await getSupplierHistory(id);
  return NextResponse.json(history);
}
