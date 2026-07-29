/**
 * Matrix Account Playbook — 权限 / 校验 / 合并规则
 * 运行：npx tsx src/lib/operations/__tests__/playbook.test.ts
 */
import {
  assertCanApprovePlaybook,
  canApprovePlaybook,
  canEditPlaybookDraft,
  canReadPlaybook,
  canSubmitPlaybook,
} from "../playbook/permissions";
import {
  canSubmitValidation,
  validatePlaybookContent,
} from "../playbook/validate";
import { defaultMergeMode, mergeField, readOverrides } from "../playbook/merge";

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

// ── 权限矩阵 ──
ok(canApprovePlaybook("admin") === true, "admin 可批准");
ok(canApprovePlaybook("boss") === true, "boss 可批准");
ok(canApprovePlaybook("operations") === false, "operations 不可批准");
ok(canApprovePlaybook("sales") === false, "sales 不可批准");

ok(canEditPlaybookDraft("operations") === true, "operations 可编辑草稿");
ok(canEditPlaybookDraft("sales") === false, "sales 不可编辑草稿");
ok(canSubmitPlaybook("operations") === true, "operations 可提交");
ok(canReadPlaybook("sales") === true, "sales 可读");

ok(
  assertCanApprovePlaybook({
    role: "operations",
    actorUserId: "u1",
    submittedById: "u1",
  }).ok === false,
  "operations 自批被拒",
);
ok(
  assertCanApprovePlaybook({
    role: "admin",
    actorUserId: "admin1",
    submittedById: "ops1",
  }).ok === true,
  "admin 可批他人提交",
);

// ── 校验 ──
const empty = validatePlaybookContent({});
ok(empty.validationResult === "fail", "空内容 fail");
ok(empty.completenessScore < 50, "空内容完整度低");
ok(canSubmitValidation(empty.validationResult) === false, "fail 不可提交");

const full = validatePlaybookContent({
  accountRole: "矩阵种草号",
  businessObjective: "提升品牌询盘与私信转化",
  positioning: "北美遮阳窗帘本地服务专家",
  toneOfVoice: "专业友好、少硬广",
  targetAudienceJson: [{ segment: "GTA homeowners" }],
  contentPillarsJson: ["before-after", "education", "local-proof"],
  ctaStrategyJson: { primary: "DM for quote" },
  personaBackground: "本地安装顾问人设背景说明",
  kpiTargetsJson: { weeklyPosts: 5 },
  forbiddenTopicsJson: ["保证爆单"],
});
ok(full.validationResult === "pass" || full.validationResult === "warn", "完整内容可过");
ok(full.completenessScore >= 80, "完整内容高分");
ok(canSubmitValidation(full.validationResult) === true, "pass/warn 可提交");

// ── 合并规则 ──
ok(defaultMergeMode("contentPillarsJson") === "replace", "支柱默认 replace");
ok(defaultMergeMode("kpiTargetsJson") === "merge-by-key", "KPI 默认 merge-by-key");

ok(
  JSON.stringify(
    mergeField({
      base: ["a"],
      override: ["b"],
      mode: "replace",
    }),
  ) === JSON.stringify(["b"]),
  "replace 数组",
);
ok(
  JSON.stringify(
    mergeField({
      base: ["a"],
      override: ["b"],
      mode: "append",
    }),
  ) === JSON.stringify(["a", "b"]),
  "append 数组",
);
ok(
  JSON.stringify(
    mergeField({
      base: { a: 1, b: 2 },
      override: { b: 9, c: 3 },
      mode: "merge-by-key",
    }),
  ) === JSON.stringify({ a: 1, b: 9, c: 3 }),
  "merge-by-key 对象",
);
ok(
  JSON.stringify(
    mergeField({
      base: ["keep"],
      override: ["drop"],
      mode: "disabled",
    }),
  ) === JSON.stringify(["keep"]),
  "disabled 保留下层",
);

const modes = readOverrides({
  contentPillarsJson: "append",
  bad: "hack",
  kpiTargetsJson: "merge-by-key",
});
ok(modes.contentPillarsJson === "append", "overrides 解析合法值");
ok(modes.bad === undefined, "overrides 忽略非法值");

console.log(`\n结果: ${total - failed}/${total} passed`);
if (failed) process.exit(1);
