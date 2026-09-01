import { NextResponse, type NextRequest } from "next/server";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { createTavilySearchEngineProvider } from "@/lib/supplier-intel/providers";
import { createSearchRun, listSearchRuns } from "@/lib/supplier-intel/run-service";
import { buildSupplierSearchBrief } from "@/lib/supplier-intel/search-brief";

export async function GET(request: NextRequest) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const url = new URL(request.url);
  const runs = await listSearchRuns(
    { orgId: tenant.orgId, userId: tenant.userId },
    { status: url.searchParams.get("status") ?? undefined },
  );
  return NextResponse.json({ runs });
}

function strArray(v: unknown, cap = 20): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").slice(0, cap);
}

export async function POST(request: NextRequest) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });

  try {
    const delivery = (body.delivery ?? {}) as Record<string, unknown>;
    // brief：真相源 = canonical requirements（三值 mandatory 由调用方从 Tender 分析
    // V2 层带来——禁止服务端从会塌缩 uncertain 的 DB boolean 重建，AUDIT §3.1 陷阱）；
    // 确定性优先 + 可选 LLM 扩词（失败静默回退；检索词无事实断言）
    const brief = await buildSupplierSearchBrief(
      {
        projectId: typeof body.projectId === "string" ? body.projectId : null,
        tenderId: typeof body.tenderId === "string" ? body.tenderId : null,
        productCategory: typeof body.productCategory === "string" ? body.productCategory : null,
        quantity: typeof body.quantity === "number" ? body.quantity : null,
        requirements: body.requirements,
        productKeywordsZh: strArray(body.productKeywordsZh),
        productKeywordsEn: strArray(body.productKeywordsEn),
        capabilityHintsZh: strArray(body.capabilityHintsZh),
        exclusions: strArray(body.exclusions),
        delivery: {
          country: typeof delivery.country === "string" ? delivery.country : null,
          province: typeof delivery.province === "string" ? delivery.province : null,
          city: typeof delivery.city === "string" ? delivery.city : null,
          requiredDate: typeof delivery.requiredDate === "string" ? delivery.requiredDate : null,
        },
      },
      { allowLlm: body.useLlm !== false },
    );
    const provider = createTavilySearchEngineProvider();
    const run = await createSearchRun(
      { orgId: tenant.orgId, userId: tenant.userId },
      {
        projectId: typeof body.projectId === "string" ? body.projectId : null,
        tenderId: typeof body.tenderId === "string" ? body.tenderId : null,
        brief,
        requirements: body.requirements,
        sourceConfig: {
          provider: provider.providerId,
          providerAvailable: provider.isAvailable(),
          internalAdapters: ["memory", "historical", "saved"],
          adapters: ["DOUYIN", "XIAOHONGSHU", "WECHAT_CHANNELS", "OPEN_WEB"],
          supplier1688Adapter: "DEFERRED",
        },
        promptName: brief.generator.llm?.promptName ?? null,
        promptVersion: brief.generator.llm?.promptVersion ?? null,
      },
    );
    return NextResponse.json({ run }, { status: 201 });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
