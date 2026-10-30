/**
 * Matrix Account Playbook — 权限 / 校验 / 合并规则
 * 运行：npx tsx src/lib/operations/__tests__/playbook.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selfApprovalBlocked } from "../access";
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

// ── 权限（PERM-4b：按岗位权限键，不看平台角色；DB 行为见 ops-authorize-db.isolated）──
{
  const src = readFileSync(join(__dirname, "..", "playbook", "permissions.ts"), "utf-8");
  ok(!/role ===|isAdmin\(|isBoss\(|user\.role/.test(src), "Playbook 权限不再按平台角色字符串");
  ok(/canApprovePlaybook[\s\S]*OPS_CONTENT_APPROVE/.test(src), "批准 = operations.content.approve");
  ok(/canEditPlaybookDraft[\s\S]*OPS_CONTENT_DRAFT/.test(src) && /canSubmitPlaybook[\s\S]*OPS_CONTENT_DRAFT/.test(src), "起草 / 提交 = operations.content.draft");
  ok(/canReadPlaybook[\s\S]*OPS_READ_KEYS/.test(src), "读 = operations.read | manage");
  ok(/action === "approve" && selfApprovalBlockedFor/.test(src), "只有批准做自批判定，驳回不做");
}
ok(selfApprovalBlocked({ actorId: "u1", authorId: "u1", isPlatformSuperAdmin: false }), "提交人自批被拒");
ok(!selfApprovalBlocked({ actorId: "boss1", authorId: "ops1", isPlatformSuperAdmin: false }), "他人可批");
ok(!selfApprovalBlocked({ actorId: "lucas", authorId: "lucas", isPlatformSuperAdmin: true }), "平台 super_admin 自批例外");
ok(!selfApprovalBlocked({ actorId: "u1", authorId: null, isPlatformSuperAdmin: false }), "作者未知不拦");

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
