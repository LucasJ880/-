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
  const notReady = mergeIntelRecipients({ picked: [{ id: "A", name: "供应商A" }], intelOrdered: [sup("C", { status: "inactive" }), sup("D", { contactEmail: null }), sup("E", { contactEmail: "bad" }), sup("G", { contactEmail: "g@x.test " }), sup("F")] });
  ok(notReady.merged.map((m) => m.id).join() === "A,F" && notReady.intelAdded.length === 1, "停用、没有邮箱、邮箱格式不对（含首尾空白，与建轮次时同一规则）的推荐不并入", notReady);
  const full = mergeIntelRecipients({ picked: Array.from({ length: 7 }, (_, i) => ({ id: `P${i}`, name: `P${i}` })), intelOrdered: [sup("X"), sup("Y")] });
  ok(INTEL_RECIPIENTS_MAX === 8 && full.merged.length === 8 && full.intelAdded.map((m) => m.id).join() === "X", "合计最多 8 家", full);
  const onlyIntel = mergeIntelRecipients({ picked: [], intelOrdered: [sup("C")] });
  ok(onlyIntel.merged.length === 0 && onlyIntel.intelAdded.length === 0, "操作者名单里没有能发的：不并入（照旧不起草）", onlyIntel);
}

{
  ok(intelRecipientsNoteZh(["丙"]) === "另外补了 1 家供应商情报推荐的：丙" && intelRecipientsNoteZh([]) === "", "那一句");
  const counts = { confirmedCount: 3, unconfirmedCount: 0 };
  const plain = autoDraftPreviewLineZh("张三", counts, null);
  ok(autoDraftPreviewLineZh("张三", counts, null, []) === plain && autoDraftPreviewLineZh("张三", counts, null, null) === plain, "没有并入时卡摘要与之前相同");
  const withIntel = autoDraftPreviewLineZh("张三", counts, null, ["丙"]);
  ok(withIntel === plain.replace("的常用供应商；", "的常用供应商，另外补了 1 家供应商情报推荐的：丙；"), "并入时卡摘要写明另外补了几家、是哪几家", withIntel);
  const group = { groupName: "窗饰", keyword: "blind" };
  const plainGroup = autoDraftPreviewLineZh("张三", counts, group);
  ok(autoDraftPreviewLineZh("张三", counts, group, ["丙"]) === plainGroup.replace("）；询价单", "），另外补了 1 家供应商情报推荐的：丙；询价单"), "按分组起草时同样写在分组之后", plainGroup);
  const done = autoDraftDone({ projectId: "p", inquiryId: "q", roundNumber: 1, supplierCount: 3, skippedCount: 0, unconfirmedCount: 0, intelSupplierNames: ["丙"] });
  ok(done.drafted && done.messageZh.startsWith("已为你起草第 1 轮询价：3 家供应商——2 家常用供应商，另外补了 1 家供应商情报推荐的：丙。") && Object.keys(done).sort().join() === "drafted,href,messageZh,quiet,roundNumber,skippedCount,supplierCount,unconfirmedCount,withFollowUp", "结果说明写明另外补了哪几家；结果字段不变", done);
  const withSkipGroup = autoDraftDone({ projectId: "p", inquiryId: "q", roundNumber: 1, supplierCount: 3, skippedCount: 1, unconfirmedCount: 0, group, intelSupplierNames: ["丙"] });
  ok(withSkipGroup.drafted && withSkipGroup.messageZh.startsWith("已为你起草第 1 轮询价：3 家供应商——2 家取自分组「窗饰」（项目名称里有「blind」）（这一组里有 1 家停用、没有邮箱或超出上限，已跳过），另外补了 1 家供应商情报推荐的：丙。"), "按分组 + 有跳过：跳过的紧跟自己的名单，推荐写在最后", withSkipGroup);
  const before = autoDraftDone({ projectId: "p", inquiryId: "q", roundNumber: 1, supplierCount: 2, skippedCount: 1, unconfirmedCount: 0 });
  ok(before.drafted && before.messageZh.startsWith("已为你起草第 1 轮询价：2 家常用供应商（常用供应商里有 1 家停用、没有邮箱或超出上限，已跳过）。"), "不传情报推荐：结果说明与之前相同");
  const beforeGroup = autoDraftDone({ projectId: "p", inquiryId: "q", roundNumber: 1, supplierCount: 2, skippedCount: 0, unconfirmedCount: 0, group });
  ok(beforeGroup.drafted && beforeGroup.messageZh.startsWith("已为你起草第 1 轮询价：2 家供应商，取自分组「窗饰」（项目名称里有「blind」）。"), "不传情报推荐、按分组：与之前相同");
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
