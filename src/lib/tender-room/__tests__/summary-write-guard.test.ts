/**
 * FIX-11 守卫：调查室 BidIntelligenceRoom.summaryJson 只能经 src/lib/tender-room/summary-json.ts 写（无 DB，CI 里跑）
 *   npx tsx src/lib/tender-room/__tests__/summary-write-guard.test.ts
 *
 * summaryJson 是好几个功能共用的一个 JSON 位。绕开写入入口「读整块 → 展开 → 写回」会在并发时冲掉别的功能的键
 * （FIX-8 / FIX-10 都是这样丢的数据）。新写法要么经 patchRoomSummary / patchRoomSummaryTx，
 * 要么写进下面的名单并说明它自己怎么拿项目行锁。
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

/** 允许直接写 summaryJson 的地方（文件 → 为什么可以） */
const ALLOWED: Record<string, string> = {
  "src/lib/tender-room/summary-json.ts": "写入入口本身：锁项目行 → 重读 → 只改给出的键",
  "src/lib/quote-engine/tender-bid.ts": "报价引擎镜像：调用方都在事务里先 lockProject，同一事务内重读、只改 pricingInputs",
  "src/app/api/projects/[id]/pricing-helper/route.ts": "报价表助手（FIX-9）：writeRoomLocked 先 lockProject、再重读",
  "src/lib/bid-workflow/start-intelligence.ts": "只在新建房间（create）时带初始摘要；已有房间经 patchRoomSummaryTx",
};

const WRITE_CALL = /\b(?:bidIntelligenceRoom|BidIntelligenceRoom)\.(?:update|upsert|create|updateMany|createMany|upsertMany)\s*\(/g;
const RAW_SQL_WRITE = /\b(?:UPDATE|INSERT\s+INTO)\s+"?BidIntelligenceRoom"?/i;

/** 取出从 open 处开始、括号配平的调用文本 */
function callText(src: string, start: number): string {
  let depth = 0;
  for (let i = src.indexOf("(", start); i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}
/** 去掉 select: { … }（读的列，不是写） */
function stripSelect(call: string): string {
  let out = call;
  for (;;) {
    const m = /select\s*:\s*\{/.exec(out);
    if (!m) return out;
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (; end < out.length; end++) {
      if (out[end] === "{") depth++;
      else if (out[end] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    out = out.slice(0, m.index) + out.slice(end + 1);
  }
}
export function writesSummaryJson(src: string): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = [];
  for (const m of src.matchAll(WRITE_CALL)) {
    const call = callText(src, m.index ?? 0);
    if (/\bsummaryJson\b/.test(stripSelect(call))) hits.push({ line: src.slice(0, m.index).split("\n").length, text: call.slice(0, 120) });
  }
  for (const [i, l] of src.split("\n").entries()) {
    if (RAW_SQL_WRITE.test(l) && /summaryJson/.test(l)) hits.push({ line: i + 1, text: l.trim().slice(0, 120) });
  }
  return hits;
}

console.log("FIX-11 room summaryJson write guard");

/* ---------- 守卫自身认得出 ---------- */
ok(writesSummaryJson(`await db.bidIntelligenceRoom.update({ where: { id }, data: { summaryJson: { ...sj, x } } });`).length === 1, "认得出：update 的 data 里写 summaryJson");
ok(writesSummaryJson(`await tx.bidIntelligenceRoom.upsert({\n where: { projectId },\n create: { orgId, projectId, summaryJson: {} },\n update: {},\n});`).length === 1, "认得出：upsert 的 create 里带 summaryJson（跨行）");
ok(writesSummaryJson('await tx.$executeRaw`UPDATE "BidIntelligenceRoom" SET "summaryJson" = ${x}`;').length === 1, "认得出：原生 SQL 改 summaryJson");
ok(writesSummaryJson(`await db.bidIntelligenceRoom.upsert({ where: { projectId }, create: { orgId, projectId }, update: {}, select: { id: true, summaryJson: true } });`).length === 0, "不误报：只在 select 里读 summaryJson");
ok(writesSummaryJson(`await tx.bidIntelligenceRoom.update({ where: { id }, data: { goDecision: d } });`).length === 0, "不误报：只改别的列");

/* ---------- 扫 src ---------- */
const files = execSync("git ls-files src", { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("/__tests__/"));
const offenders: Array<{ file: string; line: number; text: string }> = [];
const allowedSeen = new Set<string>();
for (const f of files) {
  const src = readFileSync(join(process.cwd(), f), "utf8");
  const hits = writesSummaryJson(src);
  if (hits.length === 0) continue;
  if (ALLOWED[f]) allowedSeen.add(f);
  else for (const h of hits) offenders.push({ file: f, ...h });
}
ok(offenders.length === 0, "src 下没有绕开写入入口直接写调查室 summaryJson 的地方（要写就用 patchRoomSummary / patchRoomSummaryTx）", offenders);
const stale = Object.keys(ALLOWED).filter((f) => !allowedSeen.has(f));
ok(stale.length === 0, "名单里的每一处都还在直接写（不在了就从名单里删掉）", stale);

/* ---------- 名单里的几处确实拿了项目行锁 ---------- */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
ok(/await lockProject\(tx, input\.projectId\);/.test(read("src/lib/tender-room/summary-json.ts")), "写入入口：先 lockProject");
ok(/await lockProject\(tx, projectId\);/.test(read("src/app/api/projects/[id]/pricing-helper/route.ts")), "报价表助手：先 lockProject");
const bid = read("src/lib/quote-engine/tender-bid.ts");
ok((bid.match(/await lockProject\(tx, /g) ?? []).length >= 2, "报价引擎：写镜像的入口在事务里先 lockProject");
const start = read("src/lib/bid-workflow/start-intelligence.ts");
ok(writesSummaryJson(start).every((h) => /\.create\(/.test(h.text)), "开始调查：直接写 summaryJson 的只剩新建房间", writesSummaryJson(start));

console.log(`\nFIX-11 room summaryJson write guard: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
