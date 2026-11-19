/**
 * CHAIN-4a 询价 PDF 附件 — 内容 / 开关 / 哈希 / 卡上显示（纯函数 + 源码断言）
 * 运行：npx tsx src/lib/tender-rfq/__tests__/attachment.test.ts
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { buildProjectIdentityDenyList, scanIdentity, type ProjectIdentitySources } from "@/lib/bid-workflow/project-identity-deny";
import { buildRfqDocument, renderRfqEmail, type RfqDocument, type RfqRequirementInput } from "../build";
import {
  RFQ_ATTACHMENT_MAX_BYTES,
  RFQ_ATTACHMENT_TEMPLATE_VERSION,
  attachmentSizeLabelZh,
  checkRfqAttachmentPdf,
  countPdfPages,
  readPayloadAttachment,
  rfqAttachmentContentHash,
  rfqAttachmentDraftedOn,
  rfqAttachmentFilename,
  rfqAttachmentTemplateSegments,
  rfqAttachmentTextBlocks,
  renderRfqAttachmentHtml,
  type RfqPayloadAttachment,
} from "../attachment";
import { isRfqAttachmentEnabledForOrgWithEnv } from "../attachment-flags";
import { attachmentStaleMessageZh } from "../attachment-view";
import { __setRfqAttachmentPdfRendererForTest, draftRfqAttachment } from "../attachment-service";
import { hashRfqPayloadItems, previewRfqPayload } from "../round-pure";
import { previewEmailsFromPayload } from "../web-entry-pure";
import type { TenderSendRfqPayload } from "../types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 800)); }
}

const sources = (o: Partial<ProjectIdentitySources> = {}): ProjectIdentitySources => ({
  projectName: "Sleeping Bags and Mats",
  solicitationNumber: "24062-27-057",
  clientOrganization: "Treasury Board of Canada Secretariat",
  closeDate: new Date("2026-12-05T19:00:00Z"),
  timeZone: "America/Toronto",
  facts: { tenderNumber: [], buyer: [], projectTitle: [], closingDatetime: [], location: ["Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9"] },
  allowedEmails: ["project@sunnyshutter.ca"],
  ...o,
});
const denyList = buildProjectIdentityDenyList(sources());
const REF = "RFQ-SUNNY-2026-7KQ4M";
const req = (o: Partial<RfqRequirementInput> & { requirementCode: string }): RfqRequirementInput => ({
  category: "PRODUCT", originalRequirement: "Bags shall be rated to -20C.", chineseTranslation: "睡袋须达到 -20°C 舒适温度。", mandatory: true, reviewStatus: "CONFIRMED", sourcePage: 12, ...o,
});
const now = new Date("2026-11-19T15:00:00Z");
const built = buildRfqDocument({
  identity: { denyList, reference: REF },
  buyerDisplayName: "Sunny Trading Inc.",
  closeDate: "2026-12-05T19:00:00Z",
  now,
  requirements: [
    req({ requirementCode: "R-001" }),
    req({ requirementCode: "R-002", category: "DELIVERY", mandatory: false, originalRequirement: "Delivery within 30 days.", chineseTranslation: "Delivery within 30 days.", sourcePage: null }),
    req({ requirementCode: "R-003", category: "SAMPLES", originalRequirement: "Provide 2 samples <with tags> & labels.", chineseTranslation: "提供 2 件样品（含吊牌）& 标签。" }),
    req({ requirementCode: "R-004", category: "INSURANCE", originalRequirement: "CGL $5M", chineseTranslation: "责任险" }),
  ],
  facts: [{ type: "location", contentZh: "Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9", contentOriginal: null, confidence: "HIGH", manuallyConfirmed: true }],
  incoterm: "DDP",
  extraQuestions: ["能否提供 FSC 认证？"],
});
if (!built.ok) throw new Error(`fixture build failed: ${JSON.stringify(built)}`);
const doc: RfqDocument = built.doc;
const draftedOn = "2026-11-19";

console.log("rfq attachment");

// ── 开关 ──
{
  const on = (v: string | undefined, list: string | undefined, org = "org_1") =>
    isRfqAttachmentEnabledForOrgWithEnv(org, { TENDER_RFQ_ATTACHMENT_ENABLED: v, TENDER_RFQ_ATTACHMENT_ORG_ALLOWLIST: list } as NodeJS.ProcessEnv);
  ok(!on(undefined, undefined) && !on("0", undefined) && !on("false", "org_1"), "开关未设 / 0 / false → 关");
  ok(on("1", undefined) && on(" TRUE ", "") && on("yes", "org_1, org_2"), "开关为真且白名单为空或含本组织 → 开");
  ok(!on("1", "org_2") && !on("1", undefined, ""), "白名单只含别的组织 / 没有组织 → 关");
}

// ── 内容 ──
{
  const html = renderRfqAttachmentHtml(doc, { draftedOn });
  const text = rfqAttachmentTextBlocks(doc, { draftedOn }).join("\n");
  ok(rfqAttachmentFilename(REF) === "询价单-RFQ-SUNNY-2026-7KQ4M.pdf", "文件名为 询价单-{询价编号}.pdf");
  ok(html.includes('<meta charset="utf-8">'), "保留 <meta charset=\"utf-8\">（html-to-pdf 在它之后注入中文字体）");
  ok(doc.lineItems.length === 3 && (html.match(/<tr><td class="n">\d+<\/td>/g) ?? []).length === 3, "只有 3 条供应商侧的已确认要求（保险类不进）", doc.lineItems.map((i) => i.requirementCode));
  const codes = [...html.matchAll(/<tr><td class="n">\d+<\/td><td class="c">([^<]+)<\/td>/g)].map((m) => m[1]);
  const mail = renderRfqEmail(doc, { supplierName: "A" }).body;
  const mailCodes = [...mail.matchAll(/^\d+\. 【(?:强制|评分)】(\S+) /gm)].map((m) => m[1]);
  ok(codes.join() === mailCodes.join() && codes.join() === "R-001,R-002,R-003", "规格行与邮件同序同条数", { codes, mailCodes });
  const blocks = rfqAttachmentTextBlocks(doc, { draftedOn });
  const attQs = blocks.filter((b) => /^Q\d+\. /.test(b));
  const mailQs = mail.split("\n").filter((l) => /^Q\d+\. /.test(l));
  const mailMaterials = mail.split("四、请随报价提供")[1]?.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2)) ?? [];
  const attMaterials = blocks.slice(blocks.indexOf("四、请随报价提供") + 1, blocks.indexOf("四、请随报价提供") + 1 + mailMaterials.length);
  ok(attQs.length > 0 && attQs.join("\n") === mailQs.join("\n") && mailMaterials.length > 0 && attMaterials.join("\n") === mailMaterials.join("\n"), "问题与需提供的材料：与邮件同序同条数", { attQs, mailQs, attMaterials, mailMaterials });
  ok(!html.includes("原文：Delivery within 30 days.") && html.includes("原文：Bags shall be rated to -20C."), "中文与原文相同的那一行不重复印原文");
  ok(html.includes("&lt;with tags&gt; &amp; labels") && !html.includes("<with tags>"), "要求原文里的 < > & 被转义");
  ok(html.includes("<th class=\"y\">是否满足</th>") && html.includes("说明（差异 / 偏离）") && html.includes('<td class="y"></td><td class="e"></td>') && html.includes("请填：满足 / 部分满足 / 不满足"), "每条要求留「是否满足」与「说明」两栏空白；填写口径与问题清单一致（满足 / 部分满足 / 不满足）");
  ok(text.includes("供应商名称：") && text.includes("（盖章）") && !/Fixture|Supplier [A-C]/.test(text), "空白签章栏（不印任何供应商名称）");
  ok(html.includes(`@bottom-center{content:"${REF} · 第 " counter(page) " / " counter(pages) " 页"`), "每页页脚：询价编号 + 第 N / M 页");
  ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">`) && html.indexOf('<meta charset="utf-8">') < html.indexOf("Content-Security-Policy"), "CSP：不执行脚本、不发网络请求（只允许内联样式与 data: 字体 / 图片）");
  ok(text.includes("请直接回复发来本询价单的邮件"), "写明怎么回复");
  ok(text.includes("贸易条款：DDP，目的地 Ottawa, ON") && text.includes("回复截止：") && text.includes("Sunny Trading Inc."), "商务条件与邮件同一份写法");
  ok(renderRfqAttachmentHtml(doc, { draftedOn }) === html && rfqAttachmentContentHash(html) === rfqAttachmentContentHash(renderRfqAttachmentHtml(doc, { draftedOn })), "同样的输入渲染两次完全相同");
  ok(/^[0-9a-f]{64}$/.test(rfqAttachmentContentHash(html)) && rfqAttachmentContentHash(html) === createHash("sha256").update(html, "utf8").digest("hex"), "内容指纹是 HTML 的 SHA-256 十六进制");
  ok(rfqAttachmentContentHash(renderRfqAttachmentHtml(doc, { draftedOn: "2026-11-20" })) !== rfqAttachmentContentHash(html), "起草日期不同 → 指纹不同");
  const changed = { ...doc, lineItems: doc.lineItems.map((i, k) => (k === 0 ? { ...i, specZh: `${i.specZh}（改）` } : i)) };
  ok(rfqAttachmentContentHash(renderRfqAttachmentHtml(changed, { draftedOn })) !== rfqAttachmentContentHash(html), "改一条要求 → 指纹不同");
  for (const t of ["24062-27-057", "Treasury Board", "Sleeping Bags and Mats", "2026-12-05", "Constellation", "K1A"]) {
    ok(!html.includes(t), `附件不含 ${t}`);
  }
  ok(!/\d{4}-\d{2}-\d{2}T\d{2}:/.test(html) && !/Math\.random|Date\.now/.test(readFileSync(path.join(process.cwd(), "src/lib/tender-rfq/attachment.ts"), "utf8")), "附件里没有生成时刻；渲染代码不用随机数与当前时间");
  // 定版指纹：改了附件模板或询价单生成规则，这一条会失败——先把 RFQ_ATTACHMENT_TEMPLATE_VERSION 加一，再更新这里的期望值。
  // 否则已起草的卡在部署之后会被误报「内容在起草后变了」。
  const GOLDEN = { version: 1, hash: "7b745505347583f9e33687ec777be026b5852d1aa7c2499e43c304c3d880345a" };
  ok(RFQ_ATTACHMENT_TEMPLATE_VERSION === GOLDEN.version && rfqAttachmentContentHash(html) === GOLDEN.hash, "定版指纹：模板版本 1 的固定样例内容指纹不变", rfqAttachmentContentHash(html));
  ok(rfqAttachmentDraftedOn(new Date("2026-11-20T03:00:00Z"), "America/Toronto") === "2026-11-19" && rfqAttachmentDraftedOn(new Date("2026-11-20T03:00:00Z"), "Asia/Shanghai") === "2026-11-20", "起草日期按组织时区");
}

// ── 模板文字的身份检查 ──
let brokenTemplate: RfqDocument | null = null;
{
  const templateOnly = { ...doc, lineItems: doc.lineItems.map((li) => ({ ...li, specZh: "", specOriginal: "" })), requiredLeadTimeNote: null, destination: null };
  ok(scanIdentity(denyList, rfqAttachmentTemplateSegments(templateOnly, { draftedOn })).length === 0, "正常模板不命中");
  const broken = { ...templateOnly, buyerDisplayName: "Sleeping Bags and Mats 采购部" };
  const hits = scanIdentity(denyList, rfqAttachmentTemplateSegments(broken, { draftedOn }));
  ok(hits.length > 0 && hits.every((h) => h.where === "询价附件") && hits.some((h) => h.category === "project_name"), "模板文字含项目名称 → 命中项目名称、位置为「询价附件」", hits);
  brokenTemplate = broken;
  ok(scanIdentity(denyList, rfqAttachmentTemplateSegments(templateOnly, { draftedOn: "2026-12-05" })).length === 0, "起草日期恰好是截标日期：起草日期不参与比对（与供应商侧文件的生成日期同一口径）");
}

// ── 正文那一句 ──
{
  const fn = rfqAttachmentFilename(REF);
  const withA = renderRfqEmail(doc, { supplierName: "A", attachmentFilename: fn }).body;
  const without = renderRfqEmail(doc, { supplierName: "A" }).body;
  ok(withA.includes(`附件《${fn}》是上面清单的表格版，方便转给技术同事核对；可以直接在邮件里按编号回复，也可以填好表格随报价一起发回。`) && withA.indexOf("附件《") < withA.indexOf("为便于比对"), "带附件：正文在「为便于比对」之前多一句");
  ok(!without.includes("附件《") && renderRfqEmail(doc, { supplierName: "A", attachmentFilename: null }).body === without, "不带附件：正文不变");
}

// ── 载荷哈希与卡摘要 ──
const items: TenderSendRfqPayload["items"] = [
  { inquiryItemId: "i1", supplierId: "s1", supplierName: "A", to: "a@x.test", subject: "询价 RFQ（第 1 轮）", body: "正文 A" },
  { inquiryItemId: "i2", supplierId: "s2", supplierName: "B", to: "b@x.test", subject: "询价 RFQ（第 1 轮）", body: "正文 B" },
];
const att: RfqPayloadAttachment = {
  version: 1, filename: rfqAttachmentFilename(REF), mimeType: "application/pdf", pages: 2, sizeBytes: 86_000, contentHash: "a".repeat(64), templateVersion: RFQ_ATTACHMENT_TEMPLATE_VERSION,
  draft: { reference: REF, draftedAt: now.toISOString(), draftedOn, replyLeadDays: 7, scopeNote: null, extraQuestions: [], destination: null, quantityTiers: [] },
};
{
  const legacy = (xs: typeof items) => { const h = createHash("sha256"); for (const i of xs) h.update(`${i.inquiryItemId}|${i.to}|${i.subject}|${i.body}\n`); return h.digest("hex").slice(0, 16); };
  ok(hashRfqPayloadItems(items) === legacy(items) && hashRfqPayloadItems(items, null) === legacy(items), "不带附件：哈希与本功能之前相同");
  const withA = hashRfqPayloadItems(items, att);
  ok(withA !== legacy(items) && hashRfqPayloadItems(items, { ...att, filename: "x.pdf" }) !== withA && hashRfqPayloadItems(items, { ...att, contentHash: "b".repeat(64) }) !== withA, "带附件：哈希不同；改文件名或内容指纹都会变");

  const payload: TenderSendRfqPayload = { projectId: "p1", inquiryId: "q1", roundNumber: 1, fromName: "Sunny", fromEmail: "project@x.test", items, rfqDocHash: legacy(items), incoterm: "DDP" };
  const plain = previewRfqPayload(payload);
  ok(!plain.includes("附件："), "不带附件的卡摘要没有附件行");
  const withPrev = previewRfqPayload({ ...payload, attachment: att, rfqDocHash: withA });
  ok(withPrev === plain.replace(/(主题：[^\n]*)/, `$1\n附件：询价单-RFQ-SUNNY-2026-7KQ4M.pdf（2 页，84 KB）`), "带附件：主题之后多一行「附件：文件名（页数，大小）」，其余不变", withPrev);

  const emails = previewEmailsFromPayload({ ...payload, attachment: att }, { actionId: "act 1" });
  ok(emails.length === 2 && emails.every((e) => e.attachment?.filename === att.filename && e.attachment.pages === 2 && e.attachment.sizeBytes === 86_000 && e.attachment.previewHref === "/api/projects/p1/tender-rfq/attachment?actionId=act%201"), "发询价卡的每封预览都带附件与预览链接", emails[0]);
  ok(emails.every((e) => Object.keys(e.attachment ?? {}).every((k) => ["filename", "pages", "sizeBytes", "previewHref", "stale"].includes(k))), "预览里的附件信息只有白名单字段（文件名、页数、字节数、预览链接、核对结果）");
  ok(previewEmailsFromPayload(payload, { actionId: "a" }).every((e) => !("attachment" in e)), "不带附件的卡：预览没有附件键");
  ok(previewEmailsFromPayload({ supplierName: "A", to: "a@x.test", subject: "催单", body: "x", attachment: att }, { actionId: "a" }).every((e) => !("attachment" in e)), "催单 / 追问（单封）卡不读附件");
  ok(previewEmailsFromPayload({ ...payload, attachment: att }).every((e) => e.attachment?.previewHref === null), "没有卡 id 时没有预览链接");
  const { contentHash: _drop, ...missingHash } = att;
  void _drop;
  ok(readPayloadAttachment({ attachment: missingHash }) === null && readPayloadAttachment({ attachment: { ...att, contentHash: "zz" } }) === null && readPayloadAttachment({ attachment: { ...att, version: 2 } }) === null && readPayloadAttachment({}) === null && readPayloadAttachment({ attachment: null }) === null, "形状不对（缺内容指纹 / 指纹格式错 / 版本不认识）的附件当作没有（执行器另行拒发）");
}

// ── 大小、页数、PDF 检查 ──
{
  ok(attachmentSizeLabelZh(300) === "1 KB" && attachmentSizeLabelZh(93_395) === "91 KB" && attachmentSizeLabelZh(5.5 * 1024 * 1024) === "5.5 MB", "大小文案：KB 取整（至少 1）/ MB 一位小数");
  const FONT = "<</Type /Font /BaseFont /AAAAAA+NotoSansSC-Regular>>";
  const fake = (pages: number) => Buffer.from(`%PDF-1.4\n1 0 obj <</Type /Pages /Count ${pages} /Kids []>> endobj\n${Array.from({ length: pages }, (_, i) => `${i + 2} 0 obj <</Type /Page /Parent 1 0 R>> endobj`).join("\n")}\n${FONT}\n%%EOF`, "latin1");
  ok(countPdfPages(fake(3)) === 3 && countPdfPages(Buffer.from("%PDF-1.4 /Type /Pages /Count 5")) === 5 && countPdfPages(Buffer.from("%PDF-1.4")) === 1, "页数：数 /Type /Page，数不到用 /Count，至少 1");
  ok(checkRfqAttachmentPdf(fake(1)).ok && !checkRfqAttachmentPdf(Buffer.from("<html>")).ok, "不是 PDF → 生成失败");
  const noFont = checkRfqAttachmentPdf(Buffer.from("%PDF-1.4\n<</Type /Font /BaseFont /AAAAAA+DejaVuSans>>\n%%EOF"));
  ok(!noFont.ok && noFont.reason === "render_failed", "PDF 里没有嵌入 Noto Sans SC（中文会是空白）→ 生成失败");
  const prefix = Buffer.from(`%PDF-1.4\n${FONT}\n`, "latin1");
  const big = Buffer.concat([prefix, Buffer.alloc(RFQ_ATTACHMENT_MAX_BYTES + 1 - prefix.length)]);
  const r = checkRfqAttachmentPdf(big);
  ok(big.length === RFQ_ATTACHMENT_MAX_BYTES + 1 && !r.ok && r.reason === "too_large" && checkRfqAttachmentPdf(big.subarray(0, RFQ_ATTACHMENT_MAX_BYTES)).ok, "超过 5 MB（多 1 字节）→ 超限；恰好 5 MB 可以");
}

// ── 源码断言 ──
{
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
  const exec = read("src/lib/tender-rfq/execute.ts");
  const iRebuild = exec.indexOf("await rebuildRfqAttachment(");
  const iRender = exec.indexOf("await renderRfqAttachmentPdf(");
  const iSend = exec.indexOf("await send(");
  const iIdentity = exec.indexOf("RFQ_IDENTITY_LEAK");
  const iSender = exec.indexOf("resolveSender(");
  ok(iIdentity > 0 && iSender > iIdentity && iRebuild > iSender && iRender > iRebuild && iSend > iRender, "执行器：身份复核、发件账号检查之后，发出第一封之前核对附件并生成 PDF");
  ok(/\.\.\.\(attachments \? \{ attachments \} : \{\}\)/.test(exec), "执行器：不带附件时发信参数不写 attachments 键");
  const chase = read("src/lib/tender-rfq/chase-execute.ts");
  ok(!/attachments/.test(chase), "催单执行器的发信参数里没有附件");
  for (const f of ["src/lib/tender-rfq/attachment.ts", "src/lib/tender-rfq/attachment-service.ts", "src/lib/tender-rfq/attachment-view.ts", "src/app/api/projects/[id]/tender-rfq/attachment/route.ts"]) {
    const src = read(f);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok(!/from ["'][^"']*(openai|anthropic|@ai-sdk|\/llm|\/ai\/)[^"']*["']|generateText\(|chat\.completions|callLlm\(/i.test(code), `${f} 没有模型调用`);
  }
  ok(/prepared\.errorCode === "ATTACHMENT_FAILED"\) return autoDraftBlocked\("ATTACHMENT_FAILED", \{ \.\.\.ctx, attachmentReason: prepared\.attachmentReason \}\)/.test(read("src/lib/tender-rfq/auto-draft-service.ts")), "自动起草：送审结果 ATTACHMENT_FAILED 映射到同名原因码并带上原因（不记成泛泛的起草失败）");
  ok(/r\.errorCode === "PROJECT_NOT_FOUND" \? "PROJECT_NOT_FOUND" : r\.errorCode === "ROUND_LOCKED" \? "APPROVAL_FAILED" : "VALIDATION_FAILED"/.test(read("src/lib/muse-bridge/router.ts")), "Muse rfq 意图：其余起草失败（含附件失败）落到 VALIDATION_FAILED，说明用起草结果的那句");
  // 打包：会生成询价 PDF 的路由都要带上 Chromium 与中文字体（静态追踪看不见，漏了生产上一律「生成失败」）
  {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pm = require("next/dist/compiled/picomatch") as (g: string, o: object) => (s: string) => boolean;
    const cfgSrc = read("next.config.ts");
    const listSrc = cfgSrc.slice(cfgSrc.indexOf("const RFQ_ATTACHMENT_PDF_ROUTES"), cfgSrc.indexOf("];", cfgSrc.indexOf("const RFQ_ATTACHMENT_PDF_ROUTES")));
    const keys = [...listSrc.matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/\\/g, ""));
    ok(/\.\.\.Object\.fromEntries\(RFQ_ATTACHMENT_PDF_ROUTES\.map\(\(route\) => \[route, CJK_PDF_ASSETS\]\)\)/.test(cfgSrc) && /@sparticuz\/chromium\/bin\/\*\*/.test(cfgSrc.slice(0, cfgSrc.indexOf("const RFQ_ATTACHMENT_PDF_ROUTES"))), "next.config：清单里的路由都带上 CJK_PDF_ASSETS（含 Chromium 与 Noto Sans SC）");
    const routes: Array<{ route: string; src: string }> = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === "route.ts") routes.push({ route: "/" + path.relative(path.join(process.cwd(), "src/app"), path.dirname(p)), src: readFileSync(p, "utf8") }); } };
    walk(path.join(process.cwd(), "src/app/api"));
    const needs = routes.filter((r) =>
      /prepareRfqRound|maybeAutoDraftRfq|tender-rfq\/attachment-service/.test(r.src)
      || (/approvals\/decision"/.test(r.src) && /\/(approve|retry)$/.test(r.route))
      || /approveApprovalItem/.test(r.src));
    const missing = needs.filter((r) => !keys.some((k) => pm(k, { dot: true, contains: true })(r.route))).map((r) => r.route);
    ok(needs.length >= 10 && missing.length === 0, "会起草 / 执行 / 预览询价附件的路由都在打包清单里", { needs: needs.map((r) => r.route), missing });
  }
  // 卡上提前提示：核对出错按「暂时核对不了」处理（不当成一致放行）；过期时有驳回权限的人仍看到「驳回」
  ok(/rebuildRfqAttachment\([^)]*\)\.catch\(\(\) => "error" as const\)/.test(read("src/lib/tender-rfq/web-entry-approval.ts")) && /rebuilt === "error" \? "unknown"/.test(read("src/lib/tender-rfq/web-entry-approval.ts")), "读卡核对出错 → stale = unknown（不给批准）");
  ok(attachmentStaleMessageZh("unknown") === "暂时核对不了询价单 PDF，先不要批准。请稍后刷新页面再看。" && attachmentStaleMessageZh("changed").includes("请点「驳回」") && attachmentStaleMessageZh("template").includes("系统升级了询价单 PDF 的格式") && attachmentStaleMessageZh("identity").includes("招标身份信息"), "卡上四种提示的文案");
  const panelSrc = read("src/components/inquiry/rfq-approval-panel.tsx");
  ok(/canApprove = !!approval\?\.canApprove && !decided && !statusNote && !attachmentStale/.test(panelSrc) && /canApprove \|\| \(attachmentStale && canReject\)/.test(panelSrc) && /\{canApprove && \(/.test(panelSrc) && /需要组织管理员驳回这张卡。/.test(panelSrc), "面板：附件对不上时不给「批准并发送」，有驳回权限仍给「驳回」，否则写需要管理员驳回");
  const route = read("src/app/api/projects/[id]/tender-rfq/attachment/route.ts");
  ok(/requireProjectReadAccess\(/.test(route) && /where: \{ id: actionId, orgId, projectId, type: TENDER_SEND_RFQ_TYPE \}/.test(route) && !/\.(update|create|delete|upsert|updateMany|createMany)\(/.test(route) && !/sendGmail|execTenderSendRfq/.test(route), "预览接口：项目可读 + 只认本组织本项目的发询价卡；不写任何状态、不发信");
}

async function asyncChecks() {
  // 模板命中时不产出附件：PDF 生成函数一次都不调
  const broken = brokenTemplate!;
  let spyCalls = 0;
  __setRfqAttachmentPdfRendererForTest(async () => { spyCalls += 1; return Buffer.from("%PDF-1.7 /BaseFont /AAAAAA+NotoSansSC-Regular"); });
  const drafted = await draftRfqAttachment({ doc: { ...doc, buyerDisplayName: broken.buyerDisplayName }, templateOnlyDoc: broken, denyList, draft: att.draft });
  __setRfqAttachmentPdfRendererForTest(null);
  ok(!drafted.ok && drafted.reason === "identity" && drafted.hits.every((h) => h.where === "询价附件") && spyCalls === 0, "模板命中时不产出附件（PDF 生成函数一次都没调）", { drafted, spyCalls });
}

asyncChecks().then(() => {
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) process.exit(1);
}, (e) => { console.error(e); process.exit(1); });
