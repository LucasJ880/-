/**
 * B1 — 三个入口的权威租户上下文接线（结构级静态断言，源码扫描）。
 * 运行：npx tsx src/lib/agent-core/__tests__/b1-tenant-context-static.test.ts
 *
 * 证明（by construction）：
 * - 三个此前缺租户字段的 runAgent 入口（微信会话运行时 / runSkill / 贸易助手 V2）
 *   现在都通过 resolveAgentTenant（DB 权威）+ toAgentTenantRunFields 提供授权字段；
 * - 三处均无 `hasMembership: true` 硬编码（身份只能来自查询）；
 * - 队列重入（resume 类路径）不携带租户字段快照——每次执行重新权威解析（矩阵 4/9/12）。
 *
 * 注：agent-runtime-v2 executor 的 `hasMembership: true` 是 R0 已知存量违规
 * （runtime-architecture baseline 可见，修复归 R2-C3），不在本测试范围。
 */
import { readFileSync } from "fs";
import { join } from "path";

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

const root = process.cwd();
const SITES = [
  "src/lib/agent-runtime/process.ts",
  "src/lib/agent-core/skills/runtime.ts",
  "src/lib/trade/chat-assistant.ts",
];

for (const rel of SITES) {
  const text = readFileSync(join(root, rel), "utf8");
  ok(text.includes("resolveAgentTenant"), `${rel}: 使用 resolveAgentTenant（权威租户解析）`);
  ok(text.includes("toAgentTenantRunFields"), `${rel}: 使用 canonical 映射器（tenancy/agent-tenant-run-fields）`);
  ok(/\.\.\.(tenantRunFields|toAgentTenantRunFields\(tenantResolved\))/.test(text), `${rel}: 租户字段展开进 runAgent 选项`);
  ok(!/hasMembership:\s*true/.test(text), `${rel}: 无 hasMembership: true 硬编码`);
  ok(/"error" in tenantResolved|'error' in tenantResolved/.test(text), `${rel}: 解析失败 fail-closed 分支存在`);
  ok(text.includes("scopeGuard"), `${rel}: scopeGuard 服务端锁定（模型参数不可扩权）`);
}

// 队列重入不得携带租户身份快照：background payload 里不允许出现授权字段
{
  const queue = readFileSync(join(root, "src/lib/agent-runtime/queue.ts"), "utf8");
  ok(!/hasMembership|orgRole|modulesJson|toolPolicy/.test(queue), "queue.ts（重入路径）不携带租户授权字段——每次执行经 executeConversationRun 重新解析（矩阵4/9/12）");
}

// 三处解析都必须在执行函数体内（每次执行重新解析，而非模块级缓存）
{
  const proc = readFileSync(join(root, SITES[0]), "utf8");
  const fnStart = proc.indexOf("export async function executeConversationRun");
  ok(fnStart >= 0 && proc.indexOf("resolveAgentTenant", fnStart) > fnStart, "process.ts: 解析发生在 executeConversationRun 体内（重入即重解析）");
}

console.log("");
console.log(`B1 租户上下文静态断言 结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
