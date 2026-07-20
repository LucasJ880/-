/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/feature-flags.test.ts
 */
import { isSupervisorEnabledWithEnv } from "../flags";

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

const base = {
  userId: "u1",
  role: "admin",
  orgId: "org-a",
  orgCode: "sunny-home-deco",
};

expect(
  !isSupervisorEnabledWithEnv(base, {
    AGENT_SUPERVISOR_ENABLED: "0",
    AGENT_SUPERVISOR_ROLLOUT_PCT: "100",
  }),
  "总开关关闭 → 关",
);

expect(
  !isSupervisorEnabledWithEnv(base, {
    AGENT_SUPERVISOR_ENABLED: "1",
    AGENT_SUPERVISOR_ORG_ALLOWLIST: "other-org",
    AGENT_SUPERVISOR_ROLE_ALLOWLIST: "admin",
    AGENT_SUPERVISOR_ROLLOUT_PCT: "100",
  }),
  "组织不在 Allowlist → 关（ROLLOUT=100 不能绕过）",
);

expect(
  !isSupervisorEnabledWithEnv(
    { ...base, role: "sales" },
    {
      AGENT_SUPERVISOR_ENABLED: "1",
      AGENT_SUPERVISOR_ORG_ALLOWLIST: "sunny-home-deco",
      AGENT_SUPERVISOR_ROLE_ALLOWLIST: "admin",
      AGENT_SUPERVISOR_ROLLOUT_PCT: "100",
    },
  ),
  "角色不匹配 → 关",
);

expect(
  !isSupervisorEnabledWithEnv(
    { ...base, role: "admin", orgCode: "other" },
    {
      AGENT_SUPERVISOR_ENABLED: "1",
      AGENT_SUPERVISOR_ORG_ALLOWLIST: "sunny-home-deco",
      AGENT_SUPERVISOR_ROLE_ALLOWLIST: "admin",
      AGENT_SUPERVISOR_ROLLOUT_PCT: "100",
    },
  ),
  "角色匹配但不能绕过组织限制",
);

expect(
  isSupervisorEnabledWithEnv(base, {
    AGENT_SUPERVISOR_ENABLED: "1",
    AGENT_SUPERVISOR_ORG_ALLOWLIST: "sunny-home-deco",
    AGENT_SUPERVISOR_ROLE_ALLOWLIST: "admin",
    AGENT_SUPERVISOR_ROLLOUT_PCT: "0",
  }),
  "组织+角色均匹配 → 开",
);

expect(
  !isSupervisorEnabledWithEnv(base, {
    AGENT_SUPERVISOR_ENABLED: "1",
    AGENT_SUPERVISOR_USER_ALLOWLIST: "other-user",
    AGENT_SUPERVISOR_ORG_ALLOWLIST: "sunny-home-deco",
    AGENT_SUPERVISOR_ROLLOUT_PCT: "100",
  }),
  "USER Allowlist 未命中 → 关（ROLLOUT 不能绕过）",
);

expect(
  isSupervisorEnabledWithEnv(base, {
    AGENT_SUPERVISOR_ENABLED: "1",
    AGENT_SUPERVISOR_ROLLOUT_PCT: "100",
  }),
  "无 Allowlist 且 ROLLOUT=100 → 开",
);

console.log(
  `\n${failed === 0 ? "✅" : "❌"} feature-flags: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
