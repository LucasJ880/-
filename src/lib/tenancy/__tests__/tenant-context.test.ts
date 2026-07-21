/**
 * TenantContext / assert / modules 纯函数测试
 * 运行：npx tsx src/lib/tenancy/__tests__/tenant-context.test.ts
 */

import {
  assertEntityBelongsToOrg,
  entityBelongsToOrg,
  TenantAccessError,
  parseOrgModulesJson,
  isModuleEnabled,
  navHrefAllowedByModules,
  pathnameDeclaresOrg,
  CONFIG_SCOPE_PRIORITY,
  DEFAULT_SUNNY_MODULES,
  DEFAULT_MENGXIN_MODULES,
} from "../index";

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

console.log("tenancy context / modules");

ok(entityBelongsToOrg("org_a", "org_a"), "同 org 归属为真");
ok(!entityBelongsToOrg("org_b", "org_a"), "跨 org 归属为假");
ok(!entityBelongsToOrg(null, "org_a"), "空 orgId 为假");

try {
  assertEntityBelongsToOrg("org_b", "org_a");
  ok(false, "跨 org 应抛错");
} catch (e) {
  ok(e instanceof TenantAccessError && e.status === 404, "跨 org 抛 TenantAccessError 404");
}

try {
  assertEntityBelongsToOrg("org_a", "org_a");
  ok(true, "同 org 断言通过");
} catch {
  ok(false, "同 org 断言通过");
}

const sunny = parseOrgModulesJson({ enabled: DEFAULT_SUNNY_MODULES });
ok(!!sunny && sunny.enabled.includes("sales"), "解析 Sunny modules");
ok(isModuleEnabled(sunny, "sales"), "Sunny 启用 sales");
ok(!isModuleEnabled(sunny, "trade"), "Sunny 默认未启用 trade");

const mengxin = parseOrgModulesJson({ enabled: DEFAULT_MENGXIN_MODULES });
ok(isModuleEnabled(mengxin, "trade"), "梦馨启用 trade");
ok(isModuleEnabled(mengxin, "product_content"), "梦馨启用 product_content");

ok(
  navHrefAllowedByModules("/trade", mengxin),
  "梦馨侧栏允许 /trade",
);
ok(
  !navHrefAllowedByModules("/trade", sunny),
  "Sunny 侧栏隐藏 /trade",
);
ok(
  navHrefAllowedByModules("/assistant", sunny),
  "未映射模块的路径默认可见",
);
ok(
  navHrefAllowedByModules("/sales", null),
  "未配置 modules 时不限制导航",
);

ok(
  pathnameDeclaresOrg(`product-content/org123/job/a.png`, "org123"),
  "pathname 含 orgId",
);
ok(
  !pathnameDeclaresOrg(`product-content/other/job/a.png`, "org123"),
  "pathname 跨 org 拒绝",
);

ok(
  CONFIG_SCOPE_PRIORITY[0] === "PLATFORM" &&
    CONFIG_SCOPE_PRIORITY[3] === "PROJECT",
  "ConfigScope 优先级顺序",
);

console.log(`\ntenant-context: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
