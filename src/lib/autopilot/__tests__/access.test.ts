/**
 * Autopilot A0 — access / default deny / admin 不旁路
 * 运行：npx tsx src/lib/autopilot/__tests__/access.test.ts
 */

import { SYSTEM_ROLE_PROFILES } from "@/lib/authorization/role-defaults";
import { isKnownPermission } from "@/lib/authorization/permissions";
import {
  evaluateAutopilotAccess,
  hasAutopilotCapability,
  isAutopilotOwner,
} from "../access";
import { AUTOPILOT_CAPABILITIES } from "../types";

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

console.log("autopilot access");

const ownerId = "user_owner_canonical";
const adminId = "user_admin_other";
const envOn = {
  AUTOPILOT_ENABLED: "1",
  AUTOPILOT_OWNER_USER_IDS: ownerId,
};
const envOff = {
  AUTOPILOT_ENABLED: "0",
  AUTOPILOT_OWNER_USER_IDS: ownerId,
};

ok(isAutopilotOwner(ownerId, envOn), "owner userId 命中");
ok(!isAutopilotOwner(adminId, envOn), "其他 userId 不是 owner");
ok(!isAutopilotOwner("Lucas", envOn), "显示名不是身份");
ok(!isAutopilotOwner(ownerId, { AUTOPILOT_OWNER_USER_IDS: "" }), "未配置 allowlist → 无人");

ok(
  hasAutopilotCapability({ id: ownerId, role: "user" }, "autopilot.view", envOn),
  "owner + flag → view",
);
ok(
  hasAutopilotCapability({ id: ownerId, role: "user" }, "autopilot.runs.read", envOn),
  "owner → runs.read",
);
ok(
  hasAutopilotCapability({ id: ownerId, role: "user" }, "autopilot.admin", envOn),
  "owner → admin capability",
);

ok(
  !hasAutopilotCapability({ id: adminId, role: "admin" }, "autopilot.view", envOn),
  "其他 admin 不能因角色获得 Autopilot",
);
ok(
  !hasAutopilotCapability({ id: adminId, role: "super_admin" }, "autopilot.admin", envOn),
  "super_admin 不自动获得 Autopilot",
);
ok(
  !hasAutopilotCapability({ id: ownerId, role: "admin" }, "autopilot.view", envOff),
  "flag 关闭时 owner 也不能访问",
);

ok(
  evaluateAutopilotAccess(
    { userId: ownerId, role: "admin", capability: "autopilot.view" },
    envOn,
  ).reason === "OK",
  "owner 判定 OK",
);
ok(
  evaluateAutopilotAccess(
    { userId: adminId, role: "admin", capability: "autopilot.view" },
    envOn,
  ).reason === "NOT_OWNER",
  "admin 判定 NOT_OWNER",
);
ok(
  evaluateAutopilotAccess(
    { userId: ownerId, capability: "autopilot.view" },
    envOff,
  ).reason === "FLAG_DISABLED",
  "flag off → FLAG_DISABLED",
);

for (const cap of AUTOPILOT_CAPABILITIES) {
  ok(isKnownPermission(cap), `PERMISSION_REGISTRY 含 ${cap}`);
}

ok(
  SYSTEM_ROLE_PROFILES.every((p) =>
    p.bindings.every((b) => !b.permissionKey.startsWith("autopilot.")),
  ),
  "系统 Role Profile 不绑定 autopilot.*（Default Deny）",
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
