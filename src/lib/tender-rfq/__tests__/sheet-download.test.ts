/**
 * RFQ-PDF-1 「一键生成文档」里的供应商询价单 — 纯逻辑与接线
 * 运行：npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts
 *
 * 覆盖：内容排法（发起人填写项与贸易条款为空、起草日期按组织时区、与起草询价同一份内容）、
 *       不生成的五种情形（错误码 / 状态码 / 说明）、模板检查先于 PDF 生成、
 *       源码断言（生成路径不读分析综合与项目上下文、供应商询价单不回落 HTML、菜单与下线类型）。
 * DB 端到端见 sheet-download-db.isolated.test.ts。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PROJECT_PDF_DOC_TYPES, RETIRED_PROJECT_PDF_DOC_TYPES, isProjectPdfDocType, retiredDocTypeMessageZh } from "@/lib/bid-workflow/pdf-doc-types";
import { buildProjectIdentityDenyList, scanIdentity, type ProjectIdentitySources } from "@/lib/bid-workflow/project-identity-deny";
import { buildRfqDocument, rfqTemplateOnlyDocument, type RfqFactInput, type RfqRequirementInput } from "../build";
import { rfqAttachmentContentHash, rfqAttachmentTemplateSegments, renderRfqAttachmentHtml } from "../attachment";
import { __setRfqAttachmentPdfRendererForTest, renderCheckedRfqSheet } from "../attachment-service";
import { RFQ_SHEET_FAILURES, SupplierRfqSheetError, composeRfqSheet, rfqSheetRecordTitle, rfqSheetRenderFailureCode, type RfqSheetFailureCode } from "../sheet-download";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 800)); }
}

const FED_LOCATION = "Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9";
const sources = (o: Partial<ProjectIdentitySources> = {}): ProjectIdentitySources => ({
  projectName: "Sleeping Bags and Mats",
  solicitationNumber: "24062-27-057",
  clientOrganization: "Treasury Board of Canada Secretariat",
  closeDate: new Date("2026-12-05T19:00:00Z"),
  timeZone: "America/Toronto",
  facts: { tenderNumber: [], buyer: [], projectTitle: [], closingDatetime: [], location: [FED_LOCATION] },
  allowedEmails: ["project@sunnyshutter.ca"],
  ...o,
});
const denyList = buildProjectIdentityDenyList(sources());
const REF = "RFQ-SUNNY-2026-7KQ4M";
const req = (o: Partial<RfqRequirementInput> & { requirementCode: string }): RfqRequirementInput => ({
  category: "PRODUCT", originalRequirement: "Bags shall be rated to -20C.", chineseTranslation: "睡袋须达到 -20°C 舒适温度。", mandatory: true, reviewStatus: "CONFIRMED", sourcePage: 12, ...o,
});
const requirements: RfqRequirementInput[] = [
  req({ requirementCode: "R-001" }),
  req({ requirementCode: "R-002", category: "DELIVERY", mandatory: false, originalRequirement: "Delivery within 30 days.", chineseTranslation: "合同授予后 30 天内交付。", sourcePage: null }),
  req({ requirementCode: "R-003", category: "SAMPLES", originalRequirement: "Provide 2 samples.", chineseTranslation: "提供 2 件样品。" }),
  req({ requirementCode: "R-004", category: "INSURANCE", originalRequirement: "CGL $5M", chineseTranslation: "责任险" }),
  req({ requirementCode: "R-005", reviewStatus: "AI_EXTRACTED", originalRequirement: "Unconfirmed spec.", chineseTranslation: "未确认的规格。" }),
];
const facts: RfqFactInput[] = [{ type: "location", contentZh: FED_LOCATION, contentOriginal: null, confidence: "HIGH", manuallyConfirmed: true }];
const SETTINGS = { timezone: "America/Toronto", tenderRfq: { fromName: "Fixture Purchasing", fromEmail: "buy@fixture.test", mailboxEmail: "box@fixture.test", replyLeadDays: 5 } };
const CLOSE = new Date("2026-12-05T19:00:00Z");
const NOW = new Date("2026-11-19T15:00:00Z");
const base = { identity: { denyList, reference: REF }, orgSettingsJson: SETTINGS, closeDate: CLOSE, now: NOW, requirements, facts, env: {} as NodeJS.ProcessEnv };

console.log("rfq sheet download");

// ── 内容排法 ──
{
  const r = composeRfqSheet(base);
  ok(r.ok, "有已确认的供应商侧要求：排得出来", r);
  if (r.ok) {
    ok(r.doc.lineItems.map((i) => i.requirementCode).join(",") === "R-001,R-002,R-003", "只收已确认的供应商侧要求（保险类与未确认的不进）", r.doc.lineItems.map((i) => i.requirementCode));
    ok(r.doc.buyerDisplayName === "Fixture Purchasing" && r.replyLeadDays === 5 && r.doc.replyBy === "2026-11-30", "发件抬头与回复截止提前量取组织询价设置", { name: r.doc.buyerDisplayName, replyBy: r.doc.replyBy });
    ok(r.doc.incoterm === null && r.doc.scopeNote === null && r.doc.quantityTiers === null && r.doc.questions.every((q) => !q.text.includes("FSC")), "发起人填写项与贸易条款为空");
    ok(r.doc.destination === "Ottawa, ON", "目的地只取分析地点里的「城市, 省」", r.doc.destination);
    ok(r.doc.reference === REF && r.draftedAt === NOW.toISOString() && r.draftedOn === "2026-11-19", "询价编号、起草时刻与起草日期");
    const html = renderRfqAttachmentHtml(r.doc, { draftedOn: r.draftedOn });
    ok(html.includes("请注明报价贸易条款") && html.includes("询价单 / 符合性确认表") && html.includes(REF), "用询价附件的模板渲染：标题、询价编号、贸易条款一栏留给供应商注明");
    ok(!["24062-27-057", "Treasury Board", "Sleeping Bags and Mats", "2026-12-05", "Constellation", "K1A", "buy@fixture.test", "box@fixture.test"].some((x) => html.includes(x)), "渲染内容不含招标身份与任何邮箱");

    // 与起草询价同一份内容：按 prepareRfqRound 的入参（发起人什么都没填、贸易条款为空）直接调生成器，内容指纹相同
    const drafted = buildRfqDocument({
      identity: base.identity, buyerDisplayName: "Fixture Purchasing", closeDate: CLOSE.toISOString(), now: NOW, requirements, facts,
      quantityTiers: undefined, incoterm: null, destination: null, replyLeadDays: 5, extraQuestions: undefined, scopeNote: null,
    });
    ok(drafted.ok && rfqAttachmentContentHash(renderRfqAttachmentHtml(drafted.doc, { draftedOn: r.draftedOn })) === rfqAttachmentContentHash(html), "同一时刻、发起人什么都没填：与起草询价的附件内容指纹相同");
    ok(JSON.stringify(r.templateOnlyDoc) === JSON.stringify(rfqTemplateOnlyDocument(r.doc, null)) && r.templateOnlyDoc.destination === null && r.templateOnlyDoc.lineItems.every((i) => i.specZh === "" && i.specOriginal === ""), "留空招标原文的那一份：规格、交付要求、从地点派生的目的地都留空");
  }
}

// ── 起草日期按组织时区；项目没有组织时回退 ──
{
  const late = composeRfqSheet({ ...base, now: new Date("2026-12-02T03:30:00Z") });
  ok(late.ok && late.draftedOn === "2026-12-01", "组织时区 America/Toronto，UTC 2026-12-02T03:30 生成 → 起草日期 2026-12-01", late.ok ? late.draftedOn : late);
  const tokyo = composeRfqSheet({ ...base, orgSettingsJson: { ...SETTINGS, timezone: "Asia/Tokyo" }, now: new Date("2026-12-01T16:30:00Z") });
  ok(tokyo.ok && tokyo.draftedOn === "2026-12-02", "组织时区 Asia/Tokyo → 起草日期按当地日期", tokyo.ok ? tokyo.draftedOn : tokyo);
  const noOrg = composeRfqSheet({ ...base, orgSettingsJson: null });
  ok(noOrg.ok && noOrg.doc.buyerDisplayName === "Qyan-Sunny Purchasing" && noOrg.replyLeadDays === 7 && /^\d{4}-\d{2}-\d{2}$/.test(noOrg.draftedOn), "项目没有组织：发件抬头与提前量用询价设置的默认值，起草日期用系统默认时区", noOrg.ok ? noOrg.doc.buyerDisplayName : noOrg);
}

// ── 截标当天生成：起草日期不参与禁出清单比对 ──
{
  const onClose = composeRfqSheet({ ...base, now: new Date("2026-12-05T15:00:00Z") });
  ok(onClose.ok && onClose.draftedOn === "2026-12-05", "截标当天生成：排得出来，起草日期 = 截标日期", onClose);
  if (onClose.ok) ok(scanIdentity(denyList, rfqAttachmentTemplateSegments(onClose.templateOnlyDoc, { draftedOn: onClose.draftedOn })).length === 0, "截标当天生成：模板文字不命中（起草日期不参与比对）");
}

// ── 回复截止落在截标当天：既有规则会拦（询价单生成规则，本次不改；这里把行为固定下来） ──
{
  const twoDaysBefore = composeRfqSheet({ ...base, now: new Date("2026-12-03T15:00:00Z") });
  ok(twoDaysBefore.ok && twoDaysBefore.doc.replyBy === "2026-12-05", "截标前 2 天生成：回复截止按「不早于今天 + 2 天」落在截标当天", twoDaysBefore.ok ? twoDaysBefore.doc.replyBy : twoDaysBefore);
  if (twoDaysBefore.ok) {
    const hits = scanIdentity(denyList, rfqAttachmentTemplateSegments(twoDaysBefore.templateOnlyDoc, { draftedOn: twoDaysBefore.draftedOn }));
    ok(hits.length > 0 && hits.every((h) => h.category === "close_date" && h.where === "询价附件"), "截标前 2 天生成：模板文字命中截标日期·询价附件 → 不生成（与起草询价同一条既有规则）", hits);
  }
}

// ── 不生成的情形 ──
{
  const none = composeRfqSheet({ ...base, requirements: requirements.filter((r) => r.requirementCode === "R-004" || r.requirementCode === "R-005") });
  ok(!none.ok && none.errorCode === "NO_CONFIRMED_REQUIREMENTS", "没有已确认的供应商侧要求 → NO_CONFIRMED_REQUIREMENTS", none);
  const empty = composeRfqSheet({ ...base, requirements: [], facts: [] });
  ok(!empty.ok && empty.errorCode === "NO_CONFIRMED_REQUIREMENTS", "没有可用分析（没有任何要求）→ NO_CONFIRMED_REQUIREMENTS", empty);
  const leak = composeRfqSheet({ ...base, requirements: [req({ requirementCode: "R-001", chineseTranslation: "我方底价 12 元，睡袋须达到 -20°C。" })] });
  ok(!leak.ok && leak.errorCode === "SENSITIVE_LEAK" && !JSON.stringify(leak).includes("12 元"), "要求里写着底价 → SENSITIVE_LEAK，结果里没有命中的原文", leak);
  const ident = composeRfqSheet({ ...base, requirements: [req({ requirementCode: "R-07", originalRequirement: "Ship to Treasury Board of Canada Secretariat warehouse." })] });
  ok(!ident.ok && ident.errorCode === "IDENTITY_LEAK" && ident.hits.length === 1 && ident.hits[0].category === "buyer_name" && ident.hits[0].where === "要求 R-07", "要求里写着采购方 → IDENTITY_LEAK，命中采购方名称·要求 R-07", ident);
}

// ── 错误码、状态码与说明 ──
{
  const codes: RfqSheetFailureCode[] = ["NO_CONFIRMED_REQUIREMENTS", "SENSITIVE_LEAK", "RFQ_SHEET_RENDER_FAILED", "RFQ_SHEET_TOO_LARGE"];
  ok(codes.map((c) => RFQ_SHEET_FAILURES[c].status).join(",") === "422,422,503,422", "状态码：内容问题 422，PDF 没生成出来 503");
  ok(RFQ_SHEET_FAILURES.NO_CONFIRMED_REQUIREMENTS.message === "没有已确认且属于供应商侧的要求，先在青砚「招标要求」里逐条确认后再生成询价。", "没有要求：沿用询价单生成器的原句");
  ok(RFQ_SHEET_FAILURES.SENSITIVE_LEAK.message === "询价内容里有不能发给供应商的内容（如我方价格或内部备注），询价单没有生成，也没有保存文件。请到「招标要求」核对已确认的要求，并看一下询价设置里的发件抬头；页面上改不了的请联系管理员。", "内部财务信息的说明");
  ok(RFQ_SHEET_FAILURES.RFQ_SHEET_RENDER_FAILED.message === "询价单 PDF 没能生成，没有保存任何文件。请稍后再试；一直不行请联系管理员。", "PDF 没生成出来的说明");
  ok(RFQ_SHEET_FAILURES.RFQ_SHEET_TOO_LARGE.message === "询价单 PDF 超过 5 MB，没有保存。通常是已确认的供应商侧要求太多，请联系管理员处理。", "超过 5 MB 的说明");
  ok(codes.every((c) => !/[A-Z]{3,}_[A-Z_]+|Error|范围说明|自定义问题|「需求」|减少/.test(RFQ_SHEET_FAILURES[c].message)), "说明里没有错误码、异常字样；不把人引去菜单生成没有的栏目，不用界面上没有的叫法（页签叫「招标要求」），不叫人去做页面上做不了的事（减少已确认的要求）");
  const e = new SupplierRfqSheetError("RFQ_SHEET_RENDER_FAILED");
  ok(e instanceof Error && e.errorCode === "RFQ_SHEET_RENDER_FAILED" && e.status === 503 && e.message === RFQ_SHEET_FAILURES.RFQ_SHEET_RENDER_FAILED.message, "异常类型带错误码、状态码与说明");
  ok(rfqSheetRenderFailureCode("render_failed") === "RFQ_SHEET_RENDER_FAILED" && rfqSheetRenderFailureCode("too_large") === "RFQ_SHEET_TOO_LARGE", "PDF 检查结果 → 错误码");
  ok(rfqSheetRecordTitle(REF, 2) === `询价单-${REF} v2`, "生成记录标题：询价单-{询价编号} v{版本号}");
}

// ── 排版并检查：模板命中时不启动 PDF 生成；没有内嵌中文字体 / 超过 5 MB 判失败 ──
async function renderChecks() {
  const r = composeRfqSheet(base);
  if (!r.ok) throw new Error("fixture compose failed");
  const FONT = "<</Type /Font /BaseFont /AAAAAA+NotoSansSC-Regular>>";
  let renders = 0;
  __setRfqAttachmentPdfRendererForTest(async () => { renders += 1; return Buffer.from(`%PDF-1.7\n${FONT}\n1 0 obj <</Type /Page>> endobj\n%%EOF`, "latin1"); });
  const good = await renderCheckedRfqSheet({ doc: r.doc, templateOnlyDoc: r.templateOnlyDoc, denyList, draftedOn: r.draftedOn });
  ok(good.ok && renders === 1 && good.pdf.subarray(0, 5).toString("latin1") === "%PDF-" && good.html === renderRfqAttachmentHtml(r.doc, { draftedOn: r.draftedOn }), "检查通过：返回渲染内容与 PDF 字节，只生成一次");
  const broken = { ...r.templateOnlyDoc, buyerDisplayName: "Sleeping Bags and Mats Purchasing" };
  const hit = await renderCheckedRfqSheet({ doc: r.doc, templateOnlyDoc: broken, denyList, draftedOn: r.draftedOn });
  ok(!hit.ok && hit.reason === "identity" && hit.hits[0]?.where === "询价附件" && renders === 1, "模板文字命中项目名称 → 不生成，PDF 生成函数一次都不调", hit.ok ? null : hit);
  __setRfqAttachmentPdfRendererForTest(async () => Buffer.from("%PDF-1.7\n<</Type /Font /BaseFont /Helvetica>>\n%%EOF", "latin1"));
  const noFont = await renderCheckedRfqSheet({ doc: r.doc, templateOnlyDoc: r.templateOnlyDoc, denyList, draftedOn: r.draftedOn });
  ok(!noFont.ok && noFont.reason === "render_failed", "没有内嵌 Noto Sans SC → 判为生成失败", noFont.ok ? null : noFont);
  __setRfqAttachmentPdfRendererForTest(async () => Buffer.concat([Buffer.from(`%PDF-1.7\n${FONT}\n`, "latin1"), Buffer.alloc(5 * 1024 * 1024 + 1, 0x20)]));
  const big = await renderCheckedRfqSheet({ doc: r.doc, templateOnlyDoc: r.templateOnlyDoc, denyList, draftedOn: r.draftedOn });
  ok(!big.ok && big.reason === "too_large", "超过 5 MB → too_large", big.ok ? null : big.reason);
  __setRfqAttachmentPdfRendererForTest(async () => { throw new Error("chromium exploded: /secret/path"); });
  const thrown = await renderCheckedRfqSheet({ doc: r.doc, templateOnlyDoc: r.templateOnlyDoc, denyList, draftedOn: r.draftedOn });
  ok(!thrown.ok && thrown.reason === "render_failed", "生成函数抛错 → render_failed（异常原文不外传）", thrown.ok ? null : thrown);
  __setRfqAttachmentPdfRendererForTest(null);
}

// ── 源码断言 ──
function sourceChecks() {
  const root = process.cwd();
  const read = (f: string) => readFileSync(path.join(root, f), "utf8");
  /** 去掉注释再断言：注释里可以提旧名字，代码里不能有 */
  const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const gen = code("src/lib/projects/generate/generate-docs.ts");
  ok(!/buildSupplierRfqHtml|supplierRfqScanSegments|buildChinaSupplierBriefText|china-supplier-brief|sanitizeSupplierFacing|loadChinaBriefFacts/.test(gen), "生成代码不再引用分析综合的供应商询价表模板、简报正文拼装与旧的文字替换");
  const branchStart = gen.indexOf('input.docType === "supplier_rfq"');
  const branchEnd = gen.indexOf("db.project.findUnique", branchStart);
  const branch = branchStart >= 0 && branchEnd > branchStart ? gen.slice(branchStart, branchEnd) : "";
  ok(branch.includes("buildProjectRfqSheet") && branch.includes("persistGeneratedFile") && branch.includes("return"), "供应商询价单在读项目名称 / 描述 / 情报摘要的查询之前就返回，走询价单生成与专用落库", { branchStart, branchEnd });
  ok(!/buildProjectAiContextBlock|project\.name|project\.description|readAnalystSynthesis|renderHtmlToPdf|html_fallback/.test(branch), "供应商询价单的生成路径不拼接项目 AI 上下文、项目名称、项目描述，不读分析综合，不走会回落 HTML 的转换");
  ok((gen.match(/input\.docType === "supplier_rfq"/g) ?? []).length === 1 && !/"tech_confirm"|"china_supplier_brief"|supplierFacing/.test(gen), "生成代码里供应商询价单只有那一个分支；两类已停用的类型与旧的供应商侧文本路径不再出现", (gen.match(/input\.docType === "supplier_rfq"/g) ?? []).length);
  ok(!/projectName|addendumFingerprint/.test(branch) && branch.includes("contentHash: sheet.contentHash") && branch.includes("reference: sheet.reference") && branch.includes("rfqSheetRecordTitle(sheet.reference, version)"), "询价单记录的元数据记询价编号与内容指纹，不记项目名称；标题带询价编号");
  ok(gen.includes("html_fallback:") && gen.includes("renderHtmlToPdf"), "内部文件的落库保留「PDF 优先、失败存 HTML 并标注原因」");

  const svc = code("src/lib/tender-rfq/sheet-download-service.ts");
  const pure = code("src/lib/tender-rfq/sheet-download.ts");
  ok(!/tender-analyst|readAnalystSynthesis|project-ai-context|isRfqAttachmentEnabled|requestApproval|createInquiry|sendGmail|google-email/.test(svc + pure), "询价单文件的生成不读分析综合与项目上下文、不读附件开关、不建轮次、不建审批卡、不发信");
  ok(/select:\s*\{\s*id:\s*true,\s*closeDate:\s*true,\s*org:/.test(svc) && !/name:\s*true|description:\s*true/.test(svc), "只读项目的截标日期与组织设置，不读项目名称与描述");
  ok(svc.includes("renderCheckedRfqSheet") && code("src/lib/tender-rfq/attachment-service.ts").includes("await renderCheckedRfqSheet("), "菜单询价单与起草询价的附件走同一个排版并检查的函数");
  ok(code("src/lib/tender-rfq/service.ts").includes("rfqTemplateOnlyDocument(doc, input.destination)") && pure.includes("rfqTemplateOnlyDocument(built.doc, null)"), "两边用同一个函数留空招标原文");
  ok(!/process\.env/.test(svc) && !/process\.env/.test(pure), "没有开关：生成模块不读环境变量");

  const route = code("src/app/api/projects/[id]/generate-pdf/route.ts");
  ok(route.includes("SupplierRfqSheetError") && route.includes("SupplierIdentityLeakError") && route.includes("retiredDocTypeMessageZh") && !/previewOnly|confirmNotes|includePublicHistoricalAmounts|fontLimitation/.test(route), "接口：映射询价单的不生成情形与已停用类型；不再读预览 / 备注 / 历史金额，响应不再带 fontLimitation");

  ok(isProjectPdfDocType("supplier_rfq") && !isProjectPdfDocType("tech_confirm") && !isProjectPdfDocType("china_supplier_brief") && (PROJECT_PDF_DOC_TYPES as readonly string[]).length === 6, "白名单：留 supplier_rfq，去掉两类已停用的", PROJECT_PDF_DOC_TYPES);
  ok(Object.keys(RETIRED_PROJECT_PDF_DOC_TYPES).sort().join(",") === "china_supplier_brief,tech_confirm", "已停用类型表");
  ok(retiredDocTypeMessageZh("tech_confirm") === "「供应商技术确认表」已停用，请改用「供应商询价单 PDF」。之前生成的文件仍可在列表里打开、下载。" && retiredDocTypeMessageZh("china_supplier_brief") === "「国内供应商简报」已停用，请改用「供应商询价单 PDF」。之前生成的文件仍可在列表里打开、下载。" && retiredDocTypeMessageZh("supplier_rfq") === null && retiredDocTypeMessageZh("nope") === null, "已停用的说明：写明改用哪一项、旧文件还在");

  const menu = code("src/components/project-generate/project-generate-menu.tsx");
  ok(menu.includes('{ docType: "supplier_rfq", label: "供应商询价单 PDF" }') && !/tech_confirm|china_supplier_brief|国内供应商询价 PDF|China Brief/.test(menu), "菜单：有「供应商询价单 PDF」，没有两类已停用的");
  ok(menu.includes('const filename = d.title.endsWith(".pdf") ? d.title : `${d.title}.pdf`;') && menu.includes("withDownloadParam(url, filename)"), "菜单：下载文件名 = 标题 + .pdf（标题带询价编号，所以文件名里有询价编号）");
  ok(/setError\(e instanceof Error \? e\.message : "生成失败"\)/.test(menu) && /<p role="alert"[^>]*>\{error\}<\/p>/.test(menu) && code("src/lib/api-fetch.ts").includes("String((data as { error: unknown }).error)"), "菜单：失败时原样显示接口响应里的说明");
  {
    // 下拉层是浮层，开着会盖住说明：生成结束后无论成败都要收起（收起写在 try / catch 之后，不在 try 里）
    const gen = menu.slice(menu.indexOf("const generate = async"), menu.indexOf("const staleHint"));
    const afterCatch = gen.slice(gen.indexOf("} catch (e) {"));
    ok(afterCatch.includes("setOpen(false)") && !gen.slice(0, gen.indexOf("} catch (e) {")).includes("setOpen(false)"), "菜单：生成结束后无论成败都收起下拉层");
  }
  ok(menu.includes("RETIRED_PROJECT_PDF_DOC_TYPES, d.docType") && menu.includes("已停用的旧文件"), "菜单：列表里两类已停用的旧文件带「已停用的旧文件」");
  ok(menu.includes("生成供应商询价单、内部分析或同事任务单，自动读取当前项目资料。生成后可直接下载发送。"), "菜单：空状态提示");
  const tab = code("src/components/project-detail/tabs/bid-tab.tsx");
  ok(!/ChinaSupplierBriefPanel|china-supplier-brief-panel/.test(tab) && !existsSync(path.join(root, "src/components/bid-workflow/china-supplier-brief-panel.tsx")), "「标书与报价」页签不再有简报面板，面板文件已删除");
  const intel = code("src/lib/bid-workflow/start-intelligence.ts");
  ok(!intel.includes("china_supplier_brief") && !intel.includes("国内供应商中文 PDF") && intel.includes('{ key: "rfq_form", title: "厂家询价表", ready: false }'), "情报室默认交付物清单：没有简报一项，仍有「厂家询价表」");

  const brief = code("src/lib/bid-workflow/china-supplier-brief.ts");
  ok(brief.includes("export function containsSensitiveSupplierBriefText") && !/buildChinaSupplierBriefText|assertNoForbiddenLeak|scrubSensitiveSupplierBriefText/.test(brief), "敏感词判断保留，简报正文拼装已删");
  const tdh = code("src/lib/projects/generate/tender-doc-html.ts");
  ok(tdh.includes("export function buildInternalDecisionMemoHtml") && !/buildSupplierRfqHtml|supplierRfqScanSegments|SupplierDocHeader/.test(tdh), "内部决策备忘录模板保留，分析综合版供应商询价表已删");
}

(async () => {
  await renderChecks();
  sourceChecks();
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) process.exit(1);
})();
