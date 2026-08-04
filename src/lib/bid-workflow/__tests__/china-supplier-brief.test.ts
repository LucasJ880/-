import assert from "node:assert/strict";
import {
  assertNoForbiddenLeak,
  buildChinaSupplierBriefText,
  containsSensitiveSupplierBriefText,
} from "../china-supplier-brief";

async function main() {
  console.log("default brief excludes estimatedValue / costs / inferred amounts");
  {
    const body = buildChinaSupplierBriefText({
      projectName: "Cotton Towelling Fabric",
      clientOrganization: "Cox Agency",
      documentTitles: ["RFP.pdf"],
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
      projectName: "Cotton",
      documentTitles: [],
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
