/**
 * China Supplier Sourcing Brief — 纯逻辑测试
 * 运行：npx tsx src/lib/bid-workflow/__tests__/china-supplier-brief.test.ts
 */
import assert from "node:assert/strict";
import {
  assertNoForbiddenLeak,
  buildChinaSupplierBriefText,
  containsSensitiveSupplierBriefText,
} from "../china-supplier-brief";
import { buildProjectIdentityDenyList, SupplierIdentityLeakError, type ProjectIdentitySources } from "../project-identity-deny";

// CHAIN-4b：简报的身份入参（禁出清单 + 中性询价编号）
const denyOf = (o: Partial<ProjectIdentitySources> = {}) =>
  buildProjectIdentityDenyList({
    projectName: null, solicitationNumber: null, clientOrganization: null, closeDate: null, timeZone: "America/Toronto",
    facts: { tenderNumber: [], buyer: [], projectTitle: [], closingDatetime: [], location: [] }, allowedEmails: [], ...o,
  });
const REF = "RFQ-SUNNY-2026-7KQ4M";

async function main() {
  console.log("default brief excludes estimatedValue / costs / inferred amounts");
  {
    const body = buildChinaSupplierBriefText({
      reference: REF,
      identity: denyOf({ projectName: "Cotton Towelling Fabric", clientOrganization: "Cox Agency" }),
      includePublicHistoricalAmounts: false,
      facts: [
        {
          content: "Fabric must be 100% cotton terry",
          confidence: "CONFIRMED",
          sourceType: "tender_document",
        },
        {
          content: "Internal estimatedValue CAD 886410",
          confidence: "CONFIRMED",
          sourceType: "manual",
        },
        {
          content: "Likely CAD 100,000 annual (guess)",
          confidence: "INFERRED",
          sourceType: "ai_inference",
        },
        {
          content: "Historical award CAD 886,410 to Cox Trading",
          confidence: "CONFIRMED",
          sourceType: "historical",
          humanConfirmed: true,
        },
      ],
      confirmNotes: "内部备注：毛利率 30% 勿外发",
    });
    assert.equal(body.includes("estimatedValue"), false);
    assert.equal(body.includes("毛利率"), false);
    assert.equal(body.includes("886,410"), false);
    assert.equal(body.includes("100,000"), false);
    assert.match(body, /100% cotton terry/);
    assert.match(body, /includePublicHistoricalAmounts=false/);
  }

  console.log("switch on allows public historical amounts with label");
  {
    const body = buildChinaSupplierBriefText({
      reference: REF,
      identity: denyOf({ projectName: "Cotton" }),
      includePublicHistoricalAmounts: true,
      facts: [
        {
          content: "Historical award CAD 886,410 to Cox Trading",
          confidence: "CONFIRMED",
          sourceType: "historical",
          humanConfirmed: true,
        },
        {
          content: "Inferred CAD 50,000",
          confidence: "INFERRED",
          sourceType: "ai_inference",
        },
      ],
    });
    assert.match(body, /PUBLIC HISTORICAL REFERENCE/);
    assert.match(body, /886,410/);
    assert.equal(body.includes("Inferred CAD 50,000"), false);
  }

  console.log("CHAIN-4b: no buyer / close date / file names; identity facts dropped; notes hit fails");
  {
    const identity = denyOf({ projectName: "Cotton Towelling Fabric", clientOrganization: "Cox Agency", solicitationNumber: "EN578-170432", closeDate: new Date("2026-12-05T19:00:00Z") });
    const facts = [
      { content: "Cox Agency requires 500 units", confidence: "CONFIRMED", sourceType: "tender_document" },
      { content: "Fabric weight 300gsm", confidence: "CONFIRMED", sourceType: "tender_document" },
      { content: "Questions to buyer@coxagency.ca", confidence: "CONFIRMED", sourceType: "tender_document" },
    ];
    const body = buildChinaSupplierBriefText({ reference: REF, identity, includePublicHistoricalAmounts: false, facts });
    assert.equal(/Procuring agency/i.test(body), false, "no Procuring agency line");
    assert.equal(/Source documents/i.test(body), false, "no source documents line");
    assert.equal(body.includes("2026-12-05"), false, "no close date");
    assert.equal(body.includes("Cox Agency"), false, "fact naming the buyer is dropped");
    assert.equal(body.includes("coxagency.ca"), false, "fact with an email is dropped");
    assert.match(body, /Fabric weight 300gsm/);
    assert.match(body, /RFQ reference \/ 询价编号: RFQ-SUNNY-2026-7KQ4M/);
    assert.equal(body.includes("Cotton Towelling Fabric"), false, "no project name");

    let caught: unknown = null;
    try {
      buildChinaSupplierBriefText({ reference: REF, identity, includePublicHistoricalAmounts: false, facts, confirmNotes: "请参考 Cox Agency 的往年订单" });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof SupplierIdentityLeakError, "notes naming the buyer fail the whole brief");
    assert.ok((caught as Error).message.includes("命中：采购方名称·编辑备注"), (caught as Error).message);
    assert.equal((caught as Error).message.includes("Cox Agency"), false, "message does not quote the hit");

    let caughtName: unknown = null;
    try {
      buildChinaSupplierBriefText({ reference: REF, identity, includePublicHistoricalAmounts: false, facts: [], confirmNotes: "本批是 Cotton Towelling Fabric" });
    } catch (e) {
      caughtName = e;
    }
    assert.ok(caughtName instanceof SupplierIdentityLeakError && (caughtName as Error).message.includes("项目名称·编辑备注"), "notes naming the project fail");
  }

  console.log("sensitive detector");
  assert.equal(containsSensitiveSupplierBriefText("our margin is high"), true);
  assert.equal(containsSensitiveSupplierBriefText("need MOQ and FOB"), false);

  console.log("assertNoForbiddenLeak throws on token");
  {
    let threw = false;
    try {
      assertNoForbiddenLeak("x estimatedValue y", false);
    } catch {
      threw = true;
    }
    assert.equal(threw, true);
  }

  console.log("china-supplier-brief.test PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
