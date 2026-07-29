/**
 * Phase C：状态机 / 安全检查 / 相似度 / Playbook 门禁
 * npx tsx src/lib/operations/__tests__/publish-pipeline.test.ts
 */
import {
  canTransition,
  normalizePublishStatus,
  buildIdempotencyKey,
} from "../publish-status";
import { evaluatePublishSafety } from "../publish-safety";
import {
  assessCrossAccountSimilarity,
  jaccardSimilarity,
} from "../similarity";
import { classifyPostizProviderState } from "../postiz";

let total = 0;
let failed = 0;
function ok(cond: boolean, name: string) {
  total += 1;
  if (cond) console.log(`✓ ${name}`);
  else {
    failed += 1;
    console.error(`✗ ${name}`);
  }
}

// 状态兼容
ok(normalizePublishStatus("review") === "pending_human_approval", "review→pending");
ok(canTransition("draft", "queued").ok === false, "禁止 draft→queued");
ok(canTransition("draft", "published").ok === false, "禁止 draft→published");
ok(canTransition("pending_human_approval", "queued").ok === false, "禁止 pending→queued");
ok(canTransition("blocked", "queued").ok === false, "禁止 blocked→queued");
ok(canTransition("failed", "published").ok === false, "禁止 failed→published");
ok(canTransition("pending_human_approval", "approved").ok === true, "pending→approved");
ok(canTransition("approved", "queued").ok === true, "approved→queued");
ok(canTransition("queued", "published").ok === true, "queued→published（轮询证据）");
ok(canTransition("blocked", "pending_human_approval").ok === true, "blocked→pending 可恢复");

ok(
  buildIdempotencyKey("org1", "job1", 2) === "org1:job1:v2",
  "幂等键稳定",
);

// 安全：无 Playbook + warn + 自动 = block
const autoNoPb = evaluatePublishSafety({
  captionText: "Before and after motorized shades in North York living room",
  videoUrl: "https://cdn.example.com/v.mp4",
  hasApprovedPlaybook: false,
  enforcementMode: "warn",
  autoPublish: true,
});
ok(
  autoNoPb.issues.some((i) => i.code === "PLAYBOOK_NOT_APPROVED_LEGACY_FALLBACK"),
  "自动发布无 Playbook 产生 LEGACY_FALLBACK",
);
ok(autoNoPb.result === "block", "warn 模式下自动发布无 PB 阻断");

const humanNoPb = evaluatePublishSafety({
  captionText: "Before and after motorized shades in North York living room",
  videoUrl: "https://cdn.example.com/v.mp4",
  hasApprovedPlaybook: false,
  enforcementMode: "warn",
  autoPublish: false,
});
ok(
  humanNoPb.issues.some(
    (i) =>
      i.code === "PLAYBOOK_NOT_APPROVED_LEGACY_FALLBACK" && i.severity === "warn",
  ),
  "人工兼容产生 warning",
);
ok(humanNoPb.result === "warn", "人工兼容不硬阻断（仅 warn）");

const enforce = evaluatePublishSafety({
  captionText: "Nice shades for your home",
  videoUrl: "https://cdn.example.com/v.mp4",
  hasApprovedPlaybook: false,
  enforcementMode: "enforce",
  autoPublish: false,
});
ok(
  enforce.issues.some((i) => i.code === "PLAYBOOK_REQUIRED" && i.severity === "block"),
  "enforce 无 PB 阻断审批",
);

// 相似度
ok(jaccardSimilarity("hello world foo", "hello world bar") > 0.4, "jaccard 基础");
const sim = assessCrossAccountSimilarity({
  candidateText: "same body text about motorized blinds for GTA homes today",
  peers: [
    {
      publishJobId: "j2",
      text: "same body text about motorized blinds for GTA homes today",
    },
  ],
  thresholds: { warnAt: 0.5, blockAt: 0.8 },
});
ok(sim.duplicateRisk === "high", "高相似 block 级");

const safetySim = evaluatePublishSafety({
  captionText: "same body text about motorized blinds for GTA homes today",
  videoUrl: "https://cdn.example.com/v.mp4",
  hasApprovedPlaybook: true,
  enforcementMode: "warn",
  autoPublish: true,
  similarity: sim,
});
ok(
  safetySim.issues.some((i) => i.code === "CROSS_ACCOUNT_SIMILARITY" && i.severity === "block"),
  "高相似进入 block",
);

// Postiz 分类
ok(
  classifyPostizProviderState("published").publishJobStatus === "published",
  "postiz published",
);
ok(
  classifyPostizProviderState("SCHEDULED").publishJobStatus === "queued",
  "postiz scheduled 保持 queued",
);
ok(
  classifyPostizProviderState(null).publishJobStatus === "queued",
  "无状态不标 published",
);

console.log(`\n结果: ${total - failed}/${total} passed`);
if (failed) process.exit(1);
