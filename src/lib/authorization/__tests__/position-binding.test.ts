/**
 * PERM-1：岗位绑定脚本纯函数（解析 / 校验 / 差异计划）
 * 运行：npx tsx src/lib/authorization/__tests__/position-binding.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseBindingFile,
  planBindingDiff,
  summarizePlan,
  validateBindings,
} from "../position-binding";
import { WINDOW_COVERING_ROLE_PROFILES, profileKeysForIndustryPack } from "../role-defaults";

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

console.log("PERM-1 岗位绑定纯函数");

const known = profileKeysForIndustryPack("window_covering_services_v1");
const members = {
  "lucas@example.com": { userId: "u-lucas", status: "active" },
  "alex@example.com": { userId: "u-alex", status: "active" },
  "old@example.com": { userId: "u-old", status: "inactive" },
};

// ── 解析 ──
const bad = parseBindingFile("{not json");
ok(!bad.ok, "非 JSON → 解析失败");
const noTop = parseBindingFile(JSON.stringify({ x: 1 }));
ok(!noTop.ok && noTop.errors[0].includes("bindings"), "缺 bindings → 报错");
const dup = parseBindingFile(
  JSON.stringify({ bindings: { "Lucas@Example.com": ["owner"], "lucas@example.com": ["bids"] } }),
);
ok(!dup.ok && dup.errors.some((e) => e.includes("邮箱重复")), "同一邮箱大小写不同 → 重复邮箱报错");
const good = parseBindingFile(
  JSON.stringify({ bindings: { "Lucas@Example.com": ["owner", "bids", "owner"] } }),
);
ok(good.ok && good.value.bindings["lucas@example.com"]?.join(",") === "owner,bids", "邮箱转小写、岗位去重保序");

// ── 校验 ──
const placeholder = parseBindingFile(
  JSON.stringify({ bindings: { "TODO:Bob": ["owner"], "lucas@example.com": ["owner"] } }),
);
if (placeholder.ok) {
  const v = validateBindings({ file: placeholder.value, knownProfileKeys: known, membersByEmail: members });
  ok(!v.ok && v.errors.some((e) => e.includes("TODO:Bob")), "TODO 占位 → 拒绝并列出占位键");
}
const unknownKey = parseBindingFile(
  JSON.stringify({ bindings: { "lucas@example.com": ["owner", "fulfillment_unknown"] } }),
);
if (unknownKey.ok) {
  const v = validateBindings({ file: unknownKey.value, knownProfileKeys: known, membersByEmail: members });
  ok(
    !v.ok && v.errors.some((e) => e.includes("lucas@example.com") && e.includes("fulfillment_unknown")),
    "未知岗位 key → 指出邮箱与 key",
  );
}
const nonMember = parseBindingFile(JSON.stringify({ bindings: { "nobody@example.com": ["owner"] } }));
if (nonMember.ok) {
  const v = validateBindings({ file: nonMember.value, knownProfileKeys: known, membersByEmail: members });
  ok(!v.ok && v.errors.some((e) => e.includes("nobody@example.com") && e.includes("不是本企业成员")), "非本企业成员 → 拒绝");
}
const inactive = parseBindingFile(JSON.stringify({ bindings: { "old@example.com": ["owner"] } }));
if (inactive.ok) {
  const v = validateBindings({ file: inactive.value, knownProfileKeys: known, membersByEmail: members });
  ok(!v.ok && v.errors.some((e) => e.includes("inactive")), "非 active 成员 → 拒绝");
}
const multiErr = parseBindingFile(
  JSON.stringify({ bindings: { "TODO:Bob": ["owner"], "nobody@example.com": ["zzz"] } }),
);
if (multiErr.ok) {
  const v = validateBindings({ file: multiErr.value, knownProfileKeys: known, membersByEmail: members });
  ok(!v.ok && v.errors.length >= 3, "返回全部错误而非首个");
}
const valid = parseBindingFile(
  JSON.stringify({ bindings: { "lucas@example.com": ["owner", "bids"], "alex@example.com": ["sales_rep"] } }),
);
let resolved: Array<{ email: string; userId: string; keys: string[] }> = [];
if (valid.ok) {
  const v = validateBindings({ file: valid.value, knownProfileKeys: known, membersByEmail: members });
  ok(v.ok && v.resolved.length === 2, "合法文件 → 解析出 2 人");
  if (v.ok) resolved = v.resolved;
}

// ── 差异计划 ──
const prunable = WINDOW_COVERING_ROLE_PROFILES.map((p) => p.key);
const first = planBindingDiff({ desired: resolved, existing: [], prune: false, prunableKeys: prunable });
ok(first.create.length === 3 && first.keep.length === 0 && first.deactivate.length === 0, "首次执行 → 新增 3");
const after = first.create.map((c) => ({ userId: c.userId, profileKey: c.profileKey, status: "active" }));
const second = planBindingDiff({ desired: resolved, existing: after, prune: false, prunableKeys: prunable });
ok(second.create.length === 0 && second.keep.length === 3, "重复执行 → 新增 0（幂等）");

const dropped = resolved.map((r) =>
  r.email === "lucas@example.com" ? { ...r, keys: ["owner"] } : r,
);
const noPrune = planBindingDiff({ desired: dropped, existing: after, prune: false, prunableKeys: prunable });
ok(noPrune.deactivate.length === 0, "去掉一个岗位、不带 prune → 不停用");
const withPrune = planBindingDiff({ desired: dropped, existing: after, prune: true, prunableKeys: prunable });
ok(
  withPrune.deactivate.length === 1 && withPrune.deactivate[0].profileKey === "bids",
  "去掉一个岗位、带 prune → 停用 1（bids）",
);
const sysBound = [...after, { userId: "u-lucas", profileKey: "org_owner", status: "active" }];
const pruneSys = planBindingDiff({ desired: dropped, existing: sysBound, prune: true, prunableKeys: prunable });
ok(
  !pruneSys.deactivate.some((d) => d.profileKey === "org_owner"),
  "prune 不停用系统模板绑定（org_owner）",
);
const summary = summarizePlan(withPrune);
ok(
  summary.lines.join("\n").includes("lucas@example.com: owner") && summary.deactivated === 1,
  "汇总输出：每人一行 + 停用计数",
);

// ── 仓库里的 Sunny 绑定文件：当前只应因 TODO 占位被拒 ──
const sunnyText = readFileSync(join(process.cwd(), "config/positions/sunny.json"), "utf8");
const sunny = parseBindingFile(sunnyText);
ok(sunny.ok, "config/positions/sunny.json 可解析");
if (sunny.ok) {
  const realMembers: Record<string, { userId: string; status: string }> = {};
  for (const email of Object.keys(sunny.value.bindings)) {
    if (!email.startsWith("TODO:")) realMembers[email] = { userId: `u-${email}`, status: "active" };
  }
  const v = validateBindings({ file: sunny.value, knownProfileKeys: known, membersByEmail: realMembers });
  ok(
    !v.ok && v.errors.length === 1 && v.errors[0].startsWith("存在未填邮箱的占位"),
    "sunny.json 当前仅因 TODO 占位被拒（岗位 key 全部合法）",
  );
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
