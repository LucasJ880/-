/**
 * 产品内容总监 Phase1 本地冒烟（纯逻辑，不打 DB / Provider）
 *
 * 运行：npx tsx scripts/smoke-product-content.ts
 */

import { listMissingFields } from "../src/lib/product-content/industry-packs/home-textile";
import { compareSourcePriority, canAutoConfirm } from "../src/lib/product-content/facts/priority";
import { detectConflict, shouldOverwrite } from "../src/lib/product-content/facts/conflict";
import { resolveApprovalPolicy } from "../src/lib/product-content/approval/policy";
import { assertTransition, canApproveJob } from "../src/lib/product-content/jobs/status";
import { runHeuristicFidelityQa } from "../src/lib/product-content/qa/fidelity";
import { pickImageProvider } from "../src/lib/image-engine/types";

const mengxinFacts = {
  product_name: "梦馨法兰绒毛毯",
  sku: "MX-BLKT-001",
  category: "blanket",
  material: "100% Polyester Flannel",
  fabric_composition: "100% Polyester",
  size: "150x200cm",
  color: "Warm Beige",
  gsm: 280,
};

console.log("── 梦馨家纺样例缺失字段 ──");
const missing = listMissingFields(mengxinFacts);
console.log(
  missing.length === 0
    ? "必填字段齐全"
    : `仍缺：${missing.map((f) => f.key).join(", ")}`,
);

console.log("── 事实优先级 ──");
console.log(
  "user_statement > ai_inference:",
  compareSourcePriority("user_statement", "ai_inference") < 0,
);
console.log("ai_inference 不可自动确认:", !canAutoConfirm("ai_inference"));

console.log("── 冲突/覆盖 ──");
console.log("值冲突:", detectConflict("beige", "grey"));
console.log(
  "锁定不可覆盖:",
  !shouldOverwrite("user_statement", "excel", true),
);

console.log("── 审批策略 ──");
const settings = {
  defaultExecutionMode: "AUTOPILOT",
  autoAnalyzeFiles: true,
  autoCreateProductDraft: true,
  autoGenerateLowCostVisuals: true,
  autoRunFidelityQa: true,
  autoGenerateCopyDraft: true,
  autoGenerateFormalDocuments: false,
  autoProcessMultipleSkus: false,
  askBeforeHighCostModel: true,
  askBeforeCreativeMode: true,
  askBeforeFormalPdf: true,
  askBeforeOverwriteApprovedContent: true,
  askBeforeExternalSend: true,
  askBeforePublish: true,
};
console.log(
  "AUTOPILOT analyze:",
  resolveApprovalPolicy(settings as never, "AUTOPILOT", "analyze_files"),
);
console.log(
  "ALWAYS_ASK plan:",
  resolveApprovalPolicy(settings as never, "ALWAYS_ASK", "generate_copy_draft"),
);
console.log(
  "formal pdf:",
  resolveApprovalPolicy(settings as never, "AUTOPILOT", "generate_formal_pdf"),
);

console.log("── 状态机 ──");
assertTransition("DRAFT", "INGESTING");
assertTransition("READY_FOR_REVIEW", "APPROVED");
const gate = canApproveJob({
  openConflictCount: 0,
  pendingApprovalCount: 0,
  hasCopy: true,
  hasZipDocument: true,
  rejectedVisualCount: 0,
  unverifiedCertificationClaims: 0,
  requiredFieldsMissing: 0,
});
console.log("可批准门禁:", gate);

console.log("── Image / QA ──");
console.log(
  "EXACT provider:",
  pickImageProvider({ mode: "EXACT", geometryClass: "DEFORMABLE_SURFACE" }).id,
);
const qa = runHeuristicFidelityQa({
  mode: "EXACT",
  metadata: { placeholder: true },
});
console.log("EXACT dry-run QA:", qa.overallScore, qa.recommendedStatus);

console.log("\n✅ product-content smoke OK");
