/**
 * 平台级企微凭证键解析 — 无依赖冒烟
 * 运行：npx tsx scripts/verify-platform-wecom.ts
 */

import {
  PLATFORM_WECOM_ORG_ID,
  isPlatformWecomOrgKey,
  resolveWecomCredentialOrgId,
} from "../src/lib/messaging/platform-wecom";

let failed = 0;
function assert(cond: boolean, name: string) {
  if (!cond) {
    failed++;
    console.error("FAIL:", name);
  } else {
    console.log("ok:", name);
  }
}

assert(isPlatformWecomOrgKey(null), "null → platform");
assert(isPlatformWecomOrgKey(""), "empty → platform");
assert(isPlatformWecomOrgKey("platform"), "platform → platform");
assert(isPlatformWecomOrgKey(PLATFORM_WECOM_ORG_ID), "sentinel → platform");
assert(!isPlatformWecomOrgKey("org_abc"), "org_abc → not platform");
assert(
  resolveWecomCredentialOrgId(null) === PLATFORM_WECOM_ORG_ID,
  "resolve null",
);
assert(
  resolveWecomCredentialOrgId("platform") === PLATFORM_WECOM_ORG_ID,
  "resolve platform",
);
assert(resolveWecomCredentialOrgId("org_abc") === "org_abc", "resolve org");

if (failed > 0) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
