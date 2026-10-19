/**
 * Runtime V2 legacy 跟进写工具安全回归（DB-free）
 *
 * R4：calendar_create_event_draft / grader_create_followup_task /
 *     sales_update_followup 不得凭空推算提醒时间（曾为 nextFridayIso：
 *     "下周五 15:00"，服务器本地时区）——计划步骤不携带用户明确时间 →
 *     fail-closed 跳过（REMINDER_TIME_REQUIRED），不查库、不建草稿。
 * R5：gmail_create_draft 的客户邮件正文不得拼接内部评分理由
 *     （"跟进逾期 12 天(+30)"），客户名必须 HTML 转义。
 *
 * 安全：Prisma 指向不可达的本地假地址，且本测试触达的 delegate 全部打桩；
 * 任何未打桩的查询只会连接失败，绝不可能连到真实库。
 *
 * 运行：npx tsx src/lib/agent-runtime-v2/__tests__/legacy-followup-safety.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const FAKE_DB_URL =
  "postgresql://legacy_followup_safety:x@127.0.0.1:1/legacy_followup_safety";
process.env.DATABASE_URL = FAKE_DB_URL;
process.env.DIRECT_URL = FAKE_DB_URL;
process.env.NODE_ENV = "test";
process.env.QINGYAN_RUNTIME_ENV = "test";
delete process.env.VERCEL_ENV;

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

type AnyFn = (...args: unknown[]) => Promise<unknown>;
type Delegate = Record<string, AnyFn>;

const SCORING_REASONS = ["跟进逾期 12 天(+30)", "报价已发 9 天未回复(+20)"];

async function main() {
  const { db } = await import("@/lib/db");
  const adapters = await import("../adapters");
  const {
    executeRuntimeV2Tool,
    neutralFollowupEmailContent,
    REMINDER_TIME_REQUIRED,
  } = adapters;
  type Ctx = Parameters<typeof executeRuntimeV2Tool>[1];

  const client = db as unknown as Record<string, unknown>;
  const dbCalls: string[] = [];
  const restores: Array<() => void> = [];
  function stub(model: string, method: string, impl: AnyFn) {
    const target = (model ? client[model] : client) as Delegate;
    const original = target[method];
    target[method] = async (...args: unknown[]) => {
      dbCalls.push(`${model || "client"}.${method}`);
      return impl(...args);
    };
    restores.push(() => {
      target[method] = original;
    });
  }
  const forbidden = (label: string): AnyFn => async () => {
    throw new Error(`UNEXPECTED_DB_ACCESS: ${label}`);
  };

  const ctxWith = (prioritized: unknown[]): Ctx => ({
    orgId: "org_legacy_safety",
    userId: "user_legacy_safety",
    role: "admin",
    runId: "run_legacy_safety",
    stepKey: "s6_followup_tasks",
    operationKey: "op_legacy_safety",
    priorEvidence: {
      s5_prioritize: { prioritized, summary: "选出优先客户" },
    },
  });

  // ══ R4：提醒 / 跟进时间不得凭空推算 ══
  console.log("▶ R4 legacy 提醒时间 fail-closed");
  for (const [model, method] of [
    ["salesOpportunity", "findFirst"],
    ["pendingAction", "findFirst"],
    ["pendingAction", "create"],
    ["auditLog", "create"],
    ["agentRun", "findFirst"],
    ["", "$transaction"],
  ] as const) {
    stub(model, method, forbidden(`${model}.${method}`));
  }

  const target = {
    customerId: "cust_a",
    customerName: "甲客户",
    email: "a@example.com",
    opportunityId: "opp_a",
    reasons: SCORING_REASONS,
  };
  for (const tool of [
    "grader_create_followup_task",
    "sales_update_followup",
    "calendar_create_event_draft",
  ]) {
    dbCalls.length = 0;
    const r = await executeRuntimeV2Tool(tool, ctxWith([target]));
    const data = (r.data ?? {}) as Record<string, unknown>;
    ok(
      r.ok === true &&
        data.skipped === true &&
        typeof data.reason === "string" &&
        data.reason.startsWith(`${REMINDER_TIME_REQUIRED}:`),
      `${tool}: 无明确时间 → skipped + ${REMINDER_TIME_REQUIRED}`,
      r,
    );
    ok(
      JSON.stringify(data.missingInputs) === JSON.stringify(["reminder_time"]) &&
        data.targetCount === 1 &&
        typeof data.summary === "string",
      `${tool}: 明示缺 reminder_time 与待安排对象数`,
      data,
    );
    ok(
      r.requiresApproval !== true &&
        r.pendingActionId === undefined &&
        data.pendingActionIds === undefined,
      `${tool}: 不产生 PendingAction / 不进入审批`,
      r,
    );
    ok(
      !("startTime" in data) &&
        !("nextFollowupAt" in data) &&
        !/\d{4}-\d{2}-\d{2}T/.test(JSON.stringify(data)),
      `${tool}: 输出不含任何推算出的时间`,
      data,
    );
    ok(dbCalls.length === 0, `${tool}: 零 DB 访问（不查商机、不建草稿）`, dbCalls);
  }

  // 无目标时沿用既有跳过语义（行为不变）
  {
    const g = await executeRuntimeV2Tool("grader_create_followup_task", ctxWith([]));
    ok(
      (g.data as Record<string, unknown>)?.reason === "无优先客户",
      "grader_create_followup_task: 无优先客户仍为既有跳过原因",
    );
    const s = await executeRuntimeV2Tool(
      "sales_update_followup",
      ctxWith([{ customerId: "cust_b", customerName: "乙客户" }]),
    );
    ok(
      (s.data as Record<string, unknown>)?.reason === "无可改期商机",
      "sales_update_followup: 无商机仍为既有跳过原因",
    );
    const c = await executeRuntimeV2Tool("calendar_create_event_draft", ctxWith([]));
    ok(
      (c.data as Record<string, unknown>)?.reason === "无可安排日历提醒的优先客户",
      "calendar_create_event_draft: 无优先客户仍为既有跳过原因",
    );
  }
  for (const r of restores.splice(0)) r();

  // 源码层：服务器本地时间推算彻底移除
  {
    const src = readFileSync(join(__dirname, "..", "adapters.ts"), "utf8");
    ok(!/\bnextFridayIso\s*\(/.test(src), "adapters.ts 不再定义 / 调用 nextFridayIso");
    ok(
      !/\.(setHours|getHours|getDay|setDate|getDate)\(/.test(src),
      "adapters.ts 不再用服务器本地时区做日期 / 时刻运算",
    );
    const gmailStart = src.indexOf("gmail_create_draft: async");
    const gmailEnd = src.indexOf("calendar_create_event_draft: async");
    const gmailSrc = src.slice(gmailStart, gmailEnd);
    ok(
      gmailStart > 0 &&
        gmailEnd > gmailStart &&
        gmailSrc.includes("neutralFollowupEmailContent(") &&
        !gmailSrc.includes("reasons"),
      "gmail_create_draft 正文只用中性模板，不读 reasons",
    );
  }

  // ══ R5：中性模板纯函数 ══
  console.log("\n▶ R5 中性客户邮件模板");
  {
    const m = neutralFollowupEmailContent(`<img src=x onerror="alert(1)"> & 'Co'`);
    ok(
      m.body.includes(
        "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;Co&#39;，您好：",
      ) && !m.body.includes("<img"),
      "客户名 HTML 转义（< > & \" '）",
      m.body,
    );
    ok(
      m.subject === "跟进我们之前的沟通" && !m.subject.includes("Co"),
      "主题中性，不含客户名",
    );
    const blank = neutralFollowupEmailContent("   ");
    const placeholder = neutralFollowupEmailContent("未知客户");
    ok(
      blank.body.startsWith("<p>您好：</p>") &&
        placeholder.body.startsWith("<p>您好：</p>") &&
        !placeholder.body.includes("未知客户"),
      "缺名 / 内部占位名 → 通用问候，占位名不进客户邮件",
    );
    const plain = neutralFollowupEmailContent("  王女士 ");
    ok(plain.body.startsWith("<p>王女士，您好：</p>"), "正常客户名去首尾空白后问候");
    ok(
      !/[+＋]\d|逾期|风险|评分|分数|优先/.test(plain.body),
      "正文无评分 / 风险 / 优先级措辞",
      plain.body,
    );
  }

  // ══ R5：gmail_create_draft 实际落库 payload（打桩事务，捕获 create data）══
  console.log("\n▶ R5 gmail_create_draft 草稿 payload");
  {
    const prevGmail = process.env.GMAIL_DRAFT_ENABLED;
    process.env.GMAIL_DRAFT_ENABLED = "1";
    const created: Array<Record<string, unknown>> = [];
    const fakeTx = {
      pendingAction: {
        findFirst: async () => null,
        create: async (args: unknown) => {
          const data = (args as { data: Record<string, unknown> }).data;
          created.push(data);
          return {
            id: `pa_${created.length}`,
            type: data.type,
            title: data.title,
            preview: data.preview,
            agentRunId: data.agentRunId ?? null,
          };
        },
      },
    };
    stub("", "$transaction", async (fn) =>
      (fn as (tx: unknown) => Promise<unknown>)(fakeTx),
    );
    stub("auditLog", "create", async () => ({ id: "audit_stub" }));
    stub("agentRun", "findFirst", async () => null);

    const r = await executeRuntimeV2Tool(
      "gmail_create_draft",
      ctxWith([
        {
          customerId: "cust_x",
          customerName: `<b>恶意</b> & "Co"`,
          email: "x@example.com",
          opportunityId: "opp_x",
          reasons: SCORING_REASONS,
        },
        {
          customerId: "cust_y",
          email: "y@example.com",
          reasons: ["高风险报价(+25)"],
        },
      ]),
    );
    ok(
      r.ok === true && r.requiresApproval === true && created.length === 2,
      "gmail_create_draft: 两封草稿进入审批（行为保持）",
      { r, created: created.length },
    );
    const payloads = created.map(
      (d) => d.payload as { to: string; subject: string; body: string },
    );
    const leaked = payloads.filter((p) =>
      [...SCORING_REASONS, "高风险报价(+25)", "(+", "逾期"].some(
        (s) => p.body.includes(s) || p.subject.includes(s),
      ),
    );
    ok(leaked.length === 0, "草稿正文 / 主题不含任何内部评分理由", payloads);
    ok(
      payloads[0]?.to === "x@example.com" &&
        payloads[0].body.includes("&lt;b&gt;恶意&lt;/b&gt; &amp; &quot;Co&quot;") &&
        !payloads[0].body.includes("<b>"),
      "草稿正文客户名已转义",
      payloads[0],
    );
    ok(
      payloads[1]?.to === "y@example.com" &&
        payloads[1].body.startsWith("<p>您好：</p>") &&
        !payloads[1].body.includes("未知客户"),
      "缺名客户草稿用通用问候",
      payloads[1],
    );
    for (const r of restores.splice(0)) r();
    if (prevGmail === undefined) delete process.env.GMAIL_DRAFT_ENABLED;
    else process.env.GMAIL_DRAFT_ENABLED = prevGmail;
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
