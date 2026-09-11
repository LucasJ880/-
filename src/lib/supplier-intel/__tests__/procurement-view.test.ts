/**
 * S3-A 纯逻辑：采购分组、三值文案、工作台状态文案（CI 可执行，无 DB、无网络）。
 *
 * 这些断言把「诚实展示」的口径固定下来：
 *   - uncertain 永远不能显示成「可选」；
 *   - COMPLETED + 有失败源 必须说「部分来源失败」；
 *   - SUCCESS/EMPTY/DISABLED/FAILED/未执行 五态互不混淆；
 *   - 任何状态都不得出现采购批准类措辞。
 */
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://ci:ci@127.0.0.1:5432/ci?schema=public";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;

const APPROVAL_WORDS = /认证通过|本标合格|首选供应商|可下单|合格供应商/;

async function main() {
  const { procurementGroupOf, mandatoryDisplay, PROCUREMENT_GROUPS, PROCUREMENT_FACT_SLOTS } =
    await import("../procurement-view");
  const labels = await import("../workspace-labels");

  console.log("A1：category → 采购分组（未知一律落「其他」，不猜品类）");
  assert.equal(procurementGroupOf("safety"), "compliance");
  assert.equal(procurementGroupOf("shop_drawings"), "samples");
  assert.equal(procurementGroupOf("installation"), "delivery");
  assert.equal(procurementGroupOf("warranty"), "warranty");
  assert.equal(procurementGroupOf("pricing"), "commercial");
  assert.equal(procurementGroupOf("technical"), "product");
  assert.equal(procurementGroupOf("  TECHNICAL "), "product", "大小写与空白归一");
  assert.equal(procurementGroupOf(null), "other");
  assert.equal(procurementGroupOf(""), "other");
  assert.equal(procurementGroupOf("something_new"), "other", "未知类别不猜，落「其他」");
  const groupKeys = new Set(PROCUREMENT_GROUPS.map((g) => g.key));
  for (const c of ["product", "safety", "samples", "delivery", "warranty", "pricing", "other"]) {
    assert.ok(groupKeys.has(procurementGroupOf(c)), `${c} 的分组必须在目录内`);
  }

  console.log("A2：三值文案——uncertain 绝不显示成「可选」");
  assert.equal(mandatoryDisplay(true).label, "强制要求");
  assert.equal(mandatoryDisplay("uncertain").label, "强制性待确认");
  assert.equal(mandatoryDisplay(false).label, "非强制要求");
  for (const v of [true, false, "uncertain"] as const) {
    const d = mandatoryDisplay(v);
    assert.ok(!d.label.includes("可选"), `${String(v)} 不得出现「可选」字样`);
    assert.ok(d.hint.length > 0, "每个三值都要有解释");
  }
  assert.ok(mandatoryDisplay("uncertain").hint.includes("不得当作可选"));

  console.log("A3：关键事实槽位只列采购关心的，且都有中文标签");
  assert.ok(PROCUREMENT_FACT_SLOTS.length >= 6);
  for (const s of PROCUREMENT_FACT_SLOTS) {
    assert.ok(s.label && s.key, "槽位需要 key 与中文标签");
  }

  console.log("B1：信号状态文案（关联 ≠ 采购批准）");
  assert.equal(labels.signalStatusDisplay("NEW").label, "待查看");
  assert.equal(labels.signalStatusDisplay("REVIEWED").label, "已查看待处理");
  assert.equal(labels.signalStatusDisplay("LINKED").label, "已关联供应商");
  assert.equal(labels.signalStatusDisplay("REJECTED").label, "不采用");
  for (const st of ["NEW", "REVIEWED", "LINKED", "REJECTED"]) {
    const d = labels.signalStatusDisplay(st);
    assert.ok(!APPROVAL_WORDS.test(d.label), `${st} 文案不得暗示采购批准`);
  }
  assert.ok(labels.signalStatusDisplay("LINKED").hint?.includes("不代表通过采购审核"));

  console.log("B2：身份解析结论与扫描完整性");
  assert.ok(labels.resolutionDecisionDisplay("MATCHED_EXISTING").label.includes("待人工确认"));
  assert.ok(labels.resolutionDecisionDisplay("NEEDS_HUMAN_REVIEW").label.includes("需人工判断"));
  assert.ok(labels.resolutionDecisionDisplay("NEW_SUPPLIER_CANDIDATE").label.includes("未匹配"));
  assert.equal(labels.scanCompletenessDisplay(true).tone, "success");
  assert.equal(labels.scanCompletenessDisplay(false).tone, "warning");
  assert.ok(labels.scanCompletenessDisplay(false).hint?.includes("不可用作强匹配"));

  console.log("C1：Run 收口文案——COMPLETED 有失败源必须说「部分来源失败」");
  const mixed = labels.runOutcomeSummary("COMPLETED", {
    saved: { status: "SUCCESS" },
    OPEN_WEB: { status: "FAILED" },
  });
  assert.ok(mixed.label.includes("部分来源失败"), mixed.label);
  assert.ok(!/全部来源.*成功/.test(mixed.label));
  assert.equal(mixed.tone, "warning");

  const allGood = labels.runOutcomeSummary("COMPLETED", { saved: { status: "SUCCESS" } });
  assert.equal(allGood.label, "搜索已结束");
  assert.ok(!/全部来源.*成功/.test(allGood.label), "成功也不吹成「全部来源成功」");

  const allEmpty = labels.runOutcomeSummary("COMPLETED", {
    saved: { status: "EMPTY" },
    memory: { status: "EMPTY" },
  });
  assert.ok(allEmpty.label.includes("均无结果"));

  const nothingRan = labels.runOutcomeSummary("COMPLETED", {
    OPEN_WEB: { status: "DISABLED" },
    memory: { status: "PLANNED" },
  });
  assert.ok(nothingRan.label.includes("没有任何来源实际执行"), nothingRan.label);

  assert.ok(labels.runOutcomeSummary("FAILED", {}).label.includes("所有已执行来源都失败"));
  assert.ok(labels.runOutcomeSummary("CANCELLED", {}).hint?.includes("晚到的结果会被丢弃"));
  assert.equal(labels.runOutcomeSummary("RUNNING", {}).label, "搜索中");
  assert.equal(labels.runOutcomeSummary("PLANNED", null).label, "待开始");

  console.log("C2：来源五态互不混淆");
  const seen = new Set<string>();
  for (const s of ["SUCCESS", "EMPTY", "DISABLED", "FAILED", "PLANNED"]) {
    const d = labels.sourceStatusDisplay(s);
    assert.ok(!seen.has(d.label), `来源状态文案必须互不相同：${s} → ${d.label}`);
    seen.add(d.label);
  }
  assert.equal(labels.sourceStatusDisplay("DISABLED").label, "未启用");
  assert.equal(labels.sourceStatusDisplay("PLANNED").label, "未执行");
  assert.equal(labels.sourceStatusDisplay("EMPTY").label, "无结果");

  console.log("D1：平台能力如实展示（公开搜索 ≠ 直连平台；视频号需手动）");
  assert.ok(labels.platformDisplay("DOUYIN").hint?.includes("未直连平台"));
  assert.ok(labels.platformDisplay("XIAOHONGSHU").hint?.includes("未直连平台"));
  assert.ok(labels.platformDisplay("WECHAT_CHANNELS").hint?.includes("手动提交"));
  assert.ok(labels.platformDisplay("ONE688").hint?.includes("未实现"));
  assert.ok(labels.sourceOriginDisplay("USER_SUBMITTED").hint?.includes("未读取完整视频或帖子"));
  assert.ok(labels.sourceOriginDisplay("PUBLIC_WEB").hint?.includes("未抓取页面"));

  console.log("E1：canonical 阻断原因有面向用户的中文解释");
  for (const code of [
    "RISKS_SECTION_MISSING",
    "STRUCTURED_JSON_NULL",
    "NON_CANONICAL_WRITER_SHAPE",
    "RISKS_NOT_ARRAY",
    "MULTIPLE_UNCERTAIN_AGGREGATES",
    "RELATED_IDS_MEMBER_INVALID",
    "UNCERTAIN_LIST_AT_CAP",
    "SOMETHING_ELSE",
  ]) {
    const t = labels.canonicalBlockReasonText(code);
    assert.ok(t.length > 0 && !t.includes(code), `${code} 需要中文解释而不是原样码`);
  }
  assert.ok(labels.canonicalBlockReasonText("UNCERTAIN_LIST_AT_CAP").includes("截断"));

  console.log("\nprocurement-view / workspace-labels（S3-A 纯核）全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
