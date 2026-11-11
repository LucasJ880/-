/**
 * RFQ-AUTO-3 个人开关「自动起草的轮次带跟进授权」— 纯逻辑测试（记录的形状与状态判定）
 * 运行：npx tsx src/lib/tender-rfq/__tests__/auto-followup-optin.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { optInAuditData, optInNeedsWrite, optInState, parseOptInRecord, type OptInState } from "../auto-followup-optin";
import { chaseTemplateHash } from "../chase-pure";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const HASH = chaseTemplateHash();
const OTHER_HASH = HASH === "0000000000000000" ? "1111111111111111" : "0000000000000000";
const rec = (v: unknown) => parseOptInRecord(JSON.stringify(v));

console.log("记录的形状");
ok("开 = { enabled: true, templateHash }；关 = { enabled: false }（关的时候不带指纹）", JSON.stringify(optInAuditData(true, HASH)) === JSON.stringify({ enabled: true, templateHash: HASH }) && JSON.stringify(optInAuditData(false, HASH)) === JSON.stringify({ enabled: false }));
ok("写出去的记录能原样读回", JSON.stringify(rec(optInAuditData(true, HASH))) === JSON.stringify({ enabled: true, templateHash: HASH }) && JSON.stringify(rec(optInAuditData(false, HASH))) === JSON.stringify({ enabled: false, templateHash: null }));
ok("严格解析：没有内容、不是 JSON、不是对象、是数组 → 当作没有记录", [null, undefined, "", "{oops", "true", "3", "[]", JSON.stringify("x")].every((v) => parseOptInRecord(v as string | null) === null));
ok("严格解析：enabled 不是布尔（\"true\" / 1 / 缺失）→ 当作没有记录", [{ enabled: "true", templateHash: HASH }, { enabled: 1, templateHash: HASH }, { templateHash: HASH }, {}].every((v) => rec(v) === null));
ok("严格解析：开着却没有合规的模板指纹（缺失 / 空 / 长度不对 / 非十六进制 / 不是字符串）→ 当作没有记录", [{ enabled: true }, { enabled: true, templateHash: "" }, { enabled: true, templateHash: "abc" }, { enabled: true, templateHash: "ZZZZZZZZZZZZZZZZ" }, { enabled: true, templateHash: 12 }].every((v) => rec(v) === null));

console.log("状态");
ok("默认关：没有记录 → off", optInState(null, HASH) === "off");
ok("最近一条是关 → off", optInState(rec({ enabled: false }), HASH) === "off");
ok("最近一条是开、模板指纹与现在相同 → on", optInState(rec({ enabled: true, templateHash: HASH }), HASH) === "on");
ok("最近一条是开、但模板之后改过 → lapsed（不生效，要重新看过再开）", optInState(rec({ enabled: true, templateHash: OTHER_HASH }), HASH) === "lapsed");
ok("记录不合规 → off（宁可当作没开）", optInState(rec({ enabled: true }), HASH) === "off" && optInState(rec({ enabled: "yes", templateHash: HASH }), HASH) === "off");

console.log("要不要写一条新记录");
const need = (s: OptInState, e: boolean) => optInNeedsWrite(s, e);
ok("已经是想要的状态就不写：开着再开、关着再关", !need("on", true) && !need("off", false));
ok("状态要变就写：关 → 开、开 → 关", need("off", true) && need("on", false));
ok("失效时开或关都写：重新开启记下新的指纹；关闭把它彻底关掉", need("lapsed", true) && need("lapsed", false));

console.log("存在哪里（源码断言）");
{
  const root = resolve(__dirname, "../../../..");
  const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
  const pure = read("src/lib/tender-rfq/auto-followup-optin.ts");
  const service = read("src/lib/tender-rfq/auto-followup-optin-service.ts");
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("不读也不写 Organization.settingsJson（那一块会被别处整块回写）", !/settingsJson|organization\.(update|findUnique)/.test(code(pure)) && !/settingsJson|organization\.(update|findUnique)/.test(code(service)));
  ok("状态只来自这个人在这个组织里最近一条记录：查询按组织、用户、动作、对象限定", /where: \{ orgId, userId, action: AUTO_DRAFT_OPTIN_AUDIT_ACTION, targetType: AUTO_DRAFT_OPTIN_TARGET, targetId: userId \}/.test(service) && /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/.test(service));
  ok("只追加：服务里没有改写或删除记录的调用", !/auditLog\.(update|updateMany|delete|deleteMany|upsert)/.test(code(service)));
  ok("写入用会抛错的那个审计函数（写不进去就算失败），不用吞错的", /await writeAuditLog\(db,/.test(service) && !/logAudit\(/.test(code(service)));
  ok("开启要求两个功能开关都打开；关闭不要求", /if \(input\.enabled && !isAutoDraftFollowUpOptInAvailable\(input\.orgId\)\)/.test(service));
  ok("自动起草时：功能开关任一关闭 → 直接当作没开，不查库；否则只有 on 才算开（lapsed 不算）", /if \(!isAutoDraftFollowUpOptInAvailable\(orgId\)\) return false;\s*return \(await loadAutoDraftFollowUpOptInState\(orgId, userId\)\) === "on";/.test(service));
}

console.log(`\n✓ auto-followup-optin: ${passed} 项断言全部通过`);
