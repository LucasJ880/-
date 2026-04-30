/**
 * 外贸 P0 / P0.5 权限与入站 org 自查脚本（最小可运行）
 *
 * 运行：pnpm exec tsx scripts/trade-p0-audit.ts
 *
 * 说明：
 * - 不启动 HTTP 服务；直接调用业务函数 + Prisma（需 DATABASE_URL）
 * - 跨 org 用例在库内不足两个 Organization 或无 campaign 时会跳过并打印 SKIP
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { runProspectResearch } from "@/lib/trade/research-service";
import { requireTradeCronSecret, loadTradeCampaignForOrg } from "@/lib/trade/access";
import { verifyWhatsAppSignature } from "@/lib/trade/webhook-meta";
import { resolveInboundTradeOrgId } from "@/lib/trade/inbound-org";
import { db } from "@/lib/db";

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

function assertNoInboundDefaultInWebhooks() {
  const files = [
    "src/app/api/trade/webhook/whatsapp/route.ts",
    "src/app/api/trade/webhook/wechat/route.ts",
  ];
  for (const rel of files) {
    const p = join(process.cwd(), rel);
    if (!existsSync(p)) {
      fail(`file_missing:${rel}`);
      continue;
    }
    const s = readFileSync(p, "utf8");
    if (s.includes('processInboundMessage("default"') || s.includes("processInboundMessage('default'")) {
      fail(`inbound_default_leak:${rel}`);
    } else {
      ok(`no_inbound_default:${rel}`);
    }
  }
}

async function main() {
  console.log("=== trade P0.5 audit ===\n");

  assertNoInboundDefaultInWebhooks();

  const missingOrg = await runProspectResearch({ prospectId: "clfake000000000000000000" } as never);
  assert(
    "runProspectResearch rejects missing orgId",
    !missingOrg.success && missingOrg.code === "forbidden",
    JSON.stringify(missingOrg),
  );

  const p = await db.tradeProspect.findFirst({ select: { id: true, orgId: true } });
  if (p) {
    const wrongOrg = await runProspectResearch({
      prospectId: p.id,
      orgId: "org_nonexistent_for_audit________________",
    });
    assert(
      "runProspectResearch rejects wrong orgId",
      !wrongOrg.success && wrongOrg.code === "forbidden",
      JSON.stringify(wrongOrg),
    );
  } else {
    console.log("SKIP runProspectResearch wrong orgId (no TradeProspect in DB)");
  }

  const prevCron = process.env.CRON_SECRET;
  try {
    process.env.CRON_SECRET = "";
    let res = requireTradeCronSecret(new NextRequest("http://localhost/api/trade/cron"));
    assert("cron rejects when CRON_SECRET empty", res instanceof NextResponse && res.status === 503);

    process.env.CRON_SECRET = "audit-test-secret";
    res = requireTradeCronSecret(new NextRequest("http://localhost/api/trade/cron"));
    assert("cron rejects wrong Bearer", res instanceof NextResponse && res.status === 401);

    res = requireTradeCronSecret(
      new NextRequest("http://localhost/api/trade/cron", {
        headers: { authorization: "Bearer audit-test-secret" },
      }),
    );
    assert("cron accepts correct Bearer", res === null);
  } finally {
    process.env.CRON_SECRET = prevCron;
  }

  const body = '{"entry":[]}';
  const secret = "app-secret-test";
  const goodSig = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  assert("whatsapp signature valid", verifyWhatsAppSignature(body, goodSig, secret));
  assert("whatsapp signature invalid", !verifyWhatsAppSignature(body, "sha256=deadbeef", secret));

  const wa = await resolveInboundTradeOrgId({
    provider: "whatsapp",
    providerAccountId: "__phone_number_id_that_should_not_exist__",
  });
  assert(
    "inbound whatsapp unknown phone_number_id → no org",
    !wa.ok && wa.reason === "channel_not_found",
    JSON.stringify(wa),
  );

  const orgs = await db.organization.findMany({ take: 2, select: { id: true } });
  if (orgs.length >= 2) {
    const camp = await db.tradeCampaign.findFirst({
      where: { orgId: orgs[1].id },
      select: { id: true },
    });
    if (camp) {
      const res = await loadTradeCampaignForOrg(camp.id, orgs[0].id);
      assert(
        "loadTradeCampaignForOrg cross-org → 404",
        res instanceof NextResponse && res.status === 404,
      );
    } else {
      console.log("SKIP cross-org campaign (no campaign on second org)");
    }
  } else {
    console.log("SKIP cross-org campaign (need >=2 organizations)");
  }

  const p2 = await db.tradeProspect.findFirst({ select: { id: true, orgId: true } });
  if (p2 && orgs.length >= 2) {
    const wrongOrgId = orgs.find((o) => o.id !== p2.orgId)?.id;
    if (wrongOrgId) {
      const { loadTradeProspectForOrg } = await import("@/lib/trade/access");
      const res = await loadTradeProspectForOrg(p2.id, wrongOrgId);
      assert(
        "loadTradeProspectForOrg wrong org → 404",
        res instanceof NextResponse && res.status === 404,
      );
    } else {
      console.log("SKIP prospect cross-org (single org matches prospect)");
    }
  } else {
    console.log("SKIP prospect cross-org (insufficient data)");
  }

  const q = await db.tradeQuote.findFirst({ select: { id: true, orgId: true } });
  if (q && orgs.length >= 2) {
    const wrongOrgId = orgs.find((o) => o.id !== q.orgId)?.id;
    if (wrongOrgId) {
      const { loadTradeQuoteForOrg } = await import("@/lib/trade/access");
      const res = await loadTradeQuoteForOrg(q.id, wrongOrgId);
      assert(
        "loadTradeQuoteForOrg wrong org → 404",
        res instanceof NextResponse && res.status === 404,
      );
    } else {
      console.log("SKIP quote cross-org (quote org matches all sampled orgs)");
    }
  } else {
    console.log("SKIP quote cross-org (no quote or orgs)");
  }

  await db.$disconnect();

  console.log("\n--- manual checklist (curl / staging) ---");
  console.log("- org A 用户带 org B 的 id 调 GET /api/trade/campaigns/:id → 404");
  console.log("- org A 用户调 GET /api/trade/prospects?campaignId=B_campaign → 404（活动不属于当前组织）");
  console.log("- POST /api/trade/cron 无 Authorization → 401 或 503（视 CRON_SECRET 是否配置）");
  console.log("- POST WhatsApp webhook 无 X-Hub-Signature-256 → 401");
  console.log("- 配置 TradeChannel.config.phoneNumberId 后，入站 metadata.phone_number_id 应命中正确 org");

  if (failed > 0) {
    console.error(`\nDone: ${failed} failure(s)`);
    process.exit(1);
  }
  console.log("\nDone: all automated checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
