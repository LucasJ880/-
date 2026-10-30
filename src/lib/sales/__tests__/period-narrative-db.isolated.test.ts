/**
 * KPI-2：期间看板 AI 解读——真实 DB（隔离库）+ 真实路由 + 真实 createCompletionDetailed，
 * 模型端是本机起的 OpenAI 兼容假服务（OPENAI_BASE_URL 指过去），不打真模型（spec sales/period-narrative）。
 *
 *   开关关 404 且零调用、GET narrativeEnabled 两种取值；403 / 400 零调用；合法输出 200；
 *   编造数字 / 越词表 / 坏格式回落；模型报错 model_error；费用超限 budget_exceeded（注入）；
 *   本人范围提示词不含他人；审计只记结果；第 7 次 429。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/sales/__tests__/period-narrative-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过期间看板 AI 解读 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "KPI-2 sales period narrative DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "kpi-2-isolated-test-secret-0123456789abcdef";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : "");
  }
}

type Handler = (r: unknown, c: unknown) => Promise<Response>;
type Json = Record<string, unknown>;

/** 多伦多 10 月为 UTC−4 */
const edt = (local: string) => new Date(`${local}-04:00`);

// ── 本机 OpenAI 兼容假服务：按队列回复，记录每次请求 ──
type Reply = { status: number; content: string };
const replies: Reply[] = [];
const received: Array<{ system: string; user: string }> = [];
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body || "{}") as { model?: string; messages?: Array<{ role: string; content: string }> };
    const msgs = parsed.messages ?? [];
    received.push({ system: msgs.find((m) => m.role !== "user")?.content ?? "", user: msgs.find((m) => m.role === "user")?.content ?? "" });
    const r = replies.shift() ?? { status: 200, content: "{}" };
    res.setHeader("content-type", "application/json");
    if (r.status !== 200) {
      res.statusCode = r.status;
      res.end(JSON.stringify({ error: { message: r.content, type: "invalid_request_error" } }));
      return;
    }
    res.end(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: parsed.model ?? "test-model",
        choices: [{ index: 0, message: { role: "assistant", content: r.content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
    );
  });
});

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.SALES_PERIOD_NARRATIVE_ENABLED;

  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { generatePeriodNarrative } = await import("@/lib/sales/period/narrative");
  const { periodBounds } = await import("@/lib/sales/period/summary-pure");
  const summaryRoute = await import("@/app/api/sales/period-summary/route");
  const narrativeRoute = await import("@/app/api/sales/period-summary/narrative/route");

  const stamp = Date.now().toString(36);
  const OWNER = `knowner_${stamp}`;
  const OWNER2 = `knowner2_${stamp}`;
  const REP_A = `knrepa_${stamp}`;
  const REP_B = `knrepb_${stamp}`;
  const PLAIN = `knplain_${stamp}`;
  const users = [OWNER, OWNER2, REP_A, REP_B, PLAIN];
  const ORG = `knorg_${stamp}`;
  const CUST = `kncust_${stamp}`;
  const names: Record<string, string> = { [OWNER]: "Olivia Owner", [OWNER2]: "Oscar Owner", [REP_A]: "Riley Rep", [REP_B]: "Robin Rep", [PLAIN]: "Pat Plain" };

  for (const id of users) await db.user.create({ data: { id, email: `${id}@fixture.test`, name: names[id], role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Example Shutters Fixture", code: `kno-${stamp}`, ownerId: OWNER, industryPackId: "window_covering_services_v1" } });
  for (const id of users) await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: "org_member", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  await bind(OWNER, "owner");
  await bind(OWNER2, "owner");
  await bind(REP_A, "sales_rep");
  await bind(REP_B, "sales_rep");

  await db.salesCustomer.create({ data: { id: CUST, orgId: ORG, name: "Example Homeowner", createdById: REP_A } });
  const quoteIds: string[] = [];
  const quote = async (tag: string, data: Record<string, unknown>) => {
    const id = `knq${tag}_${stamp}`;
    quoteIds.push(id);
    await db.salesQuote.create({ data: { id, orgId: ORG, customerId: CUST, orderNumber: `KN-${tag}-${stamp}`, createdById: REP_A, ...data } as never });
  };
  // A 签 1,000（未登记定金）；B 签 3,000；B 报出未签 500
  await quote("a1", { status: "signed", sentAt: edt("2026-10-04T10:00:00"), signedAt: edt("2026-10-05T10:00:00"), grandTotal: 1000, preTaxTotal: 885 });
  await quote("b1", { createdById: REP_B, status: "signed", sentAt: edt("2026-10-05T10:00:00"), signedAt: edt("2026-10-06T10:00:00"), grandTotal: 3000, preTaxTotal: 2655 });
  await quote("b2", { createdById: REP_B, status: "sent", sentAt: edt("2026-10-07T10:00:00"), grandTotal: 500, preTaxTotal: 442.48 });

  const cookie = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: "user" })}`;
  const QS = `?orgId=${ORG}&from=2026-10-01&to=2026-10-28`;
  const getSummary = async (uid: string) => {
    const r = new NextRequest(`http://localhost/api/sales/period-summary${QS}`, { method: "GET", headers: { cookie: await cookie(uid), "x-forwarded-for": "10.42.0.1" } });
    const res = await (summaryRoute.GET as unknown as Handler)(r, { params: Promise.resolve({}) });
    return { status: res.status, body: (await res.json()) as Json };
  };
  const postNarrative = async (uid: string, qs = QS) => {
    const r = new NextRequest(`http://localhost/api/sales/period-summary/narrative${qs}`, { method: "POST", headers: { cookie: await cookie(uid), "x-forwarded-for": "10.42.0.2" } });
    const res = await (narrativeRoute.POST as unknown as Handler)(r, { params: Promise.resolve({}) });
    const text = await res.text();
    return { status: res.status, text, body: (text ? JSON.parse(text) : null) as Json | null };
  };
  const audits = () =>
    db.auditLog.findMany({ where: { orgId: ORG, action: "sales.period_narrative.generated" }, orderBy: { createdAt: "asc" }, select: { userId: true, afterData: true, targetId: true } });

  try {
    console.log("\n[1] 开关关");
    const g0 = await getSummary(OWNER);
    ok(g0.status === 200 && g0.body.narrativeEnabled === false && g0.body.narrative === null, "GET narrativeEnabled = false，narrative = null", { s: g0.status, e: g0.body.narrativeEnabled });
    const p0 = await postNarrative(OWNER);
    ok(p0.status === 404 && p0.body?.code === "NARRATIVE_DISABLED", "POST → 404 NARRATIVE_DISABLED", p0.body);
    ok(received.length === 0, "零模型调用");

    process.env.SALES_PERIOD_NARRATIVE_ENABLED = "true";
    console.log("\n[2] 开关开：GET 回显");
    const g1 = await getSummary(OWNER);
    const totals = g1.body.totals as Record<string, number>;
    ok(g1.body.narrativeEnabled === true && g1.body.narrative === null, "GET narrativeEnabled = true，narrative 仍为 null");
    ok(totals.wonCount === 2 && totals.wonAmount === 4000 && totals.openQuotedCount === 1, "种子数据：成单 2 单 4,000、在手 1 份", totals);

    console.log("\n[3] 授权与期间（零调用）");
    const p403 = await postNarrative(PLAIN);
    ok(p403.status === 403, "无 sales.analytics.read → 403", p403.status);
    const p400 = await postNarrative(OWNER, `?orgId=${ORG}&from=2026-10-28&to=2026-10-01`);
    ok(p400.status === 400 && p400.body?.code === "INVALID_PERIOD", "期间不合法 → 400 INVALID_PERIOD");
    ok(received.length === 0, "仍是零模型调用");

    console.log("\n[4] 合法输出");
    const good = {
      conclusion: [`本期成单 ${totals.wonCount} 单，合计 $4,000；报出 3 份，金额 4,500。`],
      reasons: [],
      nextSteps: [
        { action: "chase_signature", text: "跟进那 1 份在手未签的报价。", repName: null },
        { action: "review_rep", text: "看看 Robin Rep 的 2 份报价。", repName: "Robin Rep" },
      ],
    };
    replies.push({ status: 200, content: JSON.stringify(good) });
    const ok1 = await postNarrative(OWNER);
    const n1 = ok1.body?.narrative as Json | null;
    ok(ok1.status === 200 && n1 !== null && ok1.body?.fallbackReason === null, "200，narrative 非空，fallbackReason = null", ok1.body);
    ok((n1?.nextSteps as Json[])?.[0]?.label === "催签" && (n1?.nextSteps as Json[])?.[1]?.repName === "Robin Rep", "下一步带中文标签与姓名");
    ok(ok1.body?.scope === "org" && (ok1.body?.period as Json)?.days === 28, "响应含范围与期间");
    ok(received.length === 1, "一次请求只调用一次模型", received.length);
    ok(received[0].system.includes("只输出一个 JSON 对象"), "收到固定系统提示词");
    const orgInput = JSON.parse(received[0].user) as Json;
    ok(JSON.stringify(orgInput).includes("Robin Rep") && JSON.stringify(orgInput).includes("Riley Rep"), "全企业范围输入含按人姓名");
    ok(!JSON.stringify(orgInput).includes("Example Homeowner") && !JSON.stringify(orgInput).includes(REP_A), "输入不含客户名与 userId");

    console.log("\n[5] 回落");
    replies.push({ status: 200, content: JSON.stringify({ ...good, conclusion: ["本期成单 65,000。"] }) });
    const fake = await postNarrative(OWNER);
    ok(fake.status === 200 && fake.body?.narrative === null && fake.body?.fallbackReason === "invalid_numbers", "编造数字 → invalid_numbers", fake.body);
    replies.push({ status: 200, content: JSON.stringify({ ...good, nextSteps: [{ action: "send_email", text: "给客户发邮件。", repName: null }] }) });
    const badRef = await postNarrative(OWNER);
    ok(badRef.body?.narrative === null && badRef.body?.fallbackReason === "invalid_reference", "词表外动作 → invalid_reference");
    replies.push({ status: 200, content: "抱歉，我无法完成。" });
    const badFmt = await postNarrative(OWNER);
    ok(badFmt.body?.fallbackReason === "invalid_format", "不是 JSON → invalid_format");
    replies.push({ status: 400, content: "bad request" });
    const err = await postNarrative(OWNER);
    ok(err.status === 200 && err.body?.narrative === null && err.body?.fallbackReason === "model_error", "模型报错 → 200 + model_error", err.body);
    ok(received.length === 5, "每次请求各一次调用（400 不触发 SDK 重试）", received.length);

    console.log("\n[6] 费用超限（注入的模型调用）");
    let injected = 0;
    const budget = await generatePeriodNarrative(
      { orgId: ORG, userId: OWNER, scope: { kind: "org" }, period: periodBounds("2026-10-01", "2026-10-28", "America/Toronto"), compare: "prev_period" },
      {
        complete: async () => {
          injected += 1;
          throw new Error("配额限制：月 AI 费用已达 hard limit");
        },
      },
    );
    ok(budget.narrative === null && budget.fallbackReason === "budget_exceeded" && injected === 1, "→ budget_exceeded", budget);

    console.log("\n[7] 本人范围");
    replies.push({ status: 200, content: JSON.stringify({ conclusion: ["本期你签了 1 单，金额 $1,000。"], reasons: [], nextSteps: [] }) });
    const own = await postNarrative(REP_A);
    ok(own.status === 200 && own.body?.scope === "own" && own.body?.fallbackReason === null, "本人范围 200", own.body);
    const ownInput = received.at(-1)!.user;
    ok(!ownInput.includes("Robin Rep") && !ownInput.includes("Olivia Owner") && ownInput.includes("Riley Rep"), "提示词只有本人姓名，不含他人（spec 场景）", ownInput.slice(0, 300));
    const ownParsed = JSON.parse(ownInput) as { byRep: unknown[]; allowedActions: string[]; calendar: unknown };
    ok(ownParsed.byRep.length === 1 && !ownParsed.allowedActions.includes("review_rep") && ownParsed.calendar === null, "本人范围：一行、无看某销售、无日程来源");
    replies.push({ status: 200, content: JSON.stringify({ conclusion: ["看看 Riley Rep。"], reasons: [], nextSteps: [{ action: "review_rep", text: "看看自己。", repName: "Riley Rep" }] }) });
    const ownRep = await postNarrative(REP_A);
    ok(ownRep.body?.fallbackReason === "invalid_reference", "本人范围给出看某销售 → invalid_reference");

    console.log("\n[8] 审计");
    const rows = await audits();
    const outcomes = rows.map((r) => (JSON.parse(r.afterData ?? "{}") as Json).outcome);
    ok(
      JSON.stringify(outcomes) === JSON.stringify(["ok", "invalid_numbers", "invalid_reference", "invalid_format", "model_error", "budget_exceeded", "ok", "invalid_reference"]),
      "每次调用一条审计，outcome 依次正确",
      outcomes,
    );
    const first = JSON.parse(rows[0].afterData ?? "{}") as Json;
    ok(Object.keys(first).sort().join(",") === "compare,elapsedMs,from,model,outcome,scope,to", "审计只有约定字段", Object.keys(first));
    const raw = rows.map((r) => r.afterData ?? "").join(" ");
    ok(!raw.includes("本期成单") && !raw.includes("4,000") && !raw.includes("Robin Rep") && !raw.includes("conclusion"), "审计不含解读正文、金额与姓名");
    ok(rows[0].userId === OWNER && rows[0].targetId === "2026-10-01..2026-10-28", "审计 userId 与 targetId");

    console.log("\n[9] 限次");
    const before = received.length;
    let lastOk = 0;
    for (let i = 0; i < 6; i++) {
      replies.push({ status: 200, content: JSON.stringify({ conclusion: ["本期成单 2 单。"], reasons: [], nextSteps: [] }) });
      const r = await postNarrative(OWNER2);
      if (r.status === 200) lastOk += 1;
    }
    const seventh = await postNarrative(OWNER2);
    ok(lastOk === 6 && seventh.status === 429 && seventh.body?.code === "RATE_LIMITED", "同一成员第 7 次 → 429 RATE_LIMITED", { lastOk, s: seventh.status });
    ok(received.length - before === 6, "429 不调用模型");
  } finally {
    delete process.env.SALES_PERIOD_NARRATIVE_ENABLED;
    await db.salesQuote.deleteMany({ where: { id: { in: quoteIds } } });
    await db.salesCustomer.deleteMany({ where: { id: CUST } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: ORG }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.roleProfile.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
    server.close();
  }

  console.log(`\n期间看板 AI 解读 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  server.close();
  process.exit(1);
});
