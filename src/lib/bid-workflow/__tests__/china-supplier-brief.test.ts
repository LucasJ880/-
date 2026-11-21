/**
 * 供应商侧敏感词判断 — 纯逻辑测试
 * 运行：npx tsx src/lib/bid-workflow/__tests__/china-supplier-brief.test.ts
 *
 * RFQ-PDF-1：「国内供应商简报（China Brief）」已停止生成，简报正文拼装随之删除；
 * 本文件只测留下来的敏感词判断（询价生成、催单与追问、供应商情报外发查询共用）。文件名沿用旧名。
 */
import assert from "node:assert/strict";
import * as briefModule from "../china-supplier-brief";
import { containsSensitiveSupplierBriefText } from "../china-supplier-brief";

async function main() {
  console.log("sensitive detector: internal finance / competitor / customer contact");
  for (const t of ["our margin is high", "目标毛利 30%", "我方预算 50 万", "internal note: hold", "estimatedValue=1", "ourBidPrice", "winningBidPrice", "竞争对手报价", "客户电话 123", "底价 12 元", "at no additional cost"]) {
    assert.equal(containsSensitiveSupplierBriefText(t), true, t);
  }

  console.log("sensitive detector: ordinary supplier wording passes");
  for (const t of ["need MOQ and FOB", "请报单价与交期", "睡袋须达到 -20°C", "Provide 2 samples", ""]) {
    assert.equal(containsSensitiveSupplierBriefText(t), false, t);
  }

  console.log("brief body builder is gone");
  assert.deepEqual(Object.keys(briefModule).sort(), ["containsSensitiveSupplierBriefText"]);

  console.log("china-supplier-brief.test PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
