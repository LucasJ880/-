/**
 * FIX-14 其它文字抽取入口入库前清理 U+0000 / 落单代理字符——真实 DB（隔离库）
 *
 * 五个入口各走一遍真实写库：询价回信（defaultInboundSyncDeps，只换掉 Gmail 与模型）、
 * 采购记录附件、AI 对话附件与对话标题、产品资料录入、报价成本表导入。
 * PDF / xlsx 在测试里现拼（不入库任何客户文件）；文件走本地文件存储；不发邮件、不调真实模型。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/files/__tests__/extracted-text-other-paths-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 供应商 / 文件）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-14 其它入口入库 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FIX-14 extracted-text other paths DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

const NUL = "\u0000";
const FFFD = String.fromCharCode(0xfffd);
/** 落单的 UTF-16 代理字符（高位后面不是低位，或低位前面不是高位） */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const unstorable = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? null);
  return s.includes(NUL) || s.includes("\\u0000") || LONE_SURROGATE.test(s) || /\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i.test(s);
};
/** 审计的前后数据按 JSON 字符串存 */
const parseJson = (v: unknown): Record<string, unknown> => (typeof v === "string" ? JSON.parse(v) : ((v ?? {}) as Record<string, unknown>));
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).replace(/\s+/g, " ").slice(-300);

async function main() {
  const { db } = await import("@/lib/db");
  const { LINE_A, LINE_B, buildCheckboxPdf, buildPdf } = await import("@/lib/tender-auto-analysis/__tests__/fixtures/nul-pdf");
  const XLSX = await import("xlsx");
  const buildXlsx = (sheets: Array<{ name: string; rows: unknown[][] }>): Buffer => {
    const wb = XLSX.utils.book_new();
    for (const sh of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.rows), sh.name);
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  };
  const { defaultInboundSyncDeps, syncOrgInbound } = await import("@/lib/tender-rfq/inbound-sync");
  const { parseInboundQuote } = await import("@/lib/tender-rfq/inbound-parse");
  const { INBOUND_CONTRACT_VERSION } = await import("@/lib/tender-rfq/inbound-contract");

  console.log("FIX-14 extracted-text other paths — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `f14owner_${stamp}`, ORG = `f14org_${stamp}`;
  const MAILBOX = `rfq-${stamp}@fixture.test`;
  const projectIds: string[] = [];

  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "fix14-blobs-"));
  process.env.PRODUCT_CONTENT_LOCAL_STORE = "1";
  process.env.PRODUCT_CONTENT_LOCAL_STORE_DIR = storeDir;

  const reqIds: string[] = [];
  const attIds: string[] = [];
  async function section(name: string, fn: () => Promise<void>) {
    console.log(`\n— ${name} —`);
    try {
      await fn();
    } catch (e) {
      fail++;
      console.error(`  ✗ ${name}：中途抛错`, errText(e));
    }
  }

  let seq = 0;
  async function mkProject(): Promise<string> {
    seq += 1;
    const id = `f14proj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", status: "active" } });
    return id;
  }

  try {
    await db.user.create({ data: { id: OWNER, email: `${OWNER}@fixture.test`, name: "Fixture Owner", role: "user" } });
    await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `f14-${stamp}`, ownerId: OWNER, settingsJson: { tenderRfq: { mailboxEmail: MAILBOX } } } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });

    /* ============================ 1. 询价回信 ============================ */
    await section("询价回信", async () => {
      const P = await mkProject();
      const supplier = await db.supplier.create({ data: { orgId: ORG, name: `Fixture Flag Supplier ${stamp}`, createdById: OWNER } });
      const inquiry = await db.projectInquiry.create({ data: { projectId: P, createdById: OWNER, status: "in_progress", roundNumber: 1 } });
      const THREAD = `t_${stamp}`, MSG = `m_${stamp}`;
      const item = await db.inquiryItem.create({ data: { inquiryId: inquiry.id, supplierId: supplier.id, status: "sent", sentAt: new Date(), contactNotes: `Gmail messageId=m0_${stamp} threadId=${THREAD} · ${new Date().toISOString()}`, createdById: OWNER } });

      // 同一行「Unit price CAD 12.50 per flag」+ 一个被抽成 U+0000 的字形 +「Delivery 30 days」
      const pdf = buildPdf([
        "BT /F1 12 Tf 72 720 Td (Unit price CAD 12.50 per flag) Tj ET\nBT /F2 12 Tf 250 720 Td <0000> Tj ET\nBT /F1 12 Tf 262 720 Td ( Delivery 30 days) Tj ET\nBT /F1 12 Tf 72 690 Td (Fixture attachment closing sentence for audit check.) Tj ET",
      ]);
      const BODY = "Thank you for the opportunity, please see the attached quotation.";
      // 原样照抄它收到的那一行的假模型
      const prompts: string[] = [];
      const complete = async (opts: { userPrompt: string }) => {
        prompts.push(opts.userPrompt);
        const s = opts.userPrompt.indexOf("\n---\n");
        const line = opts.userPrompt.slice(s + 5).split("\n").find((l) => l.includes("Unit price")) ?? "";
        const evidence = line.trim().slice(0, 200);
        return JSON.stringify({
          contractVersion: INBOUND_CONTRACT_VERSION, isQuote: true, declined: false, currency: "CAD",
          prices: [{ quantity: null, unitPrice: 12.5, totalPrice: null, evidence }],
          deliveryDays: 30, deliveryEvidence: evidence, validUntil: null, validUntilEvidence: null, moq: null,
          incoterm: null, incotermEvidence: null, mandatoryAnswers: [], missingFields: [], attachmentsSeen: [],
        });
      };
      const real = await defaultInboundSyncDeps();
      const ref = { messageId: MSG, threadId: THREAD };
      const deps = {
        ...real,
        findMailbox: async () => ({ userId: OWNER, grantedScopes: "https://www.googleapis.com/auth/gmail.readonly" }),
        hasReadScope: () => true,
        listReplies: async () => ({ messages: [ref], historyId: `h_${stamp}`, expired: false }),
        listThreadMessages: async () => [ref],
        getMessage: async () => ({ messageId: MSG, threadId: THREAD, labelIds: ["INBOX"], date: new Date(), from: "Fixture Supplier <quotes@supplier.fixture.test>", bodyText: BODY, attachments: [{ filename: "q.pdf", mimeType: "application/pdf", data: pdf }] }),
        parse: (input: Parameters<typeof parseInboundQuote>[0]) => parseInboundQuote(input, { complete }),
      };
      const row = { id: item.id, inquiryId: inquiry.id, projectId: P, ownerId: OWNER, threadId: THREAD, status: "sent", unitPrice: null, totalPrice: null, currency: "CAD", deliveryDays: null, validUntil: null, quoteNotes: null };
      const notiBefore = await db.notification.findMany({ where: { projectId: P }, select: { id: true } });
      const r1 = await syncOrgInbound({ orgId: ORG, settingsJson: { tenderRfq: { mailboxEmail: MAILBOX } }, items: [row] }, deps);
      const after = await db.inquiryItem.findUniqueOrThrow({ where: { id: item.id }, select: { status: true, unitPrice: true, deliveryDays: true, quoteNotes: true } });
      const audits = await db.auditLog.findMany({ where: { targetType: "rfq_inbound_message", targetId: MSG }, select: { action: true, afterData: true } });
      const failedAudit = audits.find((a) => a.action === "rfq_inbound:failed");
      ok(r1.quoted === 1 && r1.failed === 0, "照抄勾选框那一行的回信：这次入站检查报价 1 家、失败 0", { r1, failedError: failedAudit ? parseJson(failedAudit.afterData).error : null });
      ok(after.status === "quoted" && Number(after.unitPrice) === 12.5 && after.deliveryDays === 30, "询价条目变为「已报价」，单价 12.5 与交期 30 天写入（改动前条目停在「已回复」）", after);
      ok(!!after.quoteNotes && !unstorable(after.quoteNotes) && after.quoteNotes.includes("附件：q.pdf 已解析（有 1 处无法识别的符号，可能是勾选框或无法识别的字形，请对照原件核对）"),
        "报价备注入库、不含 U+0000，附件一栏注明有 1 处无法识别的符号", after.quoteNotes);
      ok(!failedAudit && audits.length === 1 && audits[0].action === "rfq_inbound:applied", "没有「解析失败」审计，只有一条入表审计", audits.map((a) => a.action));
      const auditData = audits[0] ? JSON.stringify(parseJson(audits[0].afterData)) : "";
      ok(!auditData.includes("Thank you for the opportunity") && !auditData.includes("closing sentence for audit check") && auditData.includes('"nulCount":1'),
        "这封回信的审计只有结构化字段与证据片段（没有邮件正文与附件全文），附件多一个符号个数", auditData.slice(0, 600));
      const newNoti = await db.notification.findMany({ where: { projectId: P, id: { notIn: notiBefore.map((n) => n.id) } }, select: { title: true, summary: true } });
      const notiText = JSON.stringify(newNoti);
      ok(!newNoti.some((n) => n.title.includes("解析失败")), "没有「有一封供应商回信解析失败，请手工录入」通知", newNoti);
      ok(newNoti.some((n) => n.title.includes("报价了")) && !/Unit price|Delivery 30|per flag|Thank you|closing sentence|无法识别的符号/.test(notiText),
        "照常发出「报价了」通知；这次新增的通知标题与摘要里没有附件文字、证据片段与那句提示", newNoti);
      ok(prompts.length === 1 && !unstorable(prompts[0]), "送进模型的提示里没有 U+0000", prompts[0]?.slice(0, 300));
      const r2 = await syncOrgInbound({ orgId: ORG, settingsJson: { tenderRfq: { mailboxEmail: MAILBOX } }, items: [{ ...row, status: "quoted" }] }, deps);
      const after2 = await db.inquiryItem.findUniqueOrThrow({ where: { id: item.id }, select: { quoteNotes: true } });
      ok(r2.duplicates === 1 && r2.quoted === 0 && after2.quoteNotes === after.quoteNotes && prompts.length === 1, "同一封回信再跑一次入站检查：按已处理跳过，不重复处理", r2);
    });

    /* ============================ 2. 采购记录附件 ============================ */
    await section("采购记录附件", async () => {
      process.env.PROCUREMENT_RECORDS_SCHEMA_READY = "1";
      const { saveAttachment, processAttachment } = await import("@/lib/procurement-records/attachments");
      const req = await db.recordsRequest.create({ data: { orgId: ORG, title: "Fixture disclosure request", jurisdiction: "FEDERAL", pathType: "NEW_FORMAL_REQUEST", channel: "ATIP_ONLINE", createdById: OWNER } });
      reqIds.push(req.id);
      const files = new Map<string, Buffer>();
      const readBuffer = async (pathname: string) => files.get(pathname) ?? null;
      async function upload(filename: string, buffer: Buffer) {
        const r = await saveAttachment({ requestId: req.id, userId: OWNER, kind: "DISCLOSURE_FILE", filename, buffer });
        if (!r.ok) throw new Error(`上传失败 ${r.code}`);
        attIds.push(r.attachmentId);
        const row = await db.recordsAttachment.findUniqueOrThrow({ where: { id: r.attachmentId }, select: { storagePathname: true } });
        files.set(row.storagePathname, buffer);
        let error: string | null = null;
        try {
          await processAttachment(r.attachmentId, { readBuffer });
        } catch (e) {
          error = errText(e);
        }
        const att = await db.recordsAttachment.findUniqueOrThrow({ where: { id: r.attachmentId }, select: { parseStatus: true, parseError: true, sheetRangesJson: true } });
        const units = await db.recordsAttachmentUnit.findMany({ where: { attachmentId: r.attachmentId }, orderBy: { unitIndex: "asc" }, select: { unitIndex: true, unitLabel: true, text: true, parseStatus: true } });
        const lines = await db.procurementLineItem.findMany({ where: { attachmentId: r.attachmentId }, select: { productDescription: true, rawSnippet: true, reviewStatus: true, sourceSheet: true } });
        return { error, att, units, lines };
      }

      // (a) 勾选框被抽成 U+0000 的披露文件
      const a = await upload("disclosure-checkbox.pdf", buildCheckboxPdf());
      ok(a.error === null && a.att.parseStatus === "PARSED", "勾选框式 PDF：解析不报错，附件状态为「已解析」（改动前写解析单元报 22021，附件停在「解析中」）", { error: a.error, status: a.att.parseStatus });
      ok(a.units.length === 2 && a.units[1].text === `${LINE_A}\n  ${LINE_B}` && a.units[0].parseStatus === "OCR_REQUIRED", "该页入库文字为「…check the box.\\n  The Bidder declares…」；只有 U+0000 的第 1 页标为需要 OCR", a.units);

      // (b) xlsx 单元格里的 U+0000（工作表名也带一个）
      const b = await upload("disclosure-cells.xlsx", buildXlsx([{ name: `Orders${NUL}2024`, rows: [["Description", "Qty", "Order Value"], [`Flag${NUL} nylon`, 2, 20]] }]));
      ok(b.error === null && b.att.parseStatus === "PARSED", "xlsx 单元格「Flag\\u0000 nylon」：附件状态为「已解析」", { error: b.error, status: b.att.parseStatus });
      ok(b.units[0]?.text.includes("Flag  nylon") && b.units[0]?.unitLabel === "Orders 2024 · 2 行" && JSON.stringify((b.att.sheetRangesJson as Array<{ sheet: string; rows: number }> | null)?.map((x) => [x.sheet, x.rows])) === JSON.stringify([["Orders 2024", 2]]),
        "该工作表的单元文字里这一格为「Flag  nylon」，单元标签与工作表范围里的工作表名该处为空格", { units: b.units, sheets: b.att.sheetRangesJson });
      ok(b.lines.length === 1 && b.lines[0].productDescription === "Flag  nylon" && b.lines[0].sourceSheet === "Orders 2024", "抽出的明细入库，产品描述与工作表名不含 U+0000", b.lines);

      // (c) 一行明细拼起来超过 1000 字，第 1000 字处劈开表情符号
      const longDesc = `${"a".repeat(999)}😀 nylon flag 3x5`;
      const analysesBefore = await db.procurementAnalysis.count({ where: { requestId: req.id } });
      const c = await upload("disclosure-long.xlsx", buildXlsx([{ name: "Orders", rows: [["Description", "Qty", "Order Value"], [longDesc, 2, 20]] }]));
      const analysesAfter = await db.procurementAnalysis.count({ where: { requestId: req.id } });
      ok(c.error === null && c.att.parseStatus === "PARSED" && c.lines.length === 1, "第 1000 字处劈开表情符号的明细入库（改动前附件「已解析」、明细为零，写库报 InvalidArg）", { error: c.error, status: c.att.parseStatus, lines: c.lines.length });
      ok(c.lines[0]?.rawSnippet.length === 1000 && c.lines[0]?.rawSnippet.endsWith(`a${FFFD}`) && c.lines[0]?.reviewStatus === "NEEDS_REVIEW" && c.lines[0]?.productDescription === longDesc,
        "原文片段为前 1000 字、以 U+FFFD 结尾，状态为待复核；产品描述（没截断）里成对的表情符号原样", c.lines[0] ? { len: c.lines[0].rawSnippet.length, tail: JSON.stringify(c.lines[0].rawSnippet.slice(-2)), review: c.lines[0].reviewStatus } : null);
      ok(analysesAfter === analysesBefore + 1, "申请的按口径分析照常运行（多一个分析版本；改动前没有运行）", { analysesBefore, analysesAfter });
    });

    /* ============================ 3. AI 对话附件、对话标题与市场调研 ============================ */
    await section("AI 对话附件、对话标题与市场调研", async () => {
      const core = await import("@/lib/chat-attachments/core");
      // 改动前没有这个函数（路由里直接 slice）；拿不到时按改动前的写法算，好在改动前的代码上看到写库失败
      const titleOf: (source: string, maxChars: number) => string =
        typeof (core as Record<string, unknown>).storableTitle === "function"
          ? (core as unknown as { storableTitle: (s: string, n: number) => string }).storableTitle
          : (source, maxChars) => source.slice(0, maxChars);
      const tryWrite = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
          return null;
        } catch (e) {
          return errText(e);
        }
      };
      const stored = async (id: string) => core.readStoredAttachments((await db.aiMessage.findUniqueOrThrow({ where: { id }, select: { attachments: true } })).attachments);

      // 主助手 / 项目「问青砚」：AiMessage.attachments 与 AiThread.title
      const thread = await db.aiThread.create({ data: { userId: OWNER, orgId: ORG, title: "新对话" } });
      const parsed = core.parseAttachmentsInput([{ name: "checkbox.pdf", kind: "document", size: 2048, text: `${LINE_A}\n${NUL} ${LINE_B}` }]);
      let msgId = "";
      const e1 = await tryWrite(async () => {
        msgId = (await db.aiMessage.create({ data: { threadId: thread.id, role: "user", content: "帮我看看这份声明", attachments: (parsed.ok ? parsed.attachments : []) as unknown as object } })).id;
      });
      ok(e1 === null && (await stored(msgId))[0]?.text === `${LINE_A}\n  ${LINE_B}`, "文档附件正文带 U+0000：消息存下，存下的附件正文里该处为空格（改动前写消息报 22P05，接口 500）", e1);

      const legacy = core.attachmentsFromLegacyFile("legacy file body", `${"n".repeat(199)}😀.pdf`);
      let legacyId = "";
      const e2 = await tryWrite(async () => {
        legacyId = (await db.aiMessage.create({ data: { threadId: thread.id, role: "user", content: "", attachments: legacy as unknown as object } })).id;
      });
      const legacyStored = e2 === null ? await stored(legacyId) : [];
      ok(e2 === null && legacyStored[0]?.name.length === 200 && legacyStored[0].name.endsWith(`n${FFFD}`), "旧客户端的文件名在第 200 字处劈开表情符号：消息存下，文件名为前 200 字、以 U+FFFD 结尾（改动前 InvalidArg）", e2);

      const only = core.parseAttachmentsInput([{ name: `${"报".repeat(56)}😀价.pdf`, size: 3, text: "附件正文" }]);
      const titleSource = core.attachmentsTitleSource("", only.ok ? only.attachments : []);
      const e3 = await tryWrite(() => db.aiThread.update({ where: { id: thread.id }, data: { title: titleOf(titleSource, 60) } }));
      const t3 = (await db.aiThread.findUniqueOrThrow({ where: { id: thread.id }, select: { title: true } })).title;
      ok(e3 === null && t3.length === 60 && t3.startsWith("附件：") && t3.endsWith(`报${FFFD}`), "只发附件、「附件：〈文件名〉」第 60 字处劈开表情符号：标题写入成功，为前 60 字、以 U+FFFD 结尾（改动前 InvalidArg，这一轮对话报错）", { e3, title: JSON.stringify(t3.slice(-3)) });

      // 外贸对话：TradeChatMessage.attachments 与 TradeChatSession.title
      const session = await db.tradeChatSession.create({ data: { orgId: ORG, userId: OWNER } });
      const e4 = await tryWrite(() => db.tradeChatMessage.create({ data: { sessionId: session.id, role: "user", content: "看看附件", attachments: (parsed.ok ? parsed.attachments : []) as unknown as object } }));
      ok(e4 === null, "外贸对话：带 U+0000 的文档附件消息存下（改动前 22P05）", e4);
      const content = `${"外".repeat(29)}😀贸对话第一条消息`;
      const e5 = await tryWrite(() => db.tradeChatSession.update({ where: { id: session.id }, data: { title: titleOf(content, 30) + (content.length > 30 ? "..." : "") } }));
      const t5 = (await db.tradeChatSession.findUniqueOrThrow({ where: { id: session.id }, select: { title: true } })).title;
      ok(e5 === null && t5 === `${"外".repeat(29)}${FFFD}...`, "外贸对话第一条消息第 30 字处劈开表情符号：标题写入为前 30 字（最后一个为 U+FFFD）加「...」（改动前 InvalidArg，消息与回复已存下、接口仍返回 500）", { e5, title: JSON.stringify(t5.slice(-5)) });

      // 转为后台市场调研：市场证据在 2 万字处劈开表情符号
      const { queueMarketResearchRequest } = await import("@/lib/market-intelligence/research-runtime");
      const evidence = `${"e".repeat(19_999)}😀 tail of the uploaded file`;
      let run: { status: string; inputJson: unknown } | null = null;
      const e6 = await tryWrite(async () => {
        run = await queueMarketResearchRequest({ orgId: ORG, userId: OWNER, objective: "Fixture market research objective", marketEvidence: evidence });
      });
      const me = run ? String(((run as { inputJson: unknown }).inputJson as Record<string, unknown>).marketEvidence ?? "") : "";
      ok(e6 === null && (run as { status: string } | null)?.status === "queued" && me.length === 20_000 && me.endsWith(`e${FFFD}`), "市场证据截断处劈开表情符号：调研任务建成（等待研究），市场证据以 U+FFFD 结尾（改动前写库被拒，接口 500）", { e6, status: (run as { status: string } | null)?.status, tail: JSON.stringify(me.slice(-3)) });
    });

    /* ============================ 4. 产品资料录入 ============================ */
    await section("产品资料录入", async () => {
      const { putPrivateBlob } = await import("@/lib/files/blob-access");
      const { analyzeJobInputs } = await import("@/lib/product-content/intake/analyze");
      const job = await db.productContentJob.create({ data: { orgId: ORG, title: "Fixture flag spec sheet", createdById: OWNER } });
      const pdf = buildPdf(["BT /F2 12 Tf 72 720 Td <0000> Tj ET\nBT /F1 12 Tf 84 720 Td ( Color: Red) Tj ET\nBT /F1 12 Tf 72 690 Td (Material: Polyester) Tj ET"]);
      const pathname = `product-content/${ORG}/${job.id}/spec.pdf`;
      await putPrivateBlob({ pathname, body: pdf, contentType: "application/pdf" });
      await db.productContentJobInput.create({ data: { orgId: ORG, jobId: job.id, inputType: "pdf", blobPathname: pathname, mimeType: "application/pdf", fileName: "spec.pdf", createdById: OWNER } });
      let error: string | null = null;
      try {
        await analyzeJobInputs(ORG, job.id, OWNER);
      } catch (e) {
        error = errText(e);
      }
      const facts = await db.productFact.findMany({ where: { jobId: job.id }, select: { fieldKey: true, value: true, normalizedValue: true, sourceLocation: true } });
      const color = facts.find((f) => f.fieldKey === "color");
      const step = await db.productContentStep.findFirst({ where: { jobId: job.id, stepKey: "analyze_inputs" }, select: { status: true } });
      const after = await db.productContentJob.findUniqueOrThrow({ where: { id: job.id }, select: { status: true } });
      ok(error === null && color?.value === "Red" && color?.sourceLocation === "Color: Red", "规格表一行「\\u0000 Color: Red」：抽出事实 color = Red，原文行为「Color: Red」（改动前写事实失败）", { error, color });
      ok(facts.length >= 2 && facts.every((f) => !unstorable(f.value) && !unstorable(f.normalizedValue) && !unstorable(f.sourceLocation ?? "")), "抽出的每条事实的值、规范值与原文行都不含 U+0000", facts);
      ok(step?.status === "done" && (after.status === "NEEDS_INPUT" || after.status === "PLAN_READY"), "「分析输入」这一步完成，任务状态按缺字段照常变为 NEEDS_INPUT / PLAN_READY（改动前这一步停在进行中）", { step: step?.status, job: after.status });
    });

    /* ============================ 5. 报价成本表导入 ============================ */
    await section("报价成本表导入", async () => {
      const { createImportFromUpload } = await import("@/lib/quote-engine/import/import-service");
      const P = await mkProject();
      const quote = await db.projectQuote.create({ data: { projectId: P, orgId: ORG, createdById: OWNER, status: "draft" } });
      const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const upload = (filename: string, buffer: Buffer) =>
        createImportFromUpload({ orgId: ORG, projectId: P, quoteId: quote.id, userId: OWNER, file: { buffer, filename, safeName: filename, ext: "xlsx", mime: XLSX_MIME, size: buffer.length }, supplierCurrency: "CAD", ai: { enabled: false } });
      type Row = { sourceDescription: string; evidence: { snippet: string; sheet: string | null; pageNumber: number | null; unitLabel: string | null } };
      const rowsOf = (v: unknown) => ((v as { rows?: Row[] } | null)?.rows ?? []);
      const HEAD = ["Description", "Qty", "Unit", "Unit Cost (CAD)", "Total"];

      // (a) 说明格「Flag\u0000 nylon 3x5」
      const a = await upload("costs-nul.xlsx", buildXlsx([{ name: "Costs", rows: [HEAD, [`Flag${NUL} nylon 3x5`, 100, "pcs", 12.5, 1250]] }]));
      const aRows = rowsOf(a.record.reviewJson);
      ok(a.record.status === "REVIEW_REQUIRED" && aRows[0]?.sourceDescription === "Flag  nylon 3x5" && rowsOf(a.record.extractedJson)[0]?.evidence.snippet.startsWith("Flag  nylon 3x5"),
        "导入 xlsx、说明格「Flag\\u0000 nylon 3x5」：状态为「待审核」，该行说明为「Flag  nylon 3x5」（改动前写导入记录报 22P05，显示「抽取失败：…」）", { status: a.record.status, errorMessage: a.record.errorMessage, row: aRows[0]?.sourceDescription });

      // (b) 说明超过 300 字、第 300 字处劈开表情符号
      const b = await upload("costs-long.xlsx", buildXlsx([{ name: "Costs", rows: [HEAD, [`${"d".repeat(299)}😀 nylon flag with grommets`, 1, "lot", 300, 300]] }]));
      const bRow = rowsOf(b.record.reviewJson)[0];
      ok(b.record.status === "REVIEW_REQUIRED" && bRow?.sourceDescription.length === 300 && bRow.sourceDescription.endsWith(`d${FFFD}`) && bRow.evidence.snippet.endsWith(`d${FFFD}`),
        "说明第 300 字处劈开表情符号：状态为「待审核」，入库的说明与原文片段以 U+FFFD 结尾（改动前 InvalidArg，导入失败）", { status: b.record.status, errorMessage: b.record.errorMessage, tail: bRow ? JSON.stringify(bRow.sourceDescription.slice(-3)) : null });

      // (c) 工作表名带 U+0000：仍对上可引用单元
      const c = await upload("costs-sheet.xlsx", buildXlsx([{ name: `Cost${NUL}s`, rows: [HEAD, ["Nylon flag 3x5", 10, "pcs", 12.5, 125]] }]));
      const cRow = rowsOf(c.record.reviewJson)[0];
      ok(c.record.status === "REVIEW_REQUIRED" && cRow?.evidence.sheet === "Cost s" && cRow.evidence.pageNumber != null && (cRow.evidence.unitLabel ?? "").startsWith("Sheet「Cost s」"),
        "工作表名带 U+0000：该表的行照常带上可引用单元的页号与标签（与项目文件解析清理后的单元标签对得上）", { status: c.record.status, errorMessage: c.record.errorMessage, evidence: cRow?.evidence });
      for (const [label, r] of [["a", a], ["b", b], ["c", c]] as const) {
        ok(r.record.status === "REVIEW_REQUIRED" && !unstorable(r.record.extractedJson) && !unstorable(r.record.reviewJson) && !unstorable(r.record.metadataJson) && !unstorable(r.record.supplierName ?? ""), `导入 ${label}：入库的抽取结果、复核数据、元数据与供应商名不含 U+0000 与落单代理字符`);
      }
    });
  } catch (e) {
    fail++;
    console.error("  ✗ 测试中途抛错", errText(e));
  } finally {
    const { db: d } = await import("@/lib/db");
    await new Promise((r) => setTimeout(r, 300));
    await d.procurementLineItem.deleteMany({ where: { requestId: { in: reqIds } } });
    await d.procurementAnalysis.deleteMany({ where: { requestId: { in: reqIds } } });
    await d.recordsAttachmentUnit.deleteMany({ where: { attachmentId: { in: attIds } } });
    await d.recordsAttachment.deleteMany({ where: { requestId: { in: reqIds } } });
    await d.recordsRequestEvent.deleteMany({ where: { requestId: { in: reqIds } } });
    await d.recordsRequestVersion.deleteMany({ where: { requestId: { in: reqIds } } });
    await d.recordsRequest.deleteMany({ where: { id: { in: reqIds } } });
    await d.task.deleteMany({ where: { OR: [{ sourceId: { in: reqIds } }, { projectId: { in: projectIds } }] } });
    await d.aiThread.deleteMany({ where: { userId: OWNER } });
    await d.tradeChatSession.deleteMany({ where: { userId: OWNER } });
    await d.marketResearchRun.deleteMany({ where: { orgId: ORG } });
    await d.agentSkill.deleteMany({ where: { orgId: ORG } });
    await d.productContentJob.deleteMany({ where: { orgId: ORG } });
    await d.quoteCostImport.deleteMany({ where: { orgId: ORG } });
    await d.projectDocumentPage.deleteMany({ where: { document: { projectId: { in: projectIds } } } });
    await d.projectDocument.deleteMany({ where: { projectId: { in: projectIds } } });
    await d.projectQuote.deleteMany({ where: { projectId: { in: projectIds } } });
    await d.notification.deleteMany({ where: { OR: [{ projectId: { in: projectIds } }, { orgId: ORG }] } });
    await d.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: projectIds } } } });
    await d.projectInquiry.deleteMany({ where: { projectId: { in: projectIds } } });
    await d.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { projectId: { in: projectIds } }] } });
    await d.project.deleteMany({ where: { id: { in: projectIds } } });
    await d.supplier.deleteMany({ where: { orgId: ORG } });
    await d.organizationMember.deleteMany({ where: { orgId: ORG } });
    await d.organization.deleteMany({ where: { id: ORG } });
    await d.user.deleteMany({ where: { id: OWNER } });
    fs.rmSync(storeDir, { recursive: true, force: true });
    await d.$disconnect();
  }

  console.log(`\nFIX-14 extracted-text other paths DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
