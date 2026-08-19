/**
 * Autopilot 四层安全：nav / route 文件 / API / 无硬编码姓名
 * 运行：npx tsx src/lib/autopilot/__tests__/security-layers.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NAVIGATION_REGISTRY,
  isNavItemVisible,
  resolveNavigationTree,
  type NavigationFilterContext,
} from "@/lib/navigation";

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

function ctx(
  partial: Partial<NavigationFilterContext>,
): NavigationFilterContext {
  return {
    pathname: "/",
    platformRole: "admin",
    orgRole: "org_owner",
    hasMembership: true,
    workspaceIds: ["ws1"],
    modules: {
      enabled: ["sales", "trade", "operations", "marketing", "bids", "projects"],
    },
    isPlatformAdmin: true,
    ...partial,
  };
}

function flattenHrefs(
  items: ReturnType<typeof resolveNavigationTree>,
): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.href) out.push(item.href);
    if (item.children) out.push(...flattenHrefs(item.children));
  }
  return out;
}

console.log("autopilot security layers");

const autopilot = NAVIGATION_REGISTRY.find((i) => i.key === "autopilot");
ok(!!autopilot, "Autopilot 导航项存在");
ok(autopilot?.autopilotOwnerOnly === true, "导航项 autopilotOwnerOnly");
ok(
  autopilot?.children?.every((c) => c.autopilotOwnerOnly === true) === true,
  "子项全部 owner-only",
);

const adminNoOwner = ctx({ autopilotAllowed: false, platformRole: "admin" });
ok(
  !!autopilot && !isNavItemVisible(autopilot, adminNoOwner),
  "其他 admin：导航隐藏",
);
ok(
  !flattenHrefs(resolveNavigationTree(NAVIGATION_REGISTRY, adminNoOwner)).includes(
    "/ai/autopilot",
  ),
  "其他 admin：树中无 /ai/autopilot",
);

const salesAdmin = ctx({
  platformRole: "sales",
  isPlatformAdmin: false,
  autopilotAllowed: false,
});
ok(
  !!autopilot && !isNavItemVisible(autopilot, salesAdmin),
  "sales：导航隐藏",
);

const owner = ctx({ autopilotAllowed: true, platformRole: "user", isPlatformAdmin: false });
ok(
  !!autopilot && isNavItemVisible(autopilot, owner),
  "owner：导航可见（不依赖 admin 角色）",
);
ok(
  flattenHrefs(resolveNavigationTree(NAVIGATION_REGISTRY, owner)).includes(
    "/ai/autopilot/runs",
  ),
  "owner：可见 /ai/autopilot/runs",
);

const root = process.cwd();
const apiFiles = [
  "src/app/api/autopilot/overview/route.ts",
  "src/app/api/autopilot/runs/route.ts",
  "src/app/api/autopilot/runs/[runId]/route.ts",
  "src/app/api/autopilot/telemetry-health/route.ts",
  "src/app/api/autopilot/event-coverage/route.ts",
  "src/app/api/autopilot/evaluations/route.ts",
];
for (const rel of apiFiles) {
  const src = readFileSync(join(root, rel), "utf8");
  ok(src.includes("requireAutopilotAccess"), `${rel} 使用 requireAutopilotAccess`);
  ok(!src.includes('from "@/lib/db"'), `${rel} 不直接 prisma`);
  ok(!/user\.name\s*===\s*["']Lucas["']/.test(src), `${rel} 无 name===Lucas`);
}

const layout = readFileSync(
  join(root, "src/app/(main)/ai/autopilot/layout.tsx"),
  "utf8",
);
ok(layout.includes("AutopilotGate"), "页面 layout 有 AutopilotGate");

const accessSrc = readFileSync(join(root, "src/lib/autopilot/access.ts"), "utf8");
ok(accessSrc.includes("AUTOPILOT_OWNER_USER_IDS"), "身份来自 owner userId 配置");
ok(!/lucas@/i.test(accessSrc), "access 层不硬编码邮箱");
ok(!/cmmy6zimk0000ju04hrln3yqv/.test(accessSrc), "access 层不硬编码预览 userId");

const runtimeSrc = readFileSync(join(root, "src/lib/agent-runtime/run.ts"), "utf8");
ok(
  runtimeSrc.includes("enqueueAutopilotTelemetryOutbox"),
  "canonical runtime 在同事务写入 durable outbox",
);
ok(
  runtimeSrc.includes("$transaction"),
  "AgentRunEvent + outbox 走 $transaction",
);
ok(
  !runtimeSrc.includes("notifyAutopilotRuntime"),
  "request path 不再 fire-and-forget notifyAutopilotRuntime",
);

const cronSrc = readFileSync(
  join(root, "src/app/api/cron/autopilot-telemetry/route.ts"),
  "utf8",
);
ok(cronSrc.includes("requireCronSecret"), "telemetry cron 使用机器身份 CRON_SECRET");
ok(!cronSrc.includes("requireAutopilotAccess"), "telemetry cron 不用 Lucas UI 权限代替机器认证");

ok(
  flattenHrefs(resolveNavigationTree(NAVIGATION_REGISTRY, owner)).includes(
    "/ai/autopilot/evaluations",
  ),
  "owner：可见 /ai/autopilot/evaluations",
);
ok(
  flattenHrefs(resolveNavigationTree(NAVIGATION_REGISTRY, owner)).includes(
    "/ai/autopilot/telemetry",
  ),
  "owner：可见 /ai/autopilot/telemetry",
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
