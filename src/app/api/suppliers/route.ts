import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { createSupplier, listSuppliers } from "@/lib/supplier/service";
import { isNonEmptyString } from "@/lib/common/validation";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  if (!orgId) {
    return NextResponse.json({ error: "缺少 orgId 参数" }, { status: 400 });
  }

  const status = url.searchParams.get("status") ?? undefined;
  const search = url.searchParams.get("search") ?? undefined;
  const page = parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
  const pageSize = parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50;

  const result = await listSuppliers(orgId, { status, search, page, pageSize });
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  if (!isNonEmptyString(body.orgId) || !isNonEmptyString(body.name)) {
    return NextResponse.json(
      { error: "orgId 和 name 为必填" },
      { status: 400 }
    );
  }

  try {
    const supplier = await createSupplier(body, auth.user.id);
    return NextResponse.json(supplier, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "创建失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
