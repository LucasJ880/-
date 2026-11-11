/**
 * FIX-3 守卫：src/ 下任何写 Organization.settingsJson 的文件，必须经统一入口（settings-write）或自己先锁行。
 * 运行：npx tsx src/lib/organizations/__tests__/settings-write-guard.test.ts
 *
 * 为什么要这条：这一块 JSON 被很多功能共用，各自「读出整块、改一个键、整块写回」。只要有一处不加锁，
 * 它就能用读到的旧内容把别人刚写的修改冲掉——所以不能只靠评审，新增的写入方必须被拦住。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/** 去掉注释，免得注释里的字样影响判断 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** 这段源码有没有「更新一个已有的组织、并写 settingsJson」 */
export function writesOrgSettings(source: string): boolean {
  const code = stripComments(source);
  const re = /\borganization\s*\.\s*(update|updateMany|upsert)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    // 取这次调用的参数（括号配平），看 data 里有没有 settingsJson
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (let i = end; i < code.length; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (/\bsettingsJson\s*[:,}]/.test(code.slice(m.index, end + 1))) return true;
  }
  return false;
}

/** 写了的话，是不是走了入口或自己锁了行 */
export function isGuarded(source: string): boolean {
  const code = stripComments(source);
  return /from\s+["'](@\/lib\/organizations\/settings-write|\.\/settings-write|\.\.\/settings-write)["']/.test(code)
    || /import\(\s*["']@\/lib\/organizations\/settings-write["']\s*\)/.test(code)
    || /FOR\s+UPDATE/i.test(code);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

console.log("识别规则");
{
  const naive = `
    const org = await db.organization.findUnique({ where: { id }, select: { settingsJson: true } });
    await db.organization.update({ where: { id }, data: { settingsJson: { ...(org?.settingsJson as object), mine: 1 } } });`;
  ok("「读出整块、改一个键、整块写回」被认出是在写组织设置", writesOrgSettings(naive));
  ok("它既没走入口也没锁行 → 不合规", !isGuarded(naive));
  ok("updateMany / upsert 同样算", writesOrgSettings(`await tx.organization.updateMany({ where: {}, data: { settingsJson } })`) && writesOrgSettings(`await tx.organization.upsert({ where: { id }, create: {}, update: { settingsJson: next } })`));
  ok("只更新别的列（不写 settingsJson）不算", !writesOrgSettings(`await db.organization.update({ where: { id }, data: { name } }); const s = org.settingsJson;`));
  ok("新建组织时带初始设置不算（没有别人的修改可冲掉）", !writesOrgSettings(`await tx.organization.create({ data: { settingsJson: {} } })`));
  ok("注释里的字样不算", !writesOrgSettings(`// await db.organization.update({ data: { settingsJson } })\n/* organization.update({ data: { settingsJson } }) */`));
  ok("经入口 → 合规", isGuarded(`import { mutateOrgSettings } from "@/lib/organizations/settings-write";`) && isGuarded(`const { mutateOrgSettings } = await import("@/lib/organizations/settings-write");`) && isGuarded(`import { lockOrganizationRow } from "./settings-write";`));
  ok("自己锁行 → 合规", isGuarded("await tx.$queryRaw`SELECT id FROM \"Organization\" WHERE id = ${orgId} FOR UPDATE`;"));
  ok("注释里写一句 FOR UPDATE 不算锁行", !isGuarded(`// SELECT ... FOR UPDATE\nawait db.organization.update({ data: { settingsJson } })`));
}

console.log("全仓扫描");
{
  const root = join(process.cwd(), "src");
  const files = walk(root);
  const writers = files.filter((f) => writesOrgSettings(readFileSync(f, "utf8")));
  const unguarded = writers.filter((f) => !isGuarded(readFileSync(f, "utf8"))).map((f) => relative(process.cwd(), f));
  // 直接写这一列的文件现在只剩：入口自己，加上在自己的事务里锁行的几处（斑马帘比例、质保设置、门店折扣、开户向导）
  const names = writers.map((f) => relative(process.cwd(), f));
  ok(`扫描了 ${files.length} 个源文件，其中 ${writers.length} 个直接写组织设置（含入口自己）`, files.length > 500 && names.includes("src/lib/organizations/settings-write.ts") && writers.length >= 5, names);
  ok("它们全部经统一入口或自己锁行（新增的写入方请用 mutateOrgSettings，见 src/lib/organizations/settings-write.ts）", unguarded.length === 0, { 不合规的文件: unguarded });
  const entry = readFileSync(join(root, "lib/organizations/settings-write.ts"), "utf8");
  ok("入口自己：先锁行、再读、再写，且锁里调用的是同步函数（没有 await fn）", entry.indexOf("await lockOrganizationRow(tx, orgId)") < entry.indexOf("tx.organization.findUnique") && entry.indexOf("tx.organization.findUnique") < entry.indexOf("tx.organization.update") && /const out = fn\(before\);/.test(entry) && !/await fn\(/.test(entry));
  const router = readFileSync(join(root, "lib/muse-bridge/router.ts"), "utf8");
  ok("Muse set_preference：保存时在锁里对最新的偏好再应用这项修改（不把先前读到的整条偏好写回去）", /await updateUserPrefs\(identity\.orgId, identity\.userId, \(fresh\) => \{\s*const again = applyPreference\(fresh, command\.key, command\.value, now\);/.test(router) && !/saveUserPrefs\(/.test(router));
}

console.log(`\n✓ settings-write-guard: ${passed} 项断言全部通过`);
