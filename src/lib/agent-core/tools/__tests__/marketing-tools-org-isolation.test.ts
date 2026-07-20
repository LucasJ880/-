/**
 * 营销只读工具 — org 隔离约定（结构级）
 * 运行：npx tsx src/lib/agent-core/tools/__tests__/marketing-tools-org-isolation.test.ts
 */

import { readFileSync } from "fs";
import { join } from "path";

let total = 0;
let failed = 0;

function expect(condition: boolean, message: string) {
  total += 1;
  if (condition) {
    console.log(`✓ ${message}`);
    return;
  }
  failed += 1;
  console.error(`✗ ${message}`);
}

const root = process.cwd();
const enterpriseReadonly = readFileSync(
  join(root, "src/lib/agent-core/tools/enterprise-readonly.ts"),
  "utf8",
);
const policy = readFileSync(
  join(root, "src/lib/agent-core/tools/_policy.ts"),
  "utf8",
);

const tools = [
  "marketing_get_product_context",
  "marketing_get_brand_profile",
  "marketing_get_campaigns",
  "marketing_get_channel_metrics",
  "marketing_get_experiments",
];

for (const name of tools) {
  expect(enterpriseReadonly.includes(`name: "${name}"`), `注册工具 ${name}`);
  expect(policy.includes(`${name}:`), `策略含 ${name}`);
  expect(policy.includes(`l0_read`), `策略为只读风险级`);
}

// 每个营销工具 execute 内应调用 requireOrgMember
const sections = enterpriseReadonly.split("registry.register");
for (const name of tools) {
  const section = sections.find((s) => s.includes(`name: "${name}"`));
  expect(Boolean(section), `找到 ${name} 代码段`);
  expect(
    Boolean(section && section.includes("requireOrgMember")),
    `${name} 校验成员资格`,
  );
  expect(
    Boolean(section && section.includes("ctx.orgId")),
    `${name} 使用 ctx.orgId`,
  );
  expect(
    !(section && /api[_-]?key|oauth|secret|token/i.test(section) && section.includes("return")),
    `${name} 不意图返回密钥字段`,
  );
}

expect(
  enterpriseReadonly.includes("getProductMarketingContext"),
  "product_context 调用 PMC 服务",
);

console.log(
  `\n${failed === 0 ? "✅" : "❌"} marketing-tools-org-isolation: ${total - failed}/${total} 通过`,
);
if (failed > 0) process.exit(1);
