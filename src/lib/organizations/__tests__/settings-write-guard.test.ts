/**
 * FIX-3 守卫：src/ 与 scripts/ 下任何写 Organization.settingsJson 的文件，必须经统一入口（settings-write）或自己先锁行；
 * 直接写这一列的文件另有一份名单，新增的要先加进名单（等于强制过一遍人工审查）。
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
/** 只认「行首或空白之后」的 //：字符串里的 "https://…"、"a//b" 不会被当成注释把后半行吃掉 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

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
    || /FOR\s+(NO\s+KEY\s+)?UPDATE/i.test(code);
}

/** FIX-4：有没有对组织行取 FOR UPDATE 的语句（注释里的不算；FOR NO KEY UPDATE 不算） */
export function locksOrgRowForUpdate(source: string): boolean {
  return /FROM\s+"?Organization"?\b[^`;]*?\bFOR\s+UPDATE\b/i.test(stripComments(source));
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
  ok("认得出对组织行取 FOR UPDATE：单行、跨行、按 code 找行的都算", locksOrgRowForUpdate('await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${orgId} FOR UPDATE`;') && locksOrgRowForUpdate('await tx.$executeRaw`\n      SELECT id FROM "Organization" WHERE id = ${opts.orgId} FOR UPDATE\n    `;') && locksOrgRowForUpdate('SELECT id FROM "Organization" WHERE code = ${code}\n FOR   UPDATE'));
  ok("FOR NO KEY UPDATE 不算；别的表上的 FOR UPDATE 不算；注释里的不算；同一文件里先锁别的表再读组织也不算", !locksOrgRowForUpdate('SELECT id FROM "Organization" WHERE id = ${orgId} FOR NO KEY UPDATE') && !locksOrgRowForUpdate('SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE') && !locksOrgRowForUpdate('// SELECT id FROM "Organization" WHERE id = $1 FOR UPDATE\n/* FROM "Organization" FOR UPDATE */') && !locksOrgRowForUpdate('await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${a} FOR NO KEY UPDATE`;\nawait tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${b} FOR UPDATE`;'));
  ok("FOR NO KEY UPDATE 也算锁行", isGuarded("await tx.$queryRaw`SELECT id FROM \"Organization\" WHERE id = ${orgId} FOR NO KEY UPDATE`;"));
  ok("字符串里带 // 的那一行后面的写入照样被认出来", writesOrgSettings(`const u = "https://example.test/a//b"; await db.organization.update({ where: { id }, data: { settingsJson: next } });`));
}

console.log("全仓扫描");
{
  const root = join(process.cwd(), "src");
  const files = [...walk(root), ...walk(join(process.cwd(), "scripts"))];
  const read = (f: string) => readFileSync(f, "utf8");
  const writers = files.filter((f) => writesOrgSettings(read(f)));
  const names = writers.map((f) => relative(process.cwd(), f)).sort();
  const unguarded = writers.filter((f) => !isGuarded(read(f))).map((f) => relative(process.cwd(), f));
  ok(`扫描了 ${files.length} 个源文件（src/ 与 scripts/），其中 ${writers.length} 个直接写组织设置`, files.length > 500 && writers.length >= 5, names);
  ok("它们全部经统一入口或自己锁行（新增的写入方请用 mutateOrgSettings，见 src/lib/organizations/settings-write.ts）", unguarded.length === 0, { 不合规的文件: unguarded });
  // 直接写这一列的文件名单。「文件里某处有 FOR UPDATE」并不能说明每一处写入都在锁里，所以新增直接写入的文件必须先加到这里——
  // 加之前请确认：同一事务里先 lockOrganizationRow（或 mutateOrgSettingsInTx）再读再写。能用 mutateOrgSettings 就不要直接写。
  const DIRECT_WRITERS = [
    "scripts/set-org-sender-copy.ts", // 事务里先 lockOrganizationRow 再重读再写
    "src/app/api/install/warranty-settings/route.ts", // 事务里先 lockOrganizationRow 再读再写（FIX-4 之前是 FOR UPDATE）
    "src/app/api/sunny-process/zebra-ratios/route.ts", // 事务里先 lockOrganizationRow 再读再写（FIX-4 之前是 FOR UPDATE）
    "src/lib/blinds/discount-settings.ts", // 既有事务里先 lockOrganizationRow
    "src/lib/organizations/onboarding.ts", // 两处：按 code 锁行；lockOrganizationRow
    "src/lib/organizations/settings-write.ts", // 入口自己
  ];
  ok("直接写这一列的文件与名单一致（多了 = 新增了直接写入，先过一遍审查再加进名单；少了 = 名单该删）", JSON.stringify(names) === JSON.stringify(DIRECT_WRITERS), { 实际: names, 名单: DIRECT_WRITERS });

  // FIX-4：对组织行不许再用 FOR UPDATE（它与「往本组织插入一条关联记录」的外键检查互斥，会卡住对方、也能造出死锁）
  const forUpdate = files.filter((f) => locksOrgRowForUpdate(read(f))).map((f) => relative(process.cwd(), f));
  ok("src/ 与 scripts/ 下没有任何对组织行取 FOR UPDATE 的语句（要锁组织行请用 lockOrganizationRow）", forUpdate.length === 0, { 还在用的文件: forUpdate });
  const zebra = read(join(root, "app/api/sunny-process/zebra-ratios/route.ts"));
  const warranty = read(join(root, "app/api/install/warranty-settings/route.ts"));
  const lockThenRead = (src: string) => { const lock = src.indexOf("await lockOrganizationRow(tx, orgRes.orgId);"); const readAt = src.indexOf("tx.organization.findUnique({ where: { id: orgRes.orgId }, select: { settingsJson: true } })"); return lock > 0 && lock < readAt && readAt < src.indexOf("tx.organization.update({"); };
  ok("斑马帘比例、质保设置：事务里先锁行、再读设置、再写", lockThenRead(zebra) && lockThenRead(warranty) && (zebra.match(/lockOrganizationRow\(/g) ?? []).length === 1 && (warranty.match(/lockOrganizationRow\(/g) ?? []).length === 1);
  const policy = read(join(root, "lib/capabilities/governance/policy.ts"));
  const txBodies = policy.split("db.$transaction(async (tx) => {").slice(1);
  ok("能力配额策略：新建与修改两个事务都以锁组织行开头，之后才读策略", txBodies.length === 2 && txBodies.every((b) => /^\s*await lockOrganizationRow\(tx, opts\.orgId\);/.test(b) && b.indexOf("lockOrganizationRow(") < b.indexOf("tx.capabilityQuotaPolicy.")) && !/\$executeRaw|\$queryRaw/.test(policy));

  // 在自己事务里锁行的三处：锁必须在「读设置」之前。把锁删掉或挪到读之后，这里会失败
  const discount = read(join(root, "lib/blinds/discount-settings.ts"));
  ok("门店折扣：事务里先锁行、再读设置、再写", discount.indexOf("await lockOrganizationRow(tx, params.orgId);") > 0 && discount.indexOf("await lockOrganizationRow(tx, params.orgId);") < discount.indexOf("tx.organization.findUnique({ where: { id: params.orgId }, select: { settingsJson: true } })") && discount.indexOf("tx.organization.findUnique({ where: { id: params.orgId }, select: { settingsJson: true } })") < discount.indexOf("data: { settingsJson: merged as Prisma.InputJsonValue }"));
  const onboarding = read(join(root, "lib/organizations/onboarding.ts"));
  const provLock = onboarding.indexOf('WHERE code = ${input.code} FOR NO KEY UPDATE');
  ok("开户新建 / 接管：事务里先按 code 锁行、再读这个组织", provLock > 0 && provLock < onboarding.indexOf("tx.organization.findUnique({ where: { code: input.code }, select: ORG_SELECT })"));
  const updLock = onboarding.indexOf("await lockOrganizationRow(tx, orgId);");
  const updRead = onboarding.indexOf("const fresh = await tx.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });");
  ok("开户更新设置：事务里先锁行、再读最新的设置、在它之上合并后写；审计的「之前」取锁里读到的", updLock > 0 && updLock < updRead && updRead < onboarding.indexOf("const nextSettings = buildNextSettings(settingsBeforeWrite);") && onboarding.includes("timezone: settingsBeforeWrite.timezone ?? null"));
  const senderCopy = read(join(process.cwd(), "scripts/set-org-sender-copy.ts"));
  ok("发信说明脚本：事务里先锁行、再重读", senderCopy.indexOf("await lockOrganizationRow(tx, preview.id);") > 0 && senderCopy.indexOf("await lockOrganizationRow(tx, preview.id);") < senderCopy.indexOf("tx.organization.findUnique({ where: { id: preview.id }, select: orgSelect })"));
  const calRun = read(join(root, "lib/calendar-watch/run.ts"));
  ok("日历游标：经入口，且「这个日历还在观察、读取账号没变」的判断在锁里对最新的设置做", /await mutateOrgSettings\(orgId, \(latest\) => \{\s*const current = readCalendarWatch\(latest\);\s*if \(current\.readerUserId !== readerUserId \|\| !current\.calendarIds\.includes\(calendarId\)\) return \{ result: null \};/.test(calRun));
  const entry = readFileSync(join(root, "lib/organizations/settings-write.ts"), "utf8");
  ok("入口用的是 FOR NO KEY UPDATE（不与外键检查互斥），不是 FOR UPDATE", /FOR NO KEY UPDATE`/.test(entry) && !/WHERE id = \$\{orgId\} FOR UPDATE/.test(entry));
  ok("入口自己：先锁行、再读、再写，且锁里调用的是同步函数（没有 await fn）", entry.indexOf("await lockOrganizationRow(tx, orgId)") < entry.indexOf("tx.organization.findUnique") && entry.indexOf("tx.organization.findUnique") < entry.indexOf("tx.organization.update") && /const out = fn\(before\);/.test(entry) && !/await fn\(/.test(entry));
  const router = readFileSync(join(root, "lib/muse-bridge/router.ts"), "utf8");
  ok("Muse set_preference：保存时在锁里对最新的偏好再应用这项修改（不把先前读到的整条偏好写回去）", /await updateUserPrefs\(identity\.orgId, identity\.userId, \(fresh\) => \{\s*const again = applyPreference\(fresh, command\.key, command\.value, now\);/.test(router) && !/saveUserPrefs\(/.test(router));
}

console.log(`\n✓ settings-write-guard: ${passed} 项断言全部通过`);
