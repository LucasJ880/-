/**
 * CHAIN-2 情报推荐并入自动起草收件人 — 合并规则与开关（纯函数）
 * 运行：npx tsx src/lib/tender-rfq/__tests__/intel-recipients.test.ts
 */
import { isRfqIntelRecipientsEnabledForOrgWithEnv } from "../intel-recipients-flags";
import { INTEL_RECIPIENTS_MAX, intelRecipientsNoteZh, intelRecommendedSupplierIds, mergeIntelRecipients } from "../intel-recipients";
import { autoDraftDone, autoDraftPreviewLineZh } from "../auto-draft-pure";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 800)); }
}

console.log("intel recipients");

{
  const on = (v: string | undefined, list: string | undefined, org = "o1") =>
    isRfqIntelRecipientsEnabledForOrgWithEnv(org, { TENDER_RFQ_INTEL_RECIPIENTS_ENABLED: v, TENDER_RFQ_INTEL_RECIPIENTS_ORG_ALLOWLIST: list } as NodeJS.ProcessEnv);
  ok(!on(undefined, undefined) && !on("0", undefined) && on("1", undefined) && on("on", "o1") && !on("1", "o2"), "开关真值表（主开关 + 组织白名单）");
}

{
  const ids = intelRecommendedSupplierIds([
    { supplierId: "C", section: "BACKUP", rank: 2, mandatoryGateResult: "PASS" },
    { supplierId: "D", section: "NOT_ELIGIBLE", rank: null, mandatoryGateResult: "FAIL" },
    { supplierId: "B", section: "PRIMARY", rank: 1, mandatoryGateResult: "PASS" },
    { supplierId: "B", section: "BACKUP", rank: 3, mandatoryGateResult: "PASS" },
    { supplierId: "E", section: "NEEDS_VERIFICATION", rank: null, mandatoryGateResult: "INCOMPLETE" },
  ]);
  ok(ids.join() === "B,C", "推荐 = 主选 / 备选、强制闸通过，按名次，同一家只算一次", ids);
}

const sup = (id: string, o: { status?: string; contactEmail?: string | null } = {}) => ({ id, name: `供应商${id}`, contactEmail: o.contactEmail === undefined ? `${id.toLowerCase()}@x.test` : o.contactEmail, status: o.status ?? "active" });
{
  const r = mergeIntelRecipients({ picked: [{ id: "A", name: "供应商A" }, { id: "B", name: "供应商B" }], intelOrdered: [sup("B"), sup("C")] });
  ok(r.merged.map((m) => m.id).join() === "A,B,C" && r.intelAdded.map((m) => m.id).join() === "C", "名单在前、推荐补在后；已在名单里的不重复", r);
  const notReady = mergeIntelRecipients({ picked: [{ id: "A", name: "供应商A" }], intelOrdered: [sup("C", { status: "inactive" }), sup("D", { contactEmail: null }), sup("E", { contactEmail: "bad" }), sup("F")] });
  ok(notReady.merged.map((m) => m.id).join() === "A,F" && notReady.intelAdded.length === 1, "停用、没有邮箱、邮箱格式不对的推荐不并入", notReady);
  const full = mergeIntelRecipients({ picked: Array.from({ length: 7 }, (_, i) => ({ id: `P${i}`, name: `P${i}` })), intelOrdered: [sup("X"), sup("Y")] });
  ok(INTEL_RECIPIENTS_MAX === 8 && full.merged.length === 8 && full.intelAdded.map((m) => m.id).join() === "X", "合计最多 8 家", full);
  const onlyIntel = mergeIntelRecipients({ picked: [], intelOrdered: [sup("C")] });
  ok(onlyIntel.merged.map((m) => m.id).join() === "C", "名单为空时只用推荐");
}

{
  ok(intelRecipientsNoteZh(["丙"]) === "其中 1 家来自供应商情报推荐：丙" && intelRecipientsNoteZh([]) === "", "摘要那一句");
  const counts = { confirmedCount: 3, unconfirmedCount: 0 };
  const plain = autoDraftPreviewLineZh("张三", counts, null);
  ok(autoDraftPreviewLineZh("张三", counts, null, []) === plain && autoDraftPreviewLineZh("张三", counts, null, null) === plain, "没有并入时卡摘要与之前相同");
  const withIntel = autoDraftPreviewLineZh("张三", counts, null, ["丙"]);
  ok(withIntel === plain.replace("的常用供应商；", "的常用供应商；其中 1 家来自供应商情报推荐：丙；"), "并入时卡摘要写明几家、是哪几家来自情报推荐", withIntel);
  const done = autoDraftDone({ projectId: "p", inquiryId: "q", roundNumber: 1, supplierCount: 3, skippedCount: 0, unconfirmedCount: 0, intelSupplierNames: ["丙"] });
  ok(done.drafted && done.messageZh.startsWith("已为你起草第 1 轮询价：3 家供应商（2 家取自常用供应商，其中 1 家来自供应商情报推荐：丙）") && Object.keys(done).sort().join() === "drafted,href,messageZh,quiet,roundNumber,skippedCount,supplierCount,unconfirmedCount,withFollowUp", "结果说明写明情报推荐；结果字段不变", done);
  const onlyIntel = autoDraftDone({ projectId: "p", inquiryId: "q", roundNumber: 1, supplierCount: 1, skippedCount: 0, unconfirmedCount: 0, intelSupplierNames: ["丙"] });
  ok(onlyIntel.drafted && onlyIntel.messageZh.startsWith("已为你起草第 1 轮询价：1 家供应商（其中 1 家来自供应商情报推荐：丙）"), "只有推荐时不写「0 家取自常用供应商」", onlyIntel);
  const before = autoDraftDone({ projectId: "p", inquiryId: "q", roundNumber: 1, supplierCount: 2, skippedCount: 0, unconfirmedCount: 0 });
  ok(before.drafted && before.messageZh.startsWith("已为你起草第 1 轮询价：2 家常用供应商。"), "不传情报推荐：结果说明与之前相同");
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
