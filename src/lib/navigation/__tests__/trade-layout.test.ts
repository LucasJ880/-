/**
 * 外贸员两段式侧栏分区测试
 * 运行：npx tsx src/lib/navigation/__tests__/trade-layout.test.ts
 */

import assert from "node:assert/strict";
import { NAVIGATION_REGISTRY } from "../registry";
import { resolveNavigationTree } from "../filter";
import {
  partitionTradeNav,
  TRADE_PRIMARY_KEYS,
  usesTradeLayout,
} from "../trade-layout";
import type { NavigationFilterContext } from "../filter";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

console.log("trade-layout");

const ctx: NavigationFilterContext = {
  pathname: "/trade/inbox",
  platformRole: "trade",
  orgRole: "org_member",
  hasMembership: true,
  workspaceIds: ["ws1"],
  modules: {
    enabled: ["trade", "product_content", "supply_chain", "sales", "marketing", "operations"],
  },
  isPlatformAdmin: false,
};
const tree = resolveNavigationTree(NAVIGATION_REGISTRY, ctx);
const { primary, secondary } = partitionTradeNav(tree);

ok("只有 trade 角色启用两段式", () => {
  assert.equal(usesTradeLayout("trade"), true);
  assert.equal(usesTradeLayout("boss"), false);
  assert.equal(usesTradeLayout("sales"), false);
  assert.equal(usesTradeLayout(null), false);
});

ok("核心段按既定顺序：询盘收件箱 → 线索资产 → 外贸报价 → AI 对话 → 总台 → 知识库", () => {
  assert.deepEqual(
    primary.map((i) => i.key),
    TRADE_PRIMARY_KEYS.filter((k) => tree.some((i) => i.key === k)),
  );
  assert.deepEqual(
    primary.map((i) => i.href),
    ["/trade/inbox", "/trade/prospects", "/trade/quotes", "/trade/chat", "/trade", "/knowledge"],
  );
});

ok("配置类与通用工作区项全部进「更多」：消息通道/微信/市场监测/企业情报/展会导入/收件箱/AI 任务/数字员工", () => {
  const sec = new Set(secondary.map((i) => i.href));
  for (const href of [
    "/trade/channels",
    "/wechat",
    "/trade/signals",
    "/trade/intelligence",
    "/trade/import",
    "/service-inbox",
    "/workforce",
    "/assistant",
  ]) {
    assert.equal(sec.has(href), true, `${href} 应在更多里`);
  }
});

ok("两段互斥且覆盖全部可见项", () => {
  const keys = new Set([...primary, ...secondary].map((i) => i.key));
  assert.equal(keys.size, tree.length);
  assert.equal(primary.length + secondary.length, tree.length);
});

ok("非 trade 角色（boss）的树里同样含新入口，供其常规分组渲染", () => {
  const boss = resolveNavigationTree(NAVIGATION_REGISTRY, {
    ...ctx,
    platformRole: "boss",
    orgRole: "org_admin",
  });
  const hrefs = boss.map((i) => i.href);
  assert.equal(hrefs.includes("/trade/inbox"), true);
  assert.equal(hrefs.includes("/trade/quotes"), true);
});

console.log(`\ntrade-layout: ${pass} 通过`);
