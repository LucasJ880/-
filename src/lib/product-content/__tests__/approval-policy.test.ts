/**
 * 审批策略解析
 * 运行：npx tsx src/lib/product-content/__tests__/approval-policy.test.ts
 */

import { resolveApprovalPolicy } from "../approval/policy";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

const baseSettings = {
  autoAnalyzeFiles: true,
  autoCreateProductDraft: true,
  autoGenerateLowCostVisuals: true,
  autoRunFidelityQa: true,
  autoGenerateCopyDraft: true,
  autoGenerateFormalDocuments: false,
  askBeforeHighCostModel: true,
  askBeforeCreativeMode: true,
  askBeforeFormalPdf: true,
  askBeforeOverwriteApprovedContent: true,
  askBeforeExternalSend: true,
  askBeforePublish: true,
};

ok(
  resolveApprovalPolicy(baseSettings, "AUTOPILOT", "analyze_files") === "AUTO_ALLOW",
  "AUTOPILOT + autoAnalyze → AUTO_ALLOW",
);
ok(
  resolveApprovalPolicy(baseSettings, "ALWAYS_ASK", "analyze_files") === "ASK_BEFORE",
  "ALWAYS_ASK 强制 ASK_BEFORE",
);
ok(
  resolveApprovalPolicy(baseSettings, "AUTOPILOT", "generate_formal_pdf") === "ASK_BEFORE",
  "正式 PDF 默认需确认",
);
ok(
  resolveApprovalPolicy(baseSettings, "AUTOPILOT", "modify_certification") === "MANUAL_ONLY",
  "认证修改 MANUAL_ONLY",
);
ok(
  resolveApprovalPolicy(
    { ...baseSettings, autoGenerateFormalDocuments: true },
    "AUTOPILOT",
    "generate_formal_zip",
  ) === "AUTO_ALLOW",
  "开启 autoGenerateFormalDocuments → ZIP 自动",
);

console.log(`\napproval-policy: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
