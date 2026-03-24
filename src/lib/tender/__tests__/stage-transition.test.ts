/**
 * 阶段推进规则层 — 纯逻辑测试
 *
 * 运行方式: npx tsx src/lib/tender/__tests__/stage-transition.test.ts
 *
 * 覆盖场景：
 * 1. 合法单步推进
 * 2. 非法回退
 * 3. 重复推进（幂等）
 * 4. 跳级 require_human_review
 * 5. P0 策略：所有合法推进均 require_human_review
 * 6. tenderStatus 映射一致性
 * 7. AI suggestion schema 校验
 */

import {
  validateStageTransition,
  STAGE_ORDER,
  STAGE_LABEL,
  STAGE_TO_TIMESTAMP,
  STAGE_TO_TENDER_STATUS,
} from "../stage-transition";
import { extractWorkSuggestion } from "@/lib/ai/parser";
import type { TenderStage } from "../types";

const passed: string[] = [];
const failed: string[] = [];

function assert(condition: boolean, name: string) {
  if (condition) {
    passed.push(name);
  } else {
    failed.push(name);
    console.error(`  FAIL: ${name}`);
  }
}

// ── 1. 合法单步推进 ──

function testLegalSingleStep() {
  const pairs: [TenderStage, TenderStage][] = [
    ["initiation", "distribution"],
    ["distribution", "interpretation"],
    ["interpretation", "supplier_inquiry"],
    ["supplier_inquiry", "supplier_quote"],
    ["supplier_quote", "submission"],
  ];

  for (const [from, to] of pairs) {
    const result = validateStageTransition(from, to, 0.95);
    assert(
      result.decision === "require_human_review",
      `单步 ${STAGE_LABEL[from]} → ${STAGE_LABEL[to]} 应为 require_human_review`
    );
    assert(
      result.targetStage === to,
      `单步 ${from} → ${to} targetStage 应为 ${to}`
    );
  }
}

// ── 2. 非法回退 ──

function testIllegalRegression() {
  const pairs: [TenderStage, TenderStage][] = [
    ["submission", "supplier_quote"],
    ["interpretation", "initiation"],
    ["supplier_inquiry", "distribution"],
  ];

  for (const [from, to] of pairs) {
    const result = validateStageTransition(from, to);
    assert(
      result.decision === "deny",
      `回退 ${STAGE_LABEL[from]} → ${STAGE_LABEL[to]} 应为 deny`
    );
    assert(
      result.targetStage === null,
      `回退 ${from} → ${to} targetStage 应为 null`
    );
  }
}

// ── 3. 重复推进（同阶段）→ no_op ──

function testDuplicateStage() {
  for (const stage of STAGE_ORDER) {
    const result = validateStageTransition(stage, stage);
    assert(
      result.decision === "no_op",
      `重复推进 ${stage} → ${stage} 应为 no_op`
    );
    assert(
      result.targetStage === stage,
      `重复推进 ${stage} no_op 时 targetStage 应保留原值`
    );
  }
}

// ── 4. 跳级 ──

function testSkipStages() {
  const result = validateStageTransition("initiation", "supplier_inquiry", 0.95);
  assert(
    result.decision === "require_human_review",
    "跳级 initiation → supplier_inquiry 应为 require_human_review"
  );

  const result2 = validateStageTransition("initiation", "submission", 0.95);
  assert(
    result2.decision === "require_human_review",
    "跳级 initiation → submission 应为 require_human_review"
  );
}

// ── 5. 无效阶段值 ──

function testInvalidStage() {
  const result = validateStageTransition(
    "initiation",
    "nonexistent" as TenderStage
  );
  assert(result.decision === "deny", "无效目标阶段应为 deny");
}

// ── 6. tenderStatus 映射一致性 ──

function testMappingConsistency() {
  for (const stage of STAGE_ORDER) {
    if (stage === "initiation") continue;
    assert(
      STAGE_TO_TIMESTAMP[stage] !== undefined,
      `${stage} 应有对应的时间戳字段映射`
    );
    assert(
      STAGE_TO_TENDER_STATUS[stage] !== undefined,
      `${stage} 应有对应的 tenderStatus 映射`
    );
  }

  assert(
    STAGE_TO_TIMESTAMP["initiation"] === undefined,
    "initiation 不应有时间戳映射"
  );
}

// ── 7. AI suggestion schema 校验 ──

function testParserStageAdvance() {
  const validJson = `分析完成后建议推进。
[WORK_JSON]
{"type":"stage_advance","stageAdvance":{"projectId":"proj-123","project":"测试项目","targetStage":"interpretation","reason":"招标文件已解读完成","confidence":0.9,"evidence":["已完成文件审阅","资质条件已确认"]}}
[/WORK_JSON]`;

  const { suggestion } = extractWorkSuggestion(validJson);
  assert(suggestion !== null, "合法 stage_advance JSON 应成功解析");
  assert(suggestion?.type === "stage_advance", "type 应为 stage_advance");
  assert(
    suggestion?.stageAdvance?.targetStage === "interpretation",
    "targetStage 应为 interpretation"
  );
  assert(
    suggestion?.stageAdvance?.confidence === 0.9,
    "confidence 应为 0.9"
  );
  assert(
    suggestion?.stageAdvance?.evidence?.length === 2,
    "evidence 应有 2 条"
  );

  // 无效阶段值应被拒绝
  const invalidStageJson = `[WORK_JSON]
{"type":"stage_advance","stageAdvance":{"projectId":"p1","project":"p","targetStage":"invalid_stage","reason":"test","confidence":0.9,"evidence":[]}}
[/WORK_JSON]`;
  const { suggestion: invalid } = extractWorkSuggestion(invalidStageJson);
  assert(
    invalid === null,
    "无效 targetStage 应导致解析返回 null"
  );

  // 缺少 reason 应被拒绝
  const noReasonJson = `[WORK_JSON]
{"type":"stage_advance","stageAdvance":{"projectId":"p1","project":"p","targetStage":"interpretation","reason":"","confidence":0.9,"evidence":[]}}
[/WORK_JSON]`;
  const { suggestion: noReason } = extractWorkSuggestion(noReasonJson);
  assert(
    noReason === null,
    "空 reason 应导致解析返回 null"
  );

  // confidence 超范围应被钳位
  const highConfJson = `[WORK_JSON]
{"type":"stage_advance","stageAdvance":{"projectId":"p1","project":"p","targetStage":"distribution","reason":"已分发","confidence":1.5,"evidence":["已确认"]}}
[/WORK_JSON]`;
  const { suggestion: highConf } = extractWorkSuggestion(highConfJson);
  assert(
    highConf?.stageAdvance?.confidence === 1,
    "confidence > 1 应被钳位为 1"
  );

  // 普通 task JSON 不受影响
  const taskJson = `[WORK_JSON]
{"type":"task","task":{"title":"测试","description":"desc","priority":"medium","dueDate":null,"projectId":null,"project":null,"needReminder":false}}
[/WORK_JSON]`;
  const { suggestion: taskSug } = extractWorkSuggestion(taskJson);
  assert(taskSug?.type === "task", "task 类型应正常解析");
  assert(taskSug?.stageAdvance === null, "task 类型的 stageAdvance 应为 null");
}

// ── Run ──

console.log("=== 阶段推进规则层测试 ===\n");
testLegalSingleStep();
testIllegalRegression();
testDuplicateStage();
testSkipStages();
testInvalidStage();
testMappingConsistency();
testParserStageAdvance();

console.log(`\n通过: ${passed.length}  失败: ${failed.length}`);
if (failed.length > 0) {
  console.error("\n失败用例:");
  for (const f of failed) console.error(`  - ${f}`);
  process.exit(1);
} else {
  console.log("全部通过 ✓");
}
