/**
 * 文件 pathname 租户声明测试
 * 运行：npx tsx src/lib/tenancy/__tests__/tenant-file-access.test.ts
 */

import { pathnameDeclaresOrg } from "../index";

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

const ORG = "cm_org_demo";

console.log("tenant file access");

ok(
  pathnameDeclaresOrg(`product-content/${ORG}/job1/out.png`, ORG),
  "product-content 前缀",
);
ok(
  pathnameDeclaresOrg(`trade-service/${ORG}/a.pdf`, ORG),
  "trade-service 前缀",
);
ok(
  pathnameDeclaresOrg(`trade/intelligence/${ORG}/x.json`, ORG),
  "trade/intelligence 前缀",
);
ok(
  pathnameDeclaresOrg(`orgs/${ORG}/kb/doc.pdf`, ORG),
  "orgs/ 规范前缀",
);
ok(
  !pathnameDeclaresOrg(`product-content/other_org/job1/out.png`, ORG),
  "拒绝他企 product-content",
);
ok(
  !pathnameDeclaresOrg(`temp/brochures/x.pdf`, ORG),
  "临时路径不声明企业归属",
);
ok(
  !pathnameDeclaresOrg(`sales-quotes/qid/file.pdf`, ORG),
  "未纳入代理白名单的路径不视为已声明",
);

console.log(`\ntenant-file-access: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
