/**
 * FIX-24 合并后只读核查 docs/acceptance/fix-24/prod-check.sql 的隔离库回归测试（M9）。
 * 种子每行只命中一个条件，断言各段列出的行与原因；B 段「比价还采信这次回信吗」逐行与读取规则（notes-parse.ts）对照。
 * 运行（隔离库执行，否则跳过；要本机有 psql）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-rfq/__tests__/prod-check-fix24-db.isolated.test.ts
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-24 只读核查 SQL 隔离库回归（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
if (spawnSync("psql", ["--version"]).status !== 0) skip("本机没有 psql");
assertSafeTestDatabase({ scriptName: "FIX-24 prod-check SQL DB test" });

let pass = 0;
const failures: string[] = [];
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 800)}`}`); }
}

const SQL_FILE = path.join(process.cwd(), "docs/acceptance/fix-24/prod-check.sql");
const P = "fix24pc-";

async function main() {
  const { db } = await import("@/lib/db");
  const { parseAutoNotes } = await import("../notes-parse");

  const clean = async () => {
    await db.auditLog.deleteMany({ where: { targetId: { startsWith: P } } });
    await db.inquiryItem.deleteMany({ where: { id: { startsWith: P } } });
    await db.projectInquiry.deleteMany({ where: { id: { startsWith: P } } });
    await db.supplier.deleteMany({ where: { id: { startsWith: P } } });
    await db.project.deleteMany({ where: { id: { startsWith: P } } });
    await db.organization.deleteMany({ where: { id: { startsWith: P } } });
    await db.user.deleteMany({ where: { id: { startsWith: P } } });
  };

  await clean();
  try {
    const user = await db.user.create({ data: { id: `${P}user`, email: `${P}user@example.test`, name: "FIX-24 核查种子" } });
    const org = await db.organization.create({ data: { id: `${P}org`, name: "FIX-24 核查种子组织", code: `${P}org`, ownerId: user.id } as never });
    const project = await db.project.create({ data: { id: `${P}proj`, name: "FIX-24 核查种子项目", ownerId: user.id, orgId: org.id } as never });
    const inquiry = await db.projectInquiry.create({ data: { id: `${P}inq`, projectId: project.id, roundNumber: 1, createdById: user.id } });

    const mkItem = async (key: string, lines: string[] | null, currency = "CAD") => {
      const sup = await db.supplier.create({ data: { id: `${P}sup-${key}`, orgId: org.id, name: `供应商 ${key}`, createdById: user.id } as never });
      const item = await db.inquiryItem.create({ data: { id: `${P}item-${key}`, inquiryId: inquiry.id, supplierId: sup.id, status: "quoted", currency, createdById: user.id, quoteNotes: lines ? lines.join("\n") : null } });
      return item.id;
    };
    const plusMin = (iso: string, m: number) => new Date(new Date(iso).getTime() + m * 60_000);
    const audit = (msg: string, afterData: string, at: Date, o: { action?: string; targetType?: string } = {}) =>
      db.auditLog.create({ data: { userId: user.id, orgId: org.id, projectId: project.id, action: o.action ?? "rfq_inbound:applied", targetType: o.targetType ?? "rfq_inbound_message", targetId: msg, afterData, createdAt: at } });
    const line = (ts: string, msg: string, body: string) => `[auto ${ts} msg=${msg}] ${body}`;

    /* ── A 段：每行一个条件 ── */
    const A = `${P}item-a`;
    const aLines: Array<{ key: string; ts: string; body: string; audit?: { minutes: number; action?: string; targetType?: string; itemId?: string }; raw?: string }> = [
      { key: "a1", ts: "2026-10-01T00:00:00.000Z", body: "贸易条款=FOB（证据：\"FOB\"）", audit: { minutes: 1 } },
      { key: "a2", ts: "2099-01-01T00:00:00.000Z", body: "贸易条款=EXW", audit: { minutes: 1 } },
      { key: "a3", ts: "2026-10-02T00:00:00.000Z", body: "贸易条款=EXW" },
      { key: "a4", ts: "2026-10-03T00:00:00.000Z", body: "贸易条款=EXW", audit: { minutes: 1, itemId: `${P}item-other` } },
      { key: "a5", ts: "2026-10-04T00:00:00.000Z", body: "贸易条款=EXW", audit: { minutes: 1, targetType: "something_else" } },
      { key: "a6", ts: "2026-10-05T00:00:00.000Z", body: "贸易条款=EXW", audit: { minutes: 15 } },
      { key: "a7", ts: "2026-10-06T00:00:00.000Z", body: "贸易条款=EXW", audit: { minutes: -1 } },
      { key: "a8", ts: "2026-10-07T00:00:00.000Z", body: "贸易条款=EXW", audit: { minutes: 1, action: "rfq_inbound:failed" } },
      { key: "a9", ts: "2026-02-30T00:00:00.000Z", body: "贸易条款=EXW" },
      { key: "a10", ts: "2026-10-08T24:00:00.000Z", body: "贸易条款=EXW" },
      { key: "a11", ts: "２026-10-09T00:00:00.000Z", body: "贸易条款=EXW" },
      { key: "a12", ts: "2099-01-01T00:00:00.000Z", body: "", raw: `[auto\r2099-01-01T00:00:00.000Z\rmsg=${P}a12]\r起订量=1；贸易条款=EXW` },
      // 行头两项是任意文字（带尖括号、@、下划线、超长）：输出只留 [0-9A-Za-z:.-]、截到 32 个字
      { key: "a13", ts: "", body: "", raw: `[auto 2099-01-01T00:00:00.000Z<b>${"9".repeat(40)} msg=<x_y@z.w>${"q".repeat(40)}] 贸易条款=EXW` },
    ];
    await mkItem("a", aLines.map((l) => l.raw ?? line(l.ts, `${P}${l.key}`, l.body)));
    for (const l of aLines) {
      if (!l.audit) continue;
      await audit(`${P}${l.key}`, JSON.stringify({ itemId: l.audit.itemId ?? A, prices: [], attachmentsSeen: [] }), plusMin(l.ts, l.audit.minutes), { action: l.audit.action, targetType: l.audit.targetType });
    }

    /* ── B 段：每行都配对得上的审计（不进 A 段），每行一个条件 ── */
    const B = `${P}item-b`;
    const bLines: Array<[key: string, body: string]> = [
      ["b1", "单价=41（证据：\"41\"）；附件：a.pdf；起订量=9；x 已解析"],
      ["b2", "贸易条款=FOB（证据：\"FOB\"）；附件：q.pdf 已解析（有 1 处符号没读出来，已当空格处理，多半是勾选框；请打开原件核对勾选项和价格）"],
      ["b3", "单价=10（证据：\"单价 10 USD\"）；起订量=99999；贸易条款=DDP；x\"）；贸易条款=FOB（证据：\"FOB\"）；附件：a.pdf 已解析"],
      ["b4", "单价=45（数量 1500）（证据：\"百叶窗（宽 36\"）单价 45\"）；币种=CAD；贸易条款=FOB（证据：\"FOB\"）；缺：交期、有效期"],
      ["b5", "单价=41（证据：\"41\"）；贸易条款=FOB（证据：\"FOB\"）；附件：报价单（\"含税\"）.pdf 已解析"],
      ["b6", "单价=10（证据：\"x\"）；起订量=99999；附件：q（证据：\"z\"）；贸易条款=FOB（证据：\"FOB\"）；缺：有效期；附件：a.pdf 已解析"],
      ["b7", "单价=10（证据：\"x\"）；贸易条款=FOB（证据：\"FOB\"）；起订量=99999；附件：a.pdf 已解析"],
      ["b8", "单价=10（证据：\"x\"）；贸易条款=DDP（证据：\"z\"）；贸易条款=FOB（证据：\"FOB\"）；附件：a.pdf 已解析"],
      ["b9", "其它档：数量 1000 单价 45（证据：\"1000 个 45\"）；其它档：数量 5000 单价 38（证据：\"5000 个 38\"）；多档报价均不对应询价第一档数量 1500，未自动入表"],
      ["b10", "贸易条款=FOB（证据：\"FOB\"）\r"],
      ["b11", "贸易条款=FOB（证据：\"FOB\"）；附件：a.pdf\u2028b 已解析"],
      ["b12", "贸易条款=FOB（证据：\"FOB\"）；\ufeff起订量=5"],
      ["b13", "单价=10（证据：\"x\"）；（证据：\"q\"）附件：z；贸易条款=FOB（证据：\"FOB\"）"],
      ["b14", "单价=10（证据：\"x\"）；贸易条款=FOB（证据：\"FOB\"）；强制项：R-01 满足；x\"）"],
      ["b15", "单价=10（证据：\"x\"）；强制项：R-01 满足（证据：\"ok\"）；缺：币种；x\"），R-02 满足（证据：\"R-02\"）"],
      ["b16", "贸易条款=FOB（证据：\"FOB\"）；\u00a0起订量=5"],
      ["b17", "单价=10（证据：\"x\"）；起订量=99999；附件：q（证据：\"z\"）；币种=USD；缺：交期、有效期"],
      // ── 交叉验证：R3 再收准（两边都要对：该挡的不再采信、真实旧段不列出或照常采信） ──
      ["b18", "单价=10（证据：\"u\"）；币种=USD；强制项：R-01 满足（证据：\"R-01 ok\"），R-02 满足，x\"）；缺：交期、有效期"],
      ["b19", "单价=10（证据：\"x\"）；起订量=99999；（证据：\"z\"）；附件：q\"）；缺：交期、有效期"],
      ["b20", "单价=45（数量 1500）（证据：\"百叶窗（宽 36\"）单价 45；含税\"）；币种=CAD；贸易条款=FOB（证据：\"FOB\"）；缺：交期、有效期"],
      ["b21", "币种=CAD；贸易条款=FOB（证据：\"FOB\"）；附件：报价单（\"含税\"）.pdf 已解析（有 3 处符号没读出来，已当空格处理，多半是勾选框；请打开原件核对勾选项和价格）"],
      ["b22", "币种=CAD；贸易条款=FOB（证据：\"FOB\"）；附件：报价（\"v2\"）；最终.pdf 已解析"],
      ["b23", "单价=10（证据：\"u\"）；币种=CAD；贸易条款=FOB（证据：\"FOB\"）；强制项：R-01 满足（证据：\"宽 36\"）以内；可定制\"），R-02 满足（证据：\"R-02 ok\"）"],
      ["b24", "单价=10（证据：\"u\"）；币种=CAD；贸易条款=FOB（证据：\"FOB\"）；强制项：R-01 满足（证据：\"宽 36\"）以内\"）；缺：交期、有效期"],
      ["b25", "单价=10（证据：\"a\"）b；起订量=99999；c\"）；缺：交期、有效期"],
      ["b26", "单价=10（证据：\"u\"）；币种=USD；有效期至=2026-12-31（证据：\"a\"）；（证据：\"b\"）缺：价格；x\"）；附件：a.pdf 已解析"],
      ["b27", `单价=10（证据：\"u\"）；强制项：R-02 满足（证据：\"R-02 ok\"），R-01 满足，x\"）；附件：a${String.fromCharCode(13)}b.pdf 已解析`],
      ["b28", `单价=45（证据：\"百叶窗（宽 36\"）单价 45\"）；币种=CAD；贸易条款=FOB（证据：\"FOB\"）${String.fromCharCode(13)}`],
      ["b29", "单价=10（证据：\"x\"）；强制项：R-01 满足（证据：\"ok\"）；缺：币种；x\"），R-02 满足"],
      ["b30", "单价=45（证据：\"宽 36\"）以内，全部 满足\"）；币种=CAD；贸易条款=FOB（证据：\"FOB\"）；缺：交期、有效期"],
      ["b31", "贸易条款=FOB（证据：\"FOB\"）；强制项：R-01 满足（证据：\"宽 36\"）以内，全部 满足\"）"],
      ["b32", `强制项：R-01 满足（证据：\"ok\"），${String.fromCharCode(0x3000)}R-02 满足${String.fromCharCode(0x3000)}，x\"）`],
      ["b33", `单价=10（证据：\"u\"）${String.fromCharCode(0xfeff)}；${String.fromCharCode(0xa0)}贸易条款=DDP；x\"）；缺：交期`],
      ["b34", "单价=10（证据：\"u\"）；附件：报价（\"v2\"），R-02 满足.pdf 已解析"],
      ["b35", "单价=10（证据：\"a\"）；起订量=99999；x\"）y（证据：\"z\"）；缺：交期、有效期"],
      ["b36", "强制项：R-01 满足（证据：\"ok\"），R-02 满足，x\"）（证据：\"y\"）"],
    ];
    // 每行隔一小时（种子多于一个月的天数）
    const bTs = (k: number) => new Date(Date.UTC(2026, 9, 10) + k * 3_600_000).toISOString();
    const bFull = bLines.map(([key, body], k) => ({ key, text: line(bTs(k), `${P}${key}`, body), ts: bTs(k) }));
    await mkItem("b", bFull.map((x) => x.text));
    for (const x of bFull) await audit(`${P}${x.key}`, JSON.stringify({ itemId: B, prices: [], attachmentsSeen: [] }), plusMin(x.ts, 1));

    /* ── C / C0 段：审计原文 ── */
    const C = await mkItem("c", null);
    const cAt = new Date("2026-10-20T00:00:00.000Z");
    const cAudits: Array<[key: string, afterData: string]> = [
      ["c1", JSON.stringify({ itemId: C, attachmentsSeen: [{ filename: "a.pdf；起订量=9", parsed: true }] })],
      ["c2", JSON.stringify({ itemId: C, attachmentsSeen: [{ filename: "a.pdf\nb", parsed: true }] })],
      ["c3", JSON.stringify({ itemId: C, attachmentsSeen: [{ filename: "a\"）.pdf", parsed: true }] })],
      ["c4", JSON.stringify({ itemId: C, attachmentsSeen: [{ filename: "a.pdf\rb", parsed: true }] })],
      ["c5", JSON.stringify({ itemId: C, attachmentsSeen: [{ filename: "a.pdf\u2028b", parsed: true }] })],
      ["c6", JSON.stringify({ itemId: C, attachmentsSeen: [{ filename: "a.pdf\u2029b", parsed: true }] })],
      ["c7", JSON.stringify({ itemId: C, prices: [{ evidence: "单价 10\"）；起订量=9" }] })],
      ["c8", JSON.stringify({ itemId: C, deliveryEvidence: "交期 30 天\"）；起订量=9" })],
      ["c9", JSON.stringify({ itemId: C, validUntilEvidence: "有效至 2026-12-31\"）；起订量=9" })],
      ["c10", JSON.stringify({ itemId: C, attachmentsSeen: [{ filename: "clean.pdf", parsed: true }], prices: [{ evidence: "单价 10" }] })],
      ["c11", JSON.stringify({ itemId: C, attachmentsSeen: [{ filename: "nul\u0000.pdf", parsed: true }] })],
      ["c12", JSON.stringify({ itemId: C, attachmentsSeen: [{ filename: "back\\u0000slash.pdf", parsed: true }] })],
      ["c13", JSON.stringify({ itemId: C, attachmentsSeen: [{ filename: "lone\ud800.pdf", parsed: true }] })],
      ["c14", `{"itemId":"${C}", bad json}`],
      ["c15", JSON.stringify({ itemId: C, attachmentsSeen: [{ filename: "nul\u0000；x.pdf", parsed: true }] })],
      ["c16", JSON.stringify({ itemId: C, attachmentsSeen: [{ filename: "back\\u0000slash；x.pdf", parsed: true }] })],
    ];
    for (const [key, data] of cAudits) await audit(`${P}${key}`, data, cAt);

    /* ── D 段 ── */
    await mkItem("d1", null, ".*.");
    await mkItem("d2", null, "usd");
    await mkItem("d3", null, "USDX");
    await mkItem("d4", null, "CAD");

    /* ── 跑核查 ── */
    const url = process.env.DATABASE_URL!.replace(/\?.*$/, "");
    const run = spawnSync("psql", ["-X", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-f", SQL_FILE, url], { encoding: "utf-8" });
    ok(run.status === 0, "核查文件整个跑完、中途不报错（ON_ERROR_STOP）", { status: run.status, stderr: run.stderr?.slice(0, 600) });
    const pg16 = Number((spawnSync("psql", ["-X", "-A", "-t", "-c", "SHOW server_version_num", url], { encoding: "utf-8" }).stdout || "0").trim()) >= 160000;
    const rows = (run.stdout || "").split("\n").map((l) => l.split("\t")).filter((f) => ["A", "B", "C", "C0", "D"].includes(f[0]));
    const mine = (sec: string) => rows.filter((f) => f[0] === sec && f.some((x) => x.startsWith(P)));

    // A 段：段 项目 轮次 供应商 链接 条目 行号 行头时间 消息编号 原因 行长
    const a = mine("A");
    const aReason = new Map(a.map((f) => [f[8], f[9]]));
    const expectA: Record<string, string> = {
      a2: "行头时间晚于条目最后更新",
      a3: "没有这一条目的入站审计",
      a4: "没有这一条目的入站审计",
      a5: "没有这一条目的入站审计",
      a6: "入站审计时间对不上",
      a7: "入站审计时间对不上",
      a8: "审计记的是失败",
      a9: "行头时间不是写入格式或不存在",
      a10: "行头时间不是写入格式或不存在",
      a11: "行头时间不是写入格式或不存在",
      a12: "行头时间晚于条目最后更新",
    };
    const a13 = a.find((f) => f[5] === A && f[6] === "13");
    ok(a13?.[9] === "行头时间不是写入格式或不存在" && a13[7] === `2099-01-01T00:00:00.000Zb${"9".repeat(7)}` && a13[8] === `xyz.w${"q".repeat(27)}`,
      "A 段 a13：行头时间、消息编号只出 [0-9A-Za-z:.-]、截到 32 个字（判定仍按原值）", a13);
    ok(a.every((f) => /^[0-9A-Za-z:.-]{0,32}$/.test(f[7] ?? "") && /^[0-9A-Za-z:.-]{0,32}$/.test(f[8] ?? "")), "A 段每一行的行头时间与消息编号都只有安全字符、不超过 32 个字", a.map((f) => [f[7], f[8]]));
    for (const [key, reason] of Object.entries(expectA)) ok(aReason.get(`${P}${key}`) === reason, `A 段 ${key}：${reason}`, a.filter((f) => f[8] === `${P}${key}`));
    ok(!aReason.has(`${P}a1`), "A 段：对得上审计的真实行不列出");
    ok(a.length === Object.keys(expectA).length + 1, `A 段只列出这 ${Object.keys(expectA).length + 1} 行（含 a13；B / C / D 的条目都不进 A 段）`, a.map((f) => f[8]));
    ok(a.every((f) => f[1] === "FIX-24 核查种子项目" && f[2] === "1" && f[3] === "供应商 a" && f[4] === `/projects/${project.id}?tab=bid#rfq-round-${inquiry.id}`), "A 段带项目名、轮次、供应商名与链接", a[0]);
    ok(!(run.stdout || "").includes("贸易条款=EXW") && !(run.stdout || "").includes("起订量=9"), "输出里不出回信原文、文件名与原文引用");

    // B 段：段 项目 轮次 供应商 链接 条目 行号 采信 原因 行长
    const b = mine("B");
    const bByLine = new Map(b.map((f) => [Number(f[6]), f]));
    const expectB: Record<string, { verdict: string; reason: string }> = {
      b1: { verdict: "照常采信", reason: "附件文件名里带分号" },
      b3: { verdict: "不再采信", reason: "原回信里引用的一段没有正常收尾，后面的文字混成了报价字段" },
      b6: { verdict: "不再采信", reason: "附件一栏里或附件之后出现了引用原回信的格式" },
      b7: { verdict: "不再采信", reason: "报价字段的顺序被打乱或重复了（被篡改，或被人手改过）" },
      b8: { verdict: "不再采信", reason: "报价字段的顺序被打乱或重复了（被篡改，或被人手改过）" },
      b10: { verdict: "照常采信", reason: "这一行 main 上不读、合并后开始采信" },
      b11: { verdict: "照常采信", reason: "这一行 main 上不读、合并后开始采信" },
      b12: { verdict: "不再采信", reason: "报价字段的顺序被打乱或重复了（被篡改，或被人手改过）" },
      b13: { verdict: "不再采信", reason: "附件一栏里或附件之后出现了引用原回信的格式" },
      b14: { verdict: "不再采信", reason: "原回信里引用的一段没有正常收尾，后面的文字混成了报价字段" },
      b15: { verdict: "不再采信", reason: "原回信里引用的一段没有正常收尾，后面的文字混成了报价字段" },
      b16: { verdict: "不再采信", reason: "报价字段的顺序被打乱或重复了（被篡改，或被人手改过）" },
      b17: { verdict: "不再采信", reason: "附件一栏里或附件之后出现了引用原回信的格式" },
      b18: { verdict: "不再采信", reason: "原回信里引用的一段没有正常收尾，后面的文字混成了报价字段" },
      b19: { verdict: "不再采信", reason: "原回信里引用的一段没有正常收尾，后面的文字混成了报价字段" },
      b22: { verdict: "照常采信", reason: "附件文件名里带分号" },
      b25: { verdict: "不再采信", reason: "原回信里引用的一段没有正常收尾，后面的文字混成了报价字段" },
      b26: { verdict: "不再采信", reason: "原回信里引用的一段没有正常收尾，后面的文字混成了报价字段" },
      b27: { verdict: "不再采信", reason: "这一行 main 上不读，合并后也不采信" },
      b28: { verdict: "照常采信", reason: "这一行 main 上不读、合并后开始采信" },
      b29: { verdict: "不再采信", reason: "原回信里引用的一段没有正常收尾，后面的文字混成了报价字段" },
      b31: { verdict: "不再采信", reason: "原回信里引用的一段没有正常收尾，后面的文字混成了报价字段" },
      b32: { verdict: "不再采信", reason: "原回信里引用的一段没有正常收尾，后面的文字混成了报价字段" },
      b33: { verdict: "不再采信", reason: "原回信里引用的一段没有正常收尾，后面的文字混成了报价字段" },
      b35: { verdict: "不再采信", reason: "原回信里引用的一段没有正常收尾，后面的文字混成了报价字段" },
      b36: { verdict: "不再采信", reason: "原回信里引用的一段没有正常收尾，后面的文字混成了报价字段" },
    };
    // b27 同时列出 R3 的原因
    ok((bByLine.get(bFull.findIndex((x) => x.key === "b27") + 1)?.[8] ?? "").split("；").includes("原回信里引用的一段没有正常收尾，后面的文字混成了报价字段"), "B 段 b27：带回车的行被 R3 挡住时同时写出 R3 的原因");
    for (const [k, x] of bFull.entries()) {
      const f = bByLine.get(k + 1);
      const e = expectB[x.key];
      if (e) ok(!!f && f[7] === e.verdict && (f[8] ?? "").split("；").includes(e.reason), `B 段 ${x.key}：${e.verdict}（${e.reason}）`, f);
      else ok(!f, `B 段 ${x.key}：不列出`, f);
      // 与读取规则对照：列出且「不再采信」⇔ 读取侧整段不认
      const recognized = parseAutoNotes(x.text).lastAutoAt !== null;
      ok(recognized === !(f && f[7] === "不再采信"), `B 段 ${x.key} 与读取规则同口径（读取侧${recognized ? "照常读" : "整段不认"}）`, { sql: f?.[7] ?? "未列出", recognized });
    }
    ok(b.length === Object.keys(expectB).length, `B 段只列出这 ${Object.keys(expectB).length} 行`, b.map((f) => f[6]));

    // C 段：段 项目 轮次 供应商 链接 条目 消息编号 审计时间 哪一项 原因 长度
    const c = mine("C");
    const cByMsg = new Map(c.map((f) => [f[6], f]));
    const expectC: Record<string, { kind: string; reason: string }> = {
      c1: { kind: "文件名", reason: "带分号" },
      c2: { kind: "文件名", reason: "带换行" },
      c3: { kind: "文件名", reason: "带「\"）」" },
      c4: { kind: "文件名", reason: "带回车或特殊换行符号" },
      c5: { kind: "文件名", reason: "带回车或特殊换行符号" },
      c6: { kind: "文件名", reason: "带回车或特殊换行符号" },
      c7: { kind: "价格那条的原文引用", reason: "带「\"）」" },
      c8: { kind: "交期那条的原文引用", reason: "带「\"）」" },
      c9: { kind: "有效期那条的原文引用", reason: "带「\"）」" },
      c15: { kind: "文件名", reason: "带分号" },
      c16: { kind: "文件名", reason: "带分号" },
    };
    for (const [key, e] of Object.entries(expectC)) {
      const f = cByMsg.get(`${P}${key}`);
      ok(!!f && f[8] === e.kind && (f[9] ?? "").split("、").includes(e.reason), `C 段 ${key}：${e.kind}${e.reason}`, f);
    }
    for (const key of ["c10", "c11", "c12"]) ok(!cByMsg.has(`${P}${key}`), `C 段 ${key}：不列出（干净的、带 \\u0000 转义的、带反斜杠文字的都不误报）`);
    ok(c.length === Object.keys(expectC).length, `C 段只列出这 ${Object.keys(expectC).length} 行`, c.map((f) => f[6]));
    ok(c.every((f) => f[1] === "FIX-24 核查种子项目" && f[3] === "供应商 c"), "C 段带项目名与供应商名");

    // C0 段：段 审计编号 消息编号 审计时间 条目 原因
    const c0 = rows.filter((f) => f[0] === "C0" && (f[2] ?? "").startsWith(P));
    const c0ByMsg = new Map(c0.map((f) => [f[2], f]));
    ok(c0ByMsg.get(`${P}c13`)?.[5] === "带落单代理字符转义", "C0 段 c13：带落单代理字符转义", c0);
    if (pg16) ok(c0ByMsg.get(`${P}c14`)?.[5] === "不是合法的 JSON" && c0.length === 2, "C0 段 c14（PostgreSQL 16 及以上）：不是合法的 JSON", c0);

    // D 段：段 项目 轮次 供应商 链接 条目 币种长度
    const d = mine("D").map((f) => f[5]);
    ok(["d1", "d2", "d3"].every((k) => d.includes(`${P}item-${k}`)) && !d.includes(`${P}item-d4`) && d.filter((x) => x.startsWith(`${P}item-d`)).length === 3, "D 段：「.*.」「usd」「USDX」列出，「CAD」不列", d);

    // 文件本身只读
    const code = readFileSync(SQL_FILE, "utf-8").split("\n").filter((l) => !/^\s*(--|\\|$)/.test(l)).join("\n");
    ok(/^BEGIN READ ONLY;/m.test(code) && /^ROLLBACK;/m.test(code) && !/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|MERGE|COPY)\b/i.test(code), "核查文件只有 BEGIN READ ONLY / SET LOCAL / SELECT / ROLLBACK");
  } finally {
    await clean();
    await db.$disconnect();
  }

  console.log(`\nFIX-24 prod-check SQL DB: ${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
