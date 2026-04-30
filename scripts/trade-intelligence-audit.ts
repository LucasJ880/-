/**
 * Trade Intelligence MVP — 静态自查（orgId、resolveTradeOrgId、提示词约束等）
 *
 * 运行：pnpm exec tsx scripts/trade-intelligence-audit.ts
 *
 * 不启动 HTTP；不依赖 Serper/Firecrawl 运行时。部分行为需集成测或人工 checklist。
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

let failed = 0;

function ok(name: string) {
  console.log(`OK  ${name}`);
}

function fail(name: string, detail?: string) {
  console.error(`FAIL ${name}`, detail ?? "");
  failed++;
}

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) ok(name);
  else fail(name, detail);
}

function read(rel: string): string {
  const p = join(process.cwd(), rel);
  if (!existsSync(p)) {
    fail(`file_missing:${rel}`);
    return "";
  }
  return readFileSync(p, "utf8");
}

function main() {
  console.log("=== trade intelligence audit ===\n");

  const schema = read("prisma/schema.prisma");
  assert("schema: TradeIntelligenceCase has orgId", /model TradeIntelligenceCase[\s\S]*?\borgId\b/.test(schema));
  assert(
    "schema: TradeIntelligenceAsset model + orgId + caseId index",
    /model TradeIntelligenceAsset[\s\S]*?\borgId\b[\s\S]*?@@index\(\[orgId\]\)[\s\S]*?@@index\(\[caseId\]\)/.test(
      schema,
    ),
  );

  const intelRoutes = [
    "src/app/api/trade/intelligence/route.ts",
    "src/app/api/trade/intelligence/[id]/route.ts",
    "src/app/api/trade/intelligence/[id]/run/route.ts",
    "src/app/api/trade/intelligence/[id]/convert-to-prospect/route.ts",
    "src/app/api/trade/intelligence/from-image/route.ts",
    "src/app/api/trade/intelligence/extract-image/route.ts",
    "src/app/api/trade/intelligence/create-from-extracted/route.ts",
  ];
  for (const rel of intelRoutes) {
    const s = read(rel);
    if (!s) continue;
    assert(`${rel}: resolveTradeOrgId`, s.includes("resolveTradeOrgId"));
    assert(`${rel}: no default org fallback string`, !s.includes('resolveTradeOrgId("default"'));
  }

  const listRoute = read("src/app/api/trade/intelligence/route.ts");
  assert(
    "GET list scopes orgId (where includes orgRes.orgId)",
    listRoute.includes("orgId: orgRes.orgId") &&
      listRoute.includes("findMany") &&
      listRoute.includes("where"),
  );

  const idRoute = read("src/app/api/trade/intelligence/[id]/route.ts");
  assert("PATCH updateMany scopes orgId", idRoute.includes("updateMany") && idRoute.includes("orgId: orgRes.orgId"));

  const svc = read("src/lib/trade/intelligence-service.ts");
  assert("createIntelligenceCase sets orgId", /orgId:\s*params\.orgId/.test(svc));
  assert("runIntelligenceCase findFirst uses orgId", /where:\s*\{\s*id:\s*params\.caseId,\s*orgId:\s*params\.orgId/.test(svc));
  assert("run failure updateMany uses orgId", /updateMany\(\{\s*where:\s*\{\s*id:\s*params\.caseId,\s*orgId:\s*params\.orgId/.test(svc));
  assert("convert uses transaction + convertedProspectId null guard", svc.includes("$transaction") && svc.includes("convertedProspectId: null"));
  assert("convert prospect create includes orgId", /tradeProspect\.create\(\{[\s\S]*?\borgId\s*[,:]/.test(svc));
  assert("convert loadTradeCampaignForOrg when createCampaignId", svc.includes("loadTradeCampaignForOrg"));

  assert(
    "AI_SYSTEM forbids inventing contacts",
    /不得编造|禁止编造/.test(svc) && svc.includes("AI_SYSTEM"),
  );

  assert(
    "AI_SYSTEM requires analysisReport sections",
    /Confirmed evidence/.test(svc) && /Likely inference/.test(svc) && /Needs verification/.test(svc),
  );

  assert("evidence sort + channel helpers", svc.includes("sortEvidenceDescending") && svc.includes("evidenceChannelScore"));

  assert("sanitizeBuyerCandidates strips marketplace buyers", svc.includes("sanitizeBuyerCandidates"));

  const fromImage = read("src/app/api/trade/intelligence/from-image/route.ts");
  if (fromImage) {
    assert("from-image: resolveTradeOrgId", fromImage.includes("resolveTradeOrgId"));
    assert("from-image: no default org fallback string", !fromImage.includes('resolveTradeOrgId("default"'));
    assert(
      "from-image: case create includes orgId",
      /tradeIntelligenceCase\.create\([\s\S]*?\borgId\s*[,:]/.test(fromImage),
    );
    assert(
      "from-image: asset create includes orgId",
      /tradeIntelligenceAsset\.create\([\s\S]*?\borgId\s*[,:]/.test(fromImage),
    );
    assert(
      "from-image: MIME whitelist jpeg/png/webp",
      fromImage.includes("image/jpeg") &&
        fromImage.includes("image/png") &&
        fromImage.includes("image/webp"),
    );
    assert(
      "from-image: does not auto-run buyer discovery",
      !fromImage.includes("runIntelligenceCase"),
    );
  }

  const extractImage = read("src/app/api/trade/intelligence/extract-image/route.ts");
  if (extractImage) {
    assert("extract-image: resolveTradeOrgId", extractImage.includes("resolveTradeOrgId"));
    assert("extract-image: no default org fallback string", !extractImage.includes('resolveTradeOrgId("default"'));
    assert("extract-image: does not create TradeIntelligenceCase", !extractImage.includes("tradeIntelligenceCase.create"));
    assert(
      "extract-image: pending asset (caseId null)",
      extractImage.includes("caseId: null"),
    );
    assert(
      "extract-image: asset create includes orgId",
      /tradeIntelligenceAsset\.create\([\s\S]*?\borgId\s*[,:]/.test(extractImage),
    );
    assert("extract-image: does not auto-run buyer discovery", !extractImage.includes("runIntelligenceCase"));
  }

  const createFromExtracted = read("src/app/api/trade/intelligence/create-from-extracted/route.ts");
  if (createFromExtracted) {
    assert("create-from-extracted: resolveTradeOrgId", createFromExtracted.includes("resolveTradeOrgId"));
    assert(
      "create-from-extracted: no default org fallback string",
      !createFromExtracted.includes('resolveTradeOrgId("default"'),
    );
    assert(
      "create-from-extracted: case create includes orgId",
      /tradeIntelligenceCase\.create\([\s\S]*?\borgId\s*[,:]/.test(createFromExtracted),
    );
    assert(
      "create-from-extracted: asset load scopes orgId",
      createFromExtracted.includes("orgId") && createFromExtracted.includes("findFirst"),
    );
    assert(
      "create-from-extracted: rejects asset already linked to case",
      createFromExtracted.includes("caseId") && createFromExtracted.includes("409"),
    );
    assert("create-from-extracted: does not auto-run buyer discovery", !createFromExtracted.includes("runIntelligenceCase"));
  }

  const newIntelPage = read("src/app/(main)/trade/intelligence/new/page.tsx");
  if (newIntelPage) {
    assert(
      "new page Image tab: extract then confirm (extract-image + create-from-extracted)",
      newIntelPage.includes("/api/trade/intelligence/extract-image") &&
        newIntelPage.includes("/api/trade/intelligence/create-from-extracted"),
    );
    assert(
      "new page: default extract + edit + create case flow",
      newIntelPage.includes("Extract 提取字段") && newIntelPage.includes("Create Case 创建案例"),
    );
  }

  const labelVision = read("src/lib/trade/intelligence-label-vision.ts");
  if (labelVision) {
    assert(
      "label vision VISION_SYSTEM forbids inventing",
      labelVision.includes("VISION_SYSTEM") && /不得编造/.test(labelVision),
    );
    assert(
      "label vision: identity fields only visible_text or barcode_digits in prompt",
      labelVision.includes("visible_text") && labelVision.includes("barcode_digits"),
    );
    assert(
      "label vision: inferred_from_label restricted in prompt",
      labelVision.includes("inferred_from_label") && labelVision.includes("language"),
    );
  }

  assert(
    "insufficient_evidence low confidence rule in AI_SYSTEM",
    svc.includes("insufficient_evidence") && svc.includes("confidence"),
  );

  console.log("\n--- Manual / integration checklist ---");
  console.log("1. UPC + MPN 同页命中时：retailer/buyer 置信度应明显高于仅品牌命中（人工看 confidence 与 riskFlags）。");
  console.log("2. 仅相似品名、无 UPC/MPN：应为 low/medium，不得 buyer_identified。");
  console.log("3. marketplace 域名不得出现在 buyerCandidates 首位；应在 retailerCandidates 且 role=marketplace。");
  console.log("4. 无邮件/电话证据时：analysisReport 不得出现具体联系人或邮箱；仅策略链接。");
  console.log("5. convert 后 /trade/prospects 列表「溯源」角标可见；source=trade_intelligence。");
  console.log("6. 已 converted 的案例再次 convert → 409。");
  console.log("7. 跨 org 访问 / run / convert case → 404 或禁止。");
  console.log("8. 多组织 trade 用户：未选 org 时前端不发请求。");
  console.log("9. admin 调 GET /api/trade/intelligence 必须带 ?orgId=。");
  console.log("10. convert 传入其他组织的 createCampaignId → 应 403/错误提示。");
  console.log("11. Serper 未配置或空结果：evidence 为空分支 confidenceScore 低，不虚高。");
  console.log("12. Firecrawl 失败时：仍保留 Serper evidence，case 为 needs_review 等。");
  console.log("13. Harman 回归用例：retailerName=Kitchen Stuff Plus 时，kitchenstuffplus.com 相关页应在 retailer 前列且带 retailer_name_match。");
  console.log("14. POST from-image：未选 org 时前端不发；multipart 带 orgId；上传成功后仅创建 case+asset，详情页需手动点「运行搜索与分析」。");
  console.log("15. from-image：超大或非 jpg/png/webp 应 400；Vision 失败应 502 且不留下孤儿 blob（若有则记为改进项）。");
  console.log("16. extract-image：仅创建 caseId=null 的 asset；create-from-extracted 后 asset.caseId 指向新 case。");
  console.log("17. Harman 吊牌图：验收 productName/brand/UPC/MPN/material/size/产地；不得出现编造联系人/邮箱/电话。");
  console.log("18. 无 assetId 的 create-from-extracted：仅创建 case（无图片资产关联），用于极端离线场景。");

  if (failed > 0) {
    console.error(`\nDone: ${failed} failure(s)`);
    process.exit(1);
  }
  console.log("\nDone: all checks passed");
}

main();
