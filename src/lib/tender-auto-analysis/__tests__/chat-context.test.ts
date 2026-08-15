/**
 * Phase G — Tender 会话 package 上下文（纯格式化）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/chat-context.test.ts
 */

import { formatTenderPackageContext } from "../chat-context";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("tender-auto-analysis chat-context");

// READY：含摘要/采购单位/强制要求/风险/澄清，且带 grounded 免编造指令
{
  const out = formatTenderPackageContext({
    status: "REVIEW_REQUIRED",
    summaryText: "供应并安装电动卷帘。",
    summaryJson: { brief: { buyer: "Strathcona County", product: "Motorized shades", blockers: [] } },
    requirements: [
      { originalRequirement: "5-year warranty on motors", mandatory: true, complianceStatus: "NOT_ASSESSED" },
      { originalRequirement: "Submit shop drawings", mandatory: false, complianceStatus: "NEEDS_CLARIFICATION" },
    ],
    clarifications: [{ question: "Confirm motor voltage?", priority: "BLOCKING" }],
    risksText: "• [CRITICAL] Motor voltage conflict",
  });
  ok(out.includes("青砚 Package AI"), "含 Package AI 标题");
  ok(out.includes("不要编造"), "含 grounded 免编造指令");
  ok(out.includes("Strathcona County"), "含采购单位");
  ok(out.includes("[强制] 5-year warranty"), "强制要求标注");
  ok(out.includes("（需澄清）"), "NEEDS_CLARIFICATION 标注");
  ok(out.includes("Motor voltage conflict"), "含风险/冲突");
  ok(out.includes("Confirm motor voltage"), "含待澄清问题");
  ok(!out.includes("当前分析状态为"), "READY 不显示未就绪提示");
}

// 未就绪（PENDING）：提示状态可能不完整
{
  const out = formatTenderPackageContext({
    status: "PENDING",
    summaryText: null,
    summaryJson: null,
    requirements: [],
    clarifications: [],
    risksText: null,
  });
  ok(out.includes("当前分析状态为 PENDING"), "未就绪显示状态提示");
  ok(out.includes("不要编造"), "仍带 grounded 指令");
}

// 字符预算裁剪
{
  const bigReqs = Array.from({ length: 200 }, (_, i) => ({
    originalRequirement: `Requirement number ${i} with some long descriptive text to fill space`,
    mandatory: false,
    complianceStatus: "NOT_ASSESSED",
  }));
  const out = formatTenderPackageContext({
    status: "APPROVED",
    summaryText: "x".repeat(100),
    summaryJson: null,
    requirements: bigReqs,
    clarifications: [],
    risksText: null,
  });
  ok(out.length <= 9001, "总长度受 MAX_TOTAL_CHARS 约束");
}

console.log(`\nchat-context: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
