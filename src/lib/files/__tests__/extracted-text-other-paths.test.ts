/**
 * FIX-14 其它文字抽取入口入库前清理 U+0000 / 落单代理字符（不用数据库）
 *
 * 运行：env -u DATABASE_URL -u DIRECT_URL npx tsx src/lib/files/__tests__/extracted-text-other-paths.test.ts
 *
 * 夹具全部现拼：PDF 用 FIX-13 的 buildPdf（Identity-H、没有 ToUnicode 的字形被 unpdf 抽成 U+0000），
 * xlsx 用 SheetJS 现写（单元格里的 _x0000_ 读回来就是 U+0000），表情符号劈开的场景用字符串现拼。
 * 不连数据库、不调真实模型；询价回信用两个假模型（勾选框处写空格 / 原样照抄收到的那一行）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { LINE_A, LINE_B, buildCheckboxPdf, buildPdf } from "@/lib/tender-auto-analysis/__tests__/fixtures/nul-pdf";
import { hasUnstorableChars } from "../extracted-text";
import { INBOUND_CONTRACT_VERSION, type InboundQuote } from "@/lib/tender-rfq/inbound-contract";
import { buildInboundText, parseInboundQuote, type ParseCompleteFn, type ParsedQuote } from "@/lib/tender-rfq/inbound-parse";
import { planInquiryItemUpdate, type ExistingInquiryItem } from "@/lib/tender-rfq/inbound-apply";
import { parseAutoNotes } from "@/lib/tender-rfq/notes-parse";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

const NUL = "\u0000";
const ROOT = join(__dirname, "..", "..", "..", "..");
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");

/** SheetJS 现写一份 xlsx（单元格里的 U+0000 写出去是 _x0000_，读回来还是 U+0000） */
export function buildXlsx(sheets: Array<{ name: string; rows: unknown[][] }>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const sh of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.rows), sh.name);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
const FFFD = String.fromCharCode(0xfffd);
const HIGH = "\uD83D"; // 😀 的高位代理
const EMAIL_DATE = new Date("2026-11-20T09:00:00Z");
const NOW = new Date("2026-11-20T10:00:00Z");
const CHECKBOX_NOTE = "（有 1 处无法识别的符号，可能是勾选框或无法识别的字形，请对照原件核对）";

/** 同一行「Unit price CAD 12.50 per flag」+ 一个被抽成 U+0000 的字形 +「Delivery 30 days」 */
export function buildPriceLinePdf(): Buffer {
  return buildPdf([
    "BT /F1 12 Tf 72 720 Td (Unit price CAD 12.50 per flag) Tj ET\nBT /F2 12 Tf 250 720 Td <0000> Tj ET\nBT /F1 12 Tf 262 720 Td ( Delivery 30 days) Tj ET",
  ]);
}

const sentItem: ExistingInquiryItem = { status: "sent", unitPrice: null, totalPrice: null, currency: "CAD", deliveryDays: null, validUntil: null, quoteNotes: null };

function modelJson(partial: Partial<InboundQuote>): string {
  return JSON.stringify({
    contractVersion: INBOUND_CONTRACT_VERSION, isQuote: false, declined: false, currency: null, prices: [],
    deliveryDays: null, deliveryEvidence: null, validUntil: null, validUntilEvidence: null, moq: null,
    incoterm: null, incotermEvidence: null, mandatoryAnswers: [], missingFields: [], attachmentsSeen: [], ...partial,
  });
}

/** 送进模型的回信纯文本（buildUserPrompt 里两行 --- 之间） */
function promptText(userPrompt: string): string {
  const start = userPrompt.indexOf("\n---\n");
  const end = userPrompt.lastIndexOf("\n---");
  return start >= 0 && end > start ? userPrompt.slice(start + 5, end) : "";
}

/** 假模型：记下收到的提示，按 build 给出输出 */
function fakeModel(build: (userPrompt: string) => Partial<InboundQuote>) {
  const prompts: Array<{ systemPrompt: string; userPrompt: string }> = [];
  const complete: ParseCompleteFn = async (opts) => {
    prompts.push({ systemPrompt: opts.systemPrompt, userPrompt: opts.userPrompt });
    return modelJson(build(opts.userPrompt));
  };
  return { complete, prompts };
}

/** 勾选框处写成空格的模型（真实模型最可能这样） */
const spacedModel = () => fakeModel(() => ({
  isQuote: true, currency: "CAD",
  prices: [{ quantity: null, unitPrice: 12.5, totalPrice: null, evidence: "Unit price CAD 12.50 per flag Delivery 30 days" }],
  deliveryDays: 30, deliveryEvidence: "Delivery 30 days",
}));

/** 原样照抄它收到的那一行的模型 */
export function copyingModel() {
  return fakeModel((userPrompt) => {
    const line = promptText(userPrompt).split("\n").find((l) => l.includes("Unit price")) ?? "";
    const evidence = line.trim().slice(0, 200);
    return {
      isQuote: true, currency: "CAD",
      prices: [{ quantity: null, unitPrice: 12.5, totalPrice: null, evidence }],
      deliveryDays: 30, deliveryEvidence: evidence,
    };
  });
}

const parseWith = (bodyText: string, complete: ParseCompleteFn, attachments: Parameters<typeof parseInboundQuote>[0]["attachments"] = []) =>
  parseInboundQuote({ bodyText, attachments, emailDate: EMAIL_DATE, mandatoryCodes: [] }, { complete });

const plan = (parsed: ParsedQuote & { attachmentNotes?: string[] }) =>
  planInquiryItemUpdate(sentItem, parsed, null, EMAIL_DATE, { messageId: "m-fix14", now: NOW, attachmentNotes: parsed.attachmentNotes });

async function inquirySection() {
  console.log("\n— 询价回信 —");
  const pdf = buildPriceLinePdf();
  const att = [{ filename: "q.pdf", mimeType: "application/pdf", data: pdf }];

  // 1. 模型在勾选框处写空格：价格证据通过核对
  {
    const m = spacedModel();
    const parsed = await parseWith("Please see the attached quotation.", m.complete, att);
    ok(parsed.prices.length === 1 && parsed.prices[0].unitPrice === 12.5 && !parsed.rejected.some((r) => r.field === "prices[0]"),
      "跨过勾选框的价格证据（勾选框处写空格）通过核对，单价 12.5 不被作废", { prices: parsed.prices, rejected: parsed.rejected });
    ok(parsed.deliveryDays === 30, "同一行的交期 30 天照常通过", parsed.deliveryDays);
    const p = plan(parsed);
    ok(p.data.unitPrice === 12.5 && p.transition === "quoted", "写入计划：单价 12.5、条目变为已报价", p);
  }

  // 2. 模型原样照抄它收到的那一行
  {
    const m = copyingModel();
    const parsed = await parseWith("Please see the attached quotation.", m.complete, att);
    const userPrompt = m.prompts[0]?.userPrompt ?? "";
    ok(!!userPrompt && !userPrompt.includes(NUL) && !hasUnstorableChars(userPrompt) && !hasUnstorableChars(m.prompts[0].systemPrompt),
      "送进模型的整段提示里没有 U+0000 与落单代理字符", JSON.stringify(userPrompt.slice(0, 400)));
    ok(parsed.prices.length === 1 && parsed.prices[0].unitPrice === 12.5 && !parsed.prices[0].evidence.includes(NUL),
      "照抄的证据通过核对，证据里没有 U+0000", parsed.prices);
    const p = plan(parsed);
    ok(!p.notesAppend.includes(NUL) && !hasUnstorableChars(p.notesAppend) && p.transition === "quoted" && p.data.unitPrice === 12.5,
      "照抄时报价备注不含 U+0000，条目变为已报价（改动前备注带 U+0000，写库报 22021）", JSON.stringify(p.notesAppend));
  }

  // 3. 拼好的回信文字恰好在 16000 字处劈开表情符号
  {
    const prefix = "【邮件正文】\n";
    const body = "a".repeat(16_000 - prefix.length - 1) + "😀 tail";
    const m = fakeModel(() => ({}));
    await parseWith(body, m.complete);
    const text = promptText(m.prompts[0]?.userPrompt ?? "");
    ok(text.length === 16_000 && text.endsWith(`a${FFFD}`) && !hasUnstorableChars(text),
      "16000 字截断劈开表情符号：送进模型的回信文字以 U+FFFD 结尾，没有落单代理字符", { length: text.length, tail: JSON.stringify(text.slice(-3)) });
    const direct = buildInboundText(body, []);
    ok(direct.endsWith(FFFD) && direct.length === 16_000, "核对证据用的同一份文字也以 U+FFFD 结尾", JSON.stringify(direct.slice(-3)));
  }

  // 4. 只有 U+0000 的附件 → 无可提取文本
  {
    const onlyNul = buildPdf(["BT /F2 12 Tf 72 720 Td <00000000000000000000> Tj ET"]);
    const m = fakeModel(() => ({}));
    const parsed = await parseWith("See attached.", m.complete, [{ filename: "scan.pdf", mimeType: "application/pdf", data: onlyNul }]);
    ok(parsed.attachmentsSeen[0]?.parsed === false, "只有 U+0000 的 PDF 附件记为未解析", parsed.attachmentsSeen);
    const p = plan(parsed);
    ok(p.notesAppend.includes("附件：scan.pdf 附件无可提取文本（可能是扫描件）"), "报价备注写「scan.pdf 附件无可提取文本（可能是扫描件）」", p.notesAppend);
    ok(!(m.prompts[0]?.userPrompt ?? "").includes("【附件 scan.pdf】"), "这个附件的文字不进模型提示", m.prompts[0]?.userPrompt);
  }

  // 5. 附件文件名带 U+0000
  {
    const m = spacedModel();
    const parsed = await parseWith("See attached.", m.complete, [{ filename: `quote${NUL}1.pdf`, mimeType: "application/pdf", data: pdf }]);
    const userPrompt = m.prompts[0]?.userPrompt ?? "";
    ok(userPrompt.includes("附件：quote 1.pdf") && userPrompt.includes("【附件 quote 1.pdf】") && !userPrompt.includes(NUL),
      "文件名带 U+0000：送进模型的附件清单与正文标题里该处为空格", JSON.stringify(userPrompt.slice(0, 300)));
    const p = plan(parsed);
    ok(p.notesAppend.includes("附件：quote 1.pdf 已解析") && !p.notesAppend.includes(NUL), "报价备注里文件名该处为空格", JSON.stringify(p.notesAppend));
  }

  // 6. 证据以半个表情符号结尾
  {
    const m = fakeModel(() => ({
      isQuote: true, currency: "CAD",
      prices: [{ quantity: null, unitPrice: 12.5, totalPrice: null, evidence: `Unit price CAD 12.50 ${HIGH}` }],
    }));
    const parsed = await parseWith("Unit price CAD 12.50 😀 thanks", m.complete);
    ok(parsed.prices.length === 1, "以落单高位代理字符结尾的证据按码元仍能在原文里找到（通过核对）", parsed.prices);
    const p = plan(parsed);
    ok(p.notesAppend.includes(`（证据："Unit price CAD 12.50 ${FFFD}"）`) && !hasUnstorableChars(p.notesAppend),
      "报价备注里落单的高位代理字符为 U+FFFD", JSON.stringify(p.notesAppend));
  }

  // 7. 附件里一个勾选框：附件一栏注明，送进模型的提示里没有这句话
  {
    const m = spacedModel();
    const parsed = await parseWith("Please see the attached quotation.", m.complete, att);
    const p = plan(parsed);
    ok(p.notesAppend.includes(`附件：q.pdf 已解析${CHECKBOX_NOTE}`), "附件一栏为「附件：q.pdf 已解析（有 1 处无法识别的符号…请对照原件核对）」", JSON.stringify(p.notesAppend));
    ok(p.data.unitPrice === 12.5 && p.data.deliveryDays === 30, "价格与交期照常入表", p.data);
    const prompt = m.prompts.map((x) => x.systemPrompt + x.userPrompt).join("\n");
    ok(!prompt.includes("无法识别的符号") && !/有 \d+ 处/.test(prompt), "送进模型的提示里没有这句话与个数", null);
  }

  // 8. 附件没有 U+0000：只写「已解析」
  {
    const plain = buildPdf(["BT /F1 12 Tf 72 720 Td (Unit price CAD 12.50 per flag) Tj ET"]);
    const m = fakeModel(() => ({ isQuote: true, currency: "CAD", prices: [{ quantity: null, unitPrice: 12.5, totalPrice: null, evidence: "Unit price CAD 12.50 per flag" }] }));
    const parsed = await parseWith("See attached.", m.complete, [{ filename: "plain.pdf", mimeType: "application/pdf", data: plain }]);
    const p = plan(parsed);
    ok(p.notesAppend.endsWith("附件：plain.pdf 已解析") && !p.notesAppend.includes("无法识别"), "附件没有 U+0000：附件一栏与改动前相同，只写「plain.pdf 已解析」", JSON.stringify(p.notesAppend));
    ok(JSON.stringify(parsed.attachmentsSeen) === JSON.stringify([{ filename: "plain.pdf", parsed: true }]), "没有 U+0000 的附件，审计里的 attachmentsSeen 与改动前相同（不多字段）", parsed.attachmentsSeen);
  }

  // 9. 比价回读不受这句话影响
  {
    const base: ParsedQuote = {
      contractVersion: INBOUND_CONTRACT_VERSION, isQuote: true, declined: false, currency: "CAD",
      prices: [
        { quantity: 1500, unitPrice: 12.5, totalPrice: null, evidence: "1,500 pcs 单价 CAD 12.50；含包装" },
        { quantity: 3000, unitPrice: 11, totalPrice: null, evidence: "3,000 pcs CAD 11.00" },
      ],
      deliveryDays: 30, deliveryEvidence: "Delivery 30 days", validUntil: null, validUntilEvidence: null, moq: 500,
      incoterm: "FOB", incotermEvidence: "FOB Ningbo", mandatoryAnswers: [{ requirementCode: "R-01", answer: "满足", evidence: "R-01 满足，面料 1000D" }, { requirementCode: "R-02", answer: "未答", evidence: null }],
      missingFields: [], attachmentsSeen: [{ filename: "q.pdf", parsed: true }], validUntilInferred: false, rejected: [],
    };
    const withNote: ParsedQuote = { ...base, attachmentsSeen: [{ filename: "q.pdf", parsed: true, nulCount: 3 } as ParsedQuote["attachmentsSeen"][number]] };
    const a = planInquiryItemUpdate(sentItem, base, 1500, EMAIL_DATE, { messageId: "m-a", now: NOW });
    const b = planInquiryItemUpdate(sentItem, withNote, 1500, EMAIL_DATE, { messageId: "m-a", now: NOW });
    ok(b.notesAppend.includes("附件：q.pdf 已解析（有 3 处无法识别的符号，可能是勾选框或无法识别的字形，请对照原件核对）") && !a.notesAppend.includes("无法识别"),
      "带与不带这句话的两份备注只在附件一栏不同", { a: a.notesAppend, b: b.notesAppend });
    const ra = parseAutoNotes(a.notesAppend);
    const rb = parseAutoNotes(b.notesAppend);
    ok(JSON.stringify(ra) === JSON.stringify(rb) && ra.moq === 500 && ra.incoterm === "FOB" && ra.tiers.length === 2 && ra.mandatoryAnswers.length === 2 && ra.lastMissingFields.includes("validUntil"),
      "比价回读出的起订量、贸易条款、多档价、强制项与缺字段两份相同", { ra, rb });
  }

  // 10. 普通文字逐字不变
  {
    const body = "单价 CAD 42.50 😀\t含税\n交期 30 天";
    const text = buildInboundText(body, [{ filename: "报价.pdf", parsed: true, text: "中文 English 😀𠮷\t制表", note: null }]);
    ok(text === `【邮件正文】\n${body}\n\n【附件 报价.pdf】\n中文 English 😀𠮷\t制表`, "不含这两类字符的回信文字与改动前逐字相同", JSON.stringify(text));
  }
}


async function procurementSection() {
  console.log("\n— 采购记录附件 —");
  const { parseAttachmentBuffer } = await import("@/lib/procurement-records/attachments");

  // 1. 勾选框被抽成 U+0000 的披露文件
  {
    const r = await parseAttachmentBuffer(buildCheckboxPdf(), "disclosure.pdf");
    ok(r.status === "PARSED" && r.units.length === 2, "勾选框式 PDF：附件状态为「已解析」", { status: r.status, units: r.units.length });
    ok(r.units[1]?.text === `${LINE_A}\n  ${LINE_B}` && r.units[1]?.parseStatus === "done", "该页文字里的 U+0000 换成空格（「…check the box.\\n  The Bidder declares…」），其余逐字不变", r.units[1]);
    ok(r.units.every((u) => !hasUnstorableChars(u.text)), "每页文字都不含 U+0000");
  }

  // 2. 一页只有 30 个 U+0000 → 需要 OCR，附件不因此失败
  {
    const pdf = buildPdf([`BT /F2 12 Tf 72 720 Td <${"0000".repeat(30)}> Tj ET`, `BT /F1 12 Tf 72 720 Td (${LINE_B}) Tj ET`]);
    const r = await parseAttachmentBuffer(pdf, "thirty.pdf");
    ok(r.units[0]?.parseStatus === "OCR_REQUIRED" && r.units[0]?.text.trim() === "" && r.status === "PARSED",
      "一页抽出 30 个 U+0000：该页标为需要 OCR，附件仍为「已解析」（改动前 U+0000 算有效文字，判为可读）", { status: r.status, unit: r.units[0] });
  }

  // 3. xlsx 单元格里的 U+0000、工作表名带 U+0000
  {
    const buf = buildXlsx([{ name: `Sheet${NUL}A`, rows: [["Description", "Qty", "Order Value"], [`Flag${NUL} nylon`, 2, 20]] }]);
    const r = await parseAttachmentBuffer(buf, "disclosure.xlsx");
    ok(r.status === "PARSED" && r.units[0]?.text.includes("Flag  nylon") && !hasUnstorableChars(r.units[0]?.text ?? ""), "xlsx 单元格「Flag\\u0000 nylon」→ 工作表文字里为「Flag  nylon」", r.units[0]);
    ok(r.units[0]?.unitLabel === "Sheet A · 2 行" && JSON.stringify(r.sheets) === JSON.stringify([{ sheet: "Sheet A", rows: 2 }]), "单元标签与记进工作表范围的工作表名里 U+0000 换成空格", { label: r.units[0]?.unitLabel, sheets: r.sheets });
  }

  // 4. CSV 含 U+0000：判断不变
  {
    const r = await parseAttachmentBuffer(Buffer.from(`Description,Qty\nFlag${NUL},2\n`, "utf-8"), "disclosure.csv");
    ok(r.status === "CORRUPT" && r.error === "文本文件含二进制内容" && r.units.length === 0, "CSV 含 U+0000：仍为「文件损坏」，原因「文本文件含二进制内容」，与改动前相同", r);
  }

  // 5. 接线：明细写库前整条清理
  {
    const code = src("src/lib/procurement-records/attachments.ts");
    ok(/toStorableJson\(extractLinesFromUnits\(/.test(code), "接线：抽出的明细经 toStorableJson 整条清理后才写库（截断在 extract-pure.ts，清理在写库边界）");
    ok(code.includes('if (text.includes("\\u0000")) return { status: "CORRUPT", error: "文本文件含二进制内容"'), "接线：CSV / 纯文本仍按 UTF-8 读、含 U+0000 即「文件损坏」（G3-A）");
  }
}

async function chatSection() {
  console.log("\n— AI 对话附件与对话标题 —");
  const core = await import("@/lib/chat-attachments/core");
  const { parseAttachmentsInput, attachmentsFromLegacyFile, attachmentsTitleSource } = core;
  // 改动前没有这个函数（路由里直接 slice）；拿不到时按改动前的写法算，测试照样能在改动前的代码上跑出失败
  const titleOf: (source: string, maxChars: number) => string =
    typeof (core as Record<string, unknown>).storableTitle === "function"
      ? (core as unknown as { storableTitle: (s: string, n: number) => string }).storableTitle
      : (source, maxChars) => source.slice(0, maxChars);

  // 1. 新方式：正文带 U+0000、文件名带 U+0000
  {
    const r = parseAttachmentsInput([{ name: `quote${NUL}.pdf`, kind: "document", size: 100, text: `${LINE_A}\n${NUL} ${LINE_B}` }]);
    ok(r.ok && r.attachments[0].text === `${LINE_A}\n  ${LINE_B}` && r.attachments[0].name === "quote .pdf", "新方式：附件正文与文件名里的 U+0000 换成空格（存下与送模型的都是这一份）", r);
  }
  // 2. 新方式：正文只有 U+0000 → 400 的那句原因
  {
    const r = parseAttachmentsInput([{ name: "a.pdf", size: 10, text: NUL.repeat(12) }]);
    ok(!r.ok && r.error === "附件「a.pdf」没有可分析的文本内容", "新方式：正文只由 U+0000 组成 → 「附件「a.pdf」没有可分析的文本内容」（改动前校验通过、写消息 500）", r);
  }
  // 3. 新方式：长度校验结果不变（替换一个换一个）
  {
    const r = parseAttachmentsInput([{ name: "big.txt", size: 1, text: `${"x".repeat(149_999)}${NUL}` }]);
    ok(r.ok && r.attachments[0].text.length === 150_000, "新方式：正好 15 万字（含一个 U+0000）仍通过长度校验", r.ok);
  }
  // 4. 旧方式：正文第 15 万字处劈开表情符号
  {
    const list = attachmentsFromLegacyFile(`${"y".repeat(149_999)}😀tail`, "legacy.pdf");
    ok(list.length === 1 && list[0].text.length === 150_000 && list[0].text.endsWith(`y${FFFD}`) && !hasUnstorableChars(list[0].text), "旧方式：按 15 万字截断劈开表情符号 → 折算出的附件正文以 U+FFFD 结尾", list[0] ? JSON.stringify(list[0].text.slice(-3)) : list);
  }
  // 5. 旧方式：文件名第 200 字处劈开表情符号
  {
    const name = `${"n".repeat(199)}😀.pdf`;
    const list = attachmentsFromLegacyFile("some text", name);
    ok(list[0]?.name.length === 200 && list[0].name.endsWith(`n${FFFD}`), "旧方式：文件名超过 200 字、第 200 字处劈开表情符号 → 前 200 字、以 U+FFFD 结尾", list[0]?.name.slice(-3));
  }
  // 6. 旧方式：正文只有 U+0000 → 按没有附件处理
  {
    ok(attachmentsFromLegacyFile(NUL.repeat(8), "x.pdf").length === 0, "旧方式：正文只有 U+0000 → 按没有附件处理", attachmentsFromLegacyFile(NUL.repeat(8), "x.pdf"));
  }
  // 7. 普通文字不变
  {
    const text = "中文 English 😀𠮷\t制表\n换行";
    const r = parseAttachmentsInput([{ name: "报价 😀.pdf", size: 3, text }]);
    const legacy = attachmentsFromLegacyFile(text, "报价.pdf");
    ok(r.ok && r.attachments[0].text === text && r.attachments[0].name === "报价 😀.pdf" && legacy[0]?.text === text && legacy[0]?.name === "报价.pdf", "不含这两类字符的附件与改动前逐字相同");
    const plainTitle = "帮我看看这份报价单 😀 有没有问题，尤其是交期和付款条件这两块，供应商说可以再谈谈的";
    ok(titleOf(plainTitle, 60) === plainTitle.slice(0, 60) && titleOf(plainTitle, 30) === plainTitle.slice(0, 30), "不劈开代理对时，标题与改动前的截断逐字相同");
  }
  // 8. 只发附件：「附件：〈文件名〉」第 60 字处劈开表情符号
  {
    const r = parseAttachmentsInput([{ name: `${"报".repeat(56)}😀价.pdf`, size: 3, text: "内容" }]);
    const source = attachmentsTitleSource("", r.ok ? r.attachments : []);
    const title = titleOf(source, 60);
    ok(source.startsWith("附件：") && title.length === 60 && title.endsWith(`报${FFFD}`) && !hasUnstorableChars(title), "只发附件、「附件：〈文件名〉」第 60 字处劈开表情符号 → 标题为前 60 字、以 U+FFFD 结尾", JSON.stringify(title.slice(-3)));
  }
  // 9. 外贸对话的标题：第 30 字处劈开表情符号
  {
    const content = `${"外".repeat(29)}😀贸对话第一条消息`;
    const title = titleOf(content, 30) + (content.length > 30 ? "..." : "");
    ok(title === `${"外".repeat(29)}${FFFD}...`, "外贸对话第一条消息第 30 字处劈开表情符号 → 标题为前 30 字（最后一个为 U+FFFD）加「...」", JSON.stringify(title.slice(-5)));
  }
  // 10. 接线断言：5 处标题都经同一个函数；两个路由与跟进任务只用校验后的附件写库
  {
    const ai = src("src/app/api/ai/threads/[threadId]/messages/route.ts");
    const trade = src("src/app/api/trade/chat/[sessionId]/messages/route.ts");
    const followup = src("src/lib/assistant/followup-task.ts");
    const count = (code: string, re: RegExp) => (code.match(re) ?? []).length;
    ok(count(ai, /storableTitle\(titleSource, 60\)/g) === 3 && !/titleSource\.slice\(/.test(ai), "接线：主助手 / 项目「问青砚」的 3 处标题都经 storableTitle(titleSource, 60)，没有直接截断", count(ai, /storableTitle\(titleSource, 60\)/g));
    ok(trade.includes('storableTitle(titleSource, 30) + (titleSource.length > 30 ? "..." : "")') && !/titleSource\.slice\(/.test(trade), "接线：外贸对话的标题经 storableTitle(titleSource, 30)，「...」在清理之后拼");
    ok(/storableTitle\(\s*attachmentsTitleSource\(input\.userContent, input\.attachments\),\s*60,?\s*\)/.test(followup) && !/attachmentsTitleSource\([^)]*\)\.slice\(/.test(followup), "接线：助手跟进任务的标题经 storableTitle(…, 60)");
    for (const [label, code] of [["主助手路由", ai], ["外贸对话路由", trade], ["跟进任务", followup]] as const) {
      ok(!/\btitle\s*[:=]\s*[^\n]*?\.slice\(/.test(code), `接线：${label}里没有「title: / title = ….slice(」直接截断后写库的写法`);
    }
    ok(count(ai, /body\.attachments/g) === 1 && ai.includes("parseAttachmentsInput(body.attachments)") && count(ai, /body\.fileText/g) === 1 && ai.includes("attachmentsFromLegacyFile(body.fileText, body.fileName)") && ai.includes("{ attachments: attachments as unknown as Prisma.InputJsonValue }"),
      "接线：主助手路由只把校验后的附件（parseAttachmentsInput / attachmentsFromLegacyFile 的结果）写进消息");
    ok(count(trade, /body\.attachments/g) === 1 && trade.includes("parseAttachmentsInput(body.attachments)") && trade.includes("const attachments = parsedAttachments.attachments;") && trade.includes("{ attachments: attachments as unknown as Prisma.InputJsonValue }"),
      "接线：外贸对话路由只把校验后的附件写进消息");
    ok(followup.includes("{ attachments: input.attachments as unknown as Prisma.InputJsonValue }") && !/body\.|fileText/.test(followup), "接线：跟进任务写的是路由校验后传进来的附件");
    const rt = src("src/lib/market-intelligence/research-runtime.ts");
    ok(/marketEvidence: toStorableText\(\(input\.marketEvidence\?\.trim\(\) \|\| "未提供新的公开证据"\)\.slice\(0, 20_000\)\)/.test(rt), "接线：市场证据截到 2 万字之后再清理");
  }
}

async function productContentSection() {
  console.log("\n— 产品资料录入 —");
  const code = src("src/lib/product-content/intake/analyze.ts");
  const fn = code.slice(code.indexOf("function extractFactsFromText("), code.indexOf("function inferAssetRoleFromFileName("));
  const cleanAt = fn.indexOf("const text = toStorableText(rawText);");
  ok(/^function extractFactsFromText\(\s*rawText: string,/.test(fn) && cleanAt > 0 && cleanAt < fn.indexOf("const facts") && (fn.match(/rawText/g) ?? []).length === 2,
    "接线：事实抽取函数第一步就把传进来的文字清理（之后按行抽出的值、原文行、任务要求都取自清理后的文字）", fn.slice(0, 300));
  const calls = [...code.matchAll(/extractFactsFromText\(\s*([^,]+),/g)].map((m) => m[1].trim());
  ok(JSON.stringify(calls) === JSON.stringify(["rawText: string", "item.textContent", "item.transcriptText", "parsed.text", "text"]) && code.includes('extractFactsFromText(text, "website", item.id)'),
    "接线：文字、语音转写、文件（PDF / Excel）、网页四种来源都经这同一处进入事实抽取", calls);
}

async function main() {
  console.log("FIX-14 extracted-text other paths（不用数据库）");
  await inquirySection();
  await procurementSection();
  await chatSection();
  await productContentSection();
  console.log(`\nFIX-14 extracted-text other paths: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
