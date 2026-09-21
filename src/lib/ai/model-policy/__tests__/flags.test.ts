/**
 * 运行：npx tsx src/lib/ai/model-policy/__tests__/flags.test.ts
 */
import {
  GPT6_PHASE1_WORKFLOWS,
  gpt6WorkflowAllowlist,
  isGpt6AstraEnabledWithEnv,
  isGpt6WorkflowEnabledWithEnv,
} from "../flags";

let total = 0;
let failed = 0;
function expect(c: boolean, m: string) {
  total++;
  if (c) console.log(`✓ ${m}`);
  else {
    failed++;
    console.error(`✗ ${m}`);
  }
}

expect(
  isGpt6AstraEnabledWithEnv({ userId: "u1" }, {}) === false,
  "默认关闭",
);

expect(
  isGpt6AstraEnabledWithEnv(
    { userId: "u1" },
    { ENABLE_GPT6_ASTRA: "1" },
  ) === false,
  "仅总开关且无灰度/白名单 → fail-closed",
);

expect(
  isGpt6AstraEnabledWithEnv(
    { userId: "u1" },
    { ENABLE_GPT6_ASTRA: "1", ENABLE_GPT6_ASTRA_ROLLOUT_PCT: "100" },
  ) === true,
  "ENABLED + pct 100 → 开",
);

expect(
  isGpt6AstraEnabledWithEnv(
    { orgId: "org-a" },
    {
      ENABLE_GPT6_ASTRA: "1",
      ENABLE_GPT6_ASTRA_ORG_ALLOWLIST: "org-a",
    },
  ) === true,
  "ORG allowlist 命中 → 开",
);

expect(
  isGpt6AstraEnabledWithEnv(
    { orgId: "org-b" },
    {
      ENABLE_GPT6_ASTRA: "1",
      ENABLE_GPT6_ASTRA_ORG_ALLOWLIST: "org-a",
      ENABLE_GPT6_ASTRA_ROLLOUT_PCT: "100",
    },
  ) === false,
  "ORG allowlist 未命中不可被 ROLLOUT 绕过",
);

expect(
  isGpt6WorkflowEnabledWithEnv(
    "supervisor",
    { userId: "u1" },
    { ENABLE_GPT6_ASTRA: "1", ENABLE_GPT6_ASTRA_ROLLOUT_PCT: "100" },
  ) === true,
  "Phase 1 supervisor 默认在 workflow allowlist",
);

expect(
  isGpt6WorkflowEnabledWithEnv(
    "classifier",
    { userId: "u1" },
    { ENABLE_GPT6_ASTRA: "1", ENABLE_GPT6_ASTRA_ROLLOUT_PCT: "100" },
  ) === false,
  "classifier 默认不升级",
);

expect(
  isGpt6WorkflowEnabledWithEnv(
    "coder",
    { userId: "u1" },
    {
      ENABLE_GPT6_ASTRA: "1",
      ENABLE_GPT6_ASTRA_ROLLOUT_PCT: "100",
      ENABLE_GPT6_ASTRA_WORKFLOWS: "supervisor,coder",
    },
  ) === true,
  "显式 WORKFLOWS 可加入 coder",
);

expect(
  GPT6_PHASE1_WORKFLOWS.includes("researcher"),
  "Phase 1 含 researcher",
);
expect(
  (GPT6_PHASE1_WORKFLOWS as readonly string[]).includes("tender"),
  "Phase 1 含 tender（QUALITY_FIRST）",
);

expect(
  [...gpt6WorkflowAllowlist({})].sort().join(",") ===
    [...GPT6_PHASE1_WORKFLOWS].sort().join(","),
  "未配置 WORKFLOWS 时使用 Phase 1 集合",
);

const composeEnv = {
  ENABLE_GPT6_ASTRA: "1",
  ENABLE_GPT6_ASTRA_ORG_ALLOWLIST: "org-A",
  ENABLE_GPT6_ASTRA_ROLE_ALLOWLIST: "tender",
  ENABLE_GPT6_ASTRA_USER_ALLOWLIST: "u-ok",
};
expect(
  isGpt6AstraEnabledWithEnv(
    { orgId: "org-A", role: "tender", userId: "u-ok" },
    composeEnv,
  ) === true,
  "ROLE + USER + ORG allowlist 同时命中 → 开",
);
expect(
  isGpt6AstraEnabledWithEnv(
    { orgId: "org-B", role: "tender", userId: "u-ok" },
    composeEnv,
  ) === false,
  "ORG miss 不能被 ROLE/USER 命中绕过",
);
expect(
  isGpt6AstraEnabledWithEnv(
    { orgId: "org-A", role: "researcher", userId: "u-ok" },
    composeEnv,
  ) === false,
  "ROLE miss 不能被 ORG/USER 命中绕过",
);
expect(
  isGpt6AstraEnabledWithEnv(
    { orgId: "org-A", role: "tender", userId: "u-other" },
    composeEnv,
  ) === false,
  "USER miss 不能被 ORG/ROLE 命中绕过",
);
expect(
  isGpt6AstraEnabledWithEnv(
    { orgId: "org-A", role: "tender" },
    composeEnv,
  ) === false,
  "USER allowlist 配置时缺 userId → fail-closed",
);
expect(
  isGpt6AstraEnabledWithEnv(
    { role: "tender", userId: "u-ok" },
    composeEnv,
  ) === false,
  "ORG allowlist 配置时缺 org → fail-closed",
);

console.log(
  `\n${failed === 0 ? "✅" : "❌"} gpt6-flags: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
