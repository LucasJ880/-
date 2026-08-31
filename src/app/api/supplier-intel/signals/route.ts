import { NextResponse, type NextRequest } from "next/server";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { SupplierIntelError } from "@/lib/supplier-intel/errors";
import { createSubmittedSignal, listSignals } from "@/lib/supplier-intel/signal-service";

function mapDomainError(err: unknown): NextResponse | null {
  if (err instanceof SupplierIntelError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.httpStatus });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const url = new URL(request.url);
  const signals = await listSignals(
    { orgId: tenant.orgId, userId: tenant.userId },
    {
      status: url.searchParams.get("status") ?? undefined,
      platform: url.searchParams.get("platform") ?? undefined,
    },
  );
  return NextResponse.json({ signals });
}

export async function POST(request: NextRequest) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });

  try {
    // trusted principal：orgId/userId 一律取自 tenant 上下文，body 里的同名字段不生效
    const signal = await createSubmittedSignal(
      { orgId: tenant.orgId, userId: tenant.userId },
      {
        url: typeof body.url === "string" ? body.url : null,
        rawText: typeof body.rawText === "string" ? body.rawText : null,
        manualEntry: body.manualEntry === true,
        projectId: typeof body.projectId === "string" ? body.projectId : null,
        tenderId: typeof body.tenderId === "string" ? body.tenderId : null,
        searchRunId: typeof body.searchRunId === "string" ? body.searchRunId : null,
        rawMetadata: body.rawMetadata,
      },
    );
    return NextResponse.json({ signal }, { status: 201 });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
