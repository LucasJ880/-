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
  withIndustryPackModules,
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

ok(isModuleEnabled(sunny, "window_covering"), "Sunny 默认启用 window_covering");
ok(!isModuleEnabled(mengxin, "window_covering"), "梦馨不含 window_covering");
ok(
  !navHrefAllowedByModules("/sales/quote-sheet", mengxin),
  "梦馨侧栏隐藏电子报价单（窗饰专属）",
);
ok(
  !navHrefAllowedByModules("/blinds-orders", mengxin),
  "梦馨侧栏隐藏工艺单",
);
ok(
  navHrefAllowedByModules("/sales", mengxin),
  "梦馨保留销售工作区（客户 CRM）",
);
ok(
  navHrefAllowedByModules("/sales/quote-sheet", sunny),
  "Sunny 侧栏保留电子报价单",
);

// —— 行业包回退：老 Sunny 企业 modulesJson 未含 window_covering 时按行业包补上 ——
const legacySunny = parseOrgModulesJson({ enabled: ["sales", "operations"] });
const patched = withIndustryPackModules(legacySunny, "window_covering_services_v1");
ok(
  !!patched && patched.enabled.includes("window_covering"),
  "窗饰行业包为老配置补 window_covering",
);
ok(
  withIndustryPackModules(sunny, "window_covering_services_v1") === sunny,
  "已含 window_covering 时原样返回（幂等）",
);
ok(
  withIndustryPackModules(mengxin, "home_textile_trade_v1") === mengxin,
  "家纺行业包不补 window_covering",
);
ok(
  withIndustryPackModules(null, "window_covering_services_v1") === null,
  "无 modules 配置时不注入",
);
const emptyModules = parseOrgModulesJson({ enabled: [] });
ok(
  withIndustryPackModules(emptyModules, "window_covering_services_v1") === emptyModules,
  "空 enabled 保持 fail-closed 语义不注入",
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
