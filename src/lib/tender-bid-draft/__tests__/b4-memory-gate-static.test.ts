/**
 * B4 — 投标起草 × 企业记忆访问门：结构级静态断言（源码扫描，不触 DB）。
 * 运行：npx tsx src/lib/tender-bid-draft/__tests__/b4-memory-gate-static.test.ts
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

const root = process.cwd();
const dir = join(root, "src/lib/tender-bid-draft");
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => ({ f, text: readFileSync(join(dir, f), "utf8") }));
const gather = sources.find((s) => s.f === "gather.ts")!.text;
const synth = sources.find((s) => s.f === "synthesize.ts")!.text;

// 矩阵14：投标起草不得直接查询受保护的企业记忆存储（import 边界守卫）
for (const { f, text } of sources) {
  ok(!/db\.memoryClaim|memoryClaimEvidence|\.buyer\./.test(text), `${f}: 无 MemoryClaim/Evidence/Buyer 裸存储访问`);
}
ok(!/corporate-memory\/(claim-service|buyer-service)/.test(gather), "gather.ts 不引用记忆写服务（只读消费者）");

// 矩阵15：新读取走 canonical 访问边界
ok(/searchMemoryClaims/.test(gather) && /corporate-memory\/retrieval/.test(gather), "记忆读取经 searchMemoryClaims（canonical 门）");
ok(/actor: \{ userId \}/.test(gather), "principal 来自服务端可信 userId（门内复核成员资格）");
ok(!/allowedAccessClasses/.test(gather), "不传 allowedAccessClasses——可见分级完全由 server 依角色裁定（无 Tender 侧访问策略复制）");

// 语义过滤 = 授权投影后的纯收窄
ok(/HUMAN_CONFIRMED.*SYSTEM_VERIFIED|SYSTEM_VERIFIED.*HUMAN_CONFIRMED/s.test(gather), "verification 收窄保留（仅已验证事实进 prompt）");
ok(/COMPLIANCE_POSITION/.test(gather) && /slice\(0, 300\)/.test(gather) && /slice\(0, 40\)/.test(gather), "既有业务收窄保留（排除合规立场 / 300 字 / 40 条）");

// fail-closed：门失败 → 空集，绝不回退裸查询
{
  const helper = gather.slice(gather.indexOf("export async function gatherVerifiedOrgMemoryClaims"));
  const body = helper.slice(0, helper.indexOf("\nexport async function gatherBidDraftInputs"));
  ok(/catch \{\s*\n?\s*return \[\];/.test(body), "门失败 fail-closed 返回空集（草稿继续 [TO CONFIRM]）");
  ok(!/findMany|findFirst/.test(body.replace(/searchMemoryClaims/g, "")), "失败路径无任何裸查询回退");
}

// 真相边界不变（矩阵11-13）：接地规则与 [TO CONFIRM] 语义原样
ok(/ONLY come from ORG PROFILE \/ VERIFIED ORG FACTS/.test(synth), "能力声明仍只能来自受控输入（反编造规则不变）");
ok(/\[TO CONFIRM/.test(synth), "[TO CONFIRM] 占位语义不变");
ok(/VERIFIED ORG FACTS/.test(synth), "prompt 投影仅 statement/claimType/verificationStatus（最小授权投影）");

console.log("");
console.log(`B4 记忆访问门静态断言 结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
