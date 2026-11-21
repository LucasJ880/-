/**
 * RFQ-PDF-1 「一键生成文档」里的供应商询价单——真实 DB（隔离库）端到端：
 * 内容来源 / 与询价附件同一份 / 零出站 / 分析综合带不进来 / 各种不生成 / 生成记录 / 已停用的两类 / 旧记录保留 / 内部文件回落
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture；PDF 生成函数是注入的假函数（最后两段除外：故意让 Chromium 不可用），
 * 文件存进临时目录（既有的本地存储模式），不发信。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 RFQ-PDF-1 供应商询价单 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "RFQ-PDF-1 rfq sheet download DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

async function main() {
  const { createHash } = await import("node:crypto");
  const { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { NextRequest } = await import("next/server");

  // 文件存进临时目录：「没有文件落库」可以直接数目录里的文件
  const blobDir = mkdtempSync(path.join(os.tmpdir(), "rfq-sheet-blobs-"));
  const prevEnv = {
    store: process.env.PRODUCT_CONTENT_LOCAL_STORE,
    dir: process.env.PRODUCT_CONTENT_LOCAL_STORE_DIR,
    chrome: process.env.CHROME_EXECUTABLE_PATH,
    flag: process.env.TENDER_RFQ_ATTACHMENT_ENABLED,
    allow: process.env.TENDER_RFQ_ATTACHMENT_ORG_ALLOWLIST,
    fromName: process.env.TENDER_RFQ_FROM_NAME,
    fromEmail: process.env.TENDER_RFQ_FROM_EMAIL,
    mailbox: process.env.TENDER_RFQ_MAILBOX_EMAIL,
  };
  // 询价设置在组织没配置时会回落到这三个环境变量：清掉，免得本机环境改变「默认值」那一段的结果
  delete process.env.TENDER_RFQ_FROM_NAME;
  delete process.env.TENDER_RFQ_FROM_EMAIL;
  delete process.env.TENDER_RFQ_MAILBOX_EMAIL;
  process.env.PRODUCT_CONTENT_LOCAL_STORE = "1";
  process.env.PRODUCT_CONTENT_LOCAL_STORE_DIR = blobDir;
  // 本地存储模式每个文件旁边有一份 .meta.json，不算文件本身
  const blobFiles = (dir = blobDir): string[] =>
    readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? blobFiles(p) : n.endsWith(".meta.json") ? [] : [p]; });

  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { generateProjectDocument } = await import("@/lib/projects/generate/generate-docs");
  const { prepareRfqRound } = await import("../service");
  const { __setRfqAttachmentPdfRendererForTest } = await import("../attachment-service");
  const { RFQ_ATTACHMENT_TEMPLATE_VERSION } = await import("../attachment");
  const { RFQ_SHEET_FAILURES } = await import("../sheet-download");
  const { SupplierIdentityLeakError } = await import("@/lib/bid-workflow/project-identity-deny");
  const { TENDER_SEND_RFQ_TYPE } = await import("../types");
  type Payload = import("../types").TenderSendRfqPayload;
  const route = await import("@/app/api/projects/[id]/generate-pdf/route");

  console.log("RFQ-PDF-1 rfq sheet download — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `showner_${stamp}`, ORG = `shorg_${stamp}`, ORG_BARE = `shbare_${stamp}`;
  const email = (id: string) => `${id}@fixture.test`;
  const MAILBOX = `mailbox_${stamp}@fixture.test`;

  await db.user.create({ data: { id: OWNER, email: email(OWNER), name: "Fixture Owner", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Buyer Inc.", code: `sunny-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG_BARE, name: "Bare Org", code: `bare-${stamp}`, ownerId: OWNER } });
  for (const orgId of [ORG, ORG_BARE]) await db.organizationMember.create({ data: { orgId, userId: OWNER, role: "org_admin", status: "active" } });
  await db.emailProvider.create({ data: { userId: OWNER, type: "gmail", accessToken: "fixture", accountEmail: MAILBOX, grantedScopes: "gmail.compose gmail.readonly" } });
  await db.organization.update({ where: { id: ORG }, data: { settingsJson: { timezone: "America/Toronto", tenderRfq: { fromName: "Fixture Purchasing", fromEmail: MAILBOX, mailboxEmail: MAILBOX } } } });
  const suppliers = [];
  for (const n of ["A", "B"]) {
    suppliers.push(await db.supplier.create({ data: { orgId: ORG, name: `Fixture Supplier ${n} ${stamp}`, contactEmail: `sales-${n.toLowerCase()}-${stamp}@supplier.test`, status: "active", createdById: OWNER } }));
  }
  const supplierIds = suppliers.map((s) => s.id);

  type Req = { category: string; text: string; zh?: string; status?: string; code?: string };
  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(o: {
    name: string; orgId?: string; solicitationNumber?: string | null; clientOrganization?: string | null; closeDate?: string;
    criticalFacts?: Record<string, unknown>; analystSynthesis?: unknown; reqs: Req[]; noRun?: boolean;
  }) {
    seq += 1;
    const projectId = `shproj_${stamp}_${seq}`;
    projectIds.push(projectId);
    await db.project.create({
      data: {
        id: projectId, name: o.name, orgId: o.orgId ?? ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched",
        solicitationNumber: o.solicitationNumber ?? null, clientOrganization: o.clientOrganization ?? null,
        // 走真实时钟的用例用远期截标日：回复截止不会落在截标当天（那是询价单生成规则的既有行为，纯逻辑测试里另有固定）
        closeDate: new Date(o.closeDate ?? "2031-06-05T19:00:00Z"), createdAt: new Date("2026-03-01T12:00:00Z"),
        description: "内部描述：预估金额 120 万，目标毛利 30%。",
      },
    });
    if (o.noRun) return projectId;
    const run = await db.tenderAnalysisRun.create({
      data: {
        orgId: o.orgId ?? ORG, projectId, status: "APPROVED", idempotencyKey: `sh-${stamp}-${seq}`, sourceHashFingerprint: "fixture", createdById: OWNER,
        summaryJson: { criticalFacts: o.criticalFacts ?? {}, ...(o.analystSynthesis ? { analystSynthesis: o.analystSynthesis } : {}) } as never,
      },
    });
    for (const [i, r] of o.reqs.entries()) {
      await db.tenderExtractedRequirement.create({
        data: { projectId, analysisRunId: run.id, requirementCode: r.code ?? `R-${String(i + 1).padStart(3, "0")}`, category: r.category, originalRequirement: r.text, chineseTranslation: r.zh ?? `示例要求 ${i + 1}`, mandatory: true, reviewStatus: r.status ?? "CONFIRMED" },
      });
    }
    return projectId;
  }
  const BASE_REQS: Req[] = [
    { category: "PRODUCT", text: "Bags shall be rated to -20C; mats shall have R-value of at least 4.", zh: "睡袋须达到 -20°C；睡垫 R 值不低于 4。" },
    { category: "DELIVERY", text: "Delivery within 30 days of contract award.", zh: "合同授予后 30 天内交付。" },
    { category: "SAMPLES", text: "Provide 2 samples with the quote.", zh: "随报价提供 2 件样品。" },
  ];
  const FED_LOCATION = "Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9";
  const FED = { name: "Sleeping Bags and Mats", solicitationNumber: "24062-27-057", clientOrganization: "Treasury Board of Canada Secretariat", closeDate: "2026-12-05T19:00:00Z", criticalFacts: { location: { status: "KNOWN", text: FED_LOCATION } } };
  // UTC 已是 11-19、多伦多还是 11-18：起草日期按组织时区才会得到 11-18
  const FED_NOW = new Date("2026-11-19T03:30:00Z");

  const genDocs = (projectId: string) => db.projectGeneratedDocument.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  const fileDocs = (projectId: string) => db.projectDocument.findMany({ where: { projectId } });
  const counts = async (projectId: string) => ({ gen: (await genDocs(projectId)).length, files: (await fileDocs(projectId)).length, blobs: blobFiles().length });
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const cookie = `qy_session=${await createSession({ sub: OWNER, email: email(OWNER), role: "user" })}`;
  type PostJson = { error?: string; errorCode?: string; allowed?: string[]; previewText?: string; fontLimitation?: unknown; document?: { id: string; title: string; version: number; fileUrl: string | null; blobUrl: string | null; metaJson: string | null; stale: boolean } };
  const post = async (projectId: string, body: Record<string, unknown> | null) => {
    const req = new NextRequest(`http://localhost/api/projects/${projectId}/generate-pdf`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    const res = await route.POST(req, { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, json: (await res.json()) as PostJson };
  };
  const list = async (projectId: string) => {
    const req = new NextRequest(`http://localhost/api/projects/${projectId}/generate-pdf`, { headers: { cookie } });
    const res = await route.GET(req, { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, json: (await res.json()) as { documents: Array<{ id: string; docType: string; title: string; fileUrl: string | null }> } };
  };
  const oldRecord = (projectId: string, docType: string, title: string) =>
    db.projectGeneratedDocument.create({
      data: { orgId: ORG, projectId, docType, version: 1, title, fileUrl: `/api/files/blob?pathname=old-${docType}.pdf`, blobUrl: `/api/files/blob?pathname=old-${docType}.pdf`, metaJson: JSON.stringify({ renderMode: "chromium_pdf" }), stale: false, createdById: OWNER },
    });

  const FONT = "<</Type /Font /BaseFont /AAAAAA+NotoSansSC-Regular>>";
  let renders = 0;
  const renderedHtml: string[] = [];
  const okRenderer = async (html: string) => { renders += 1; renderedHtml.push(html); return Buffer.from(`%PDF-1.7\n${FONT}\n1 0 obj <</Type /Page>> endobj\n2 0 obj <</Type /Page>> endobj\n% ${createHash("sha256").update(html).digest("hex")}\n%%EOF`, "latin1"); };
  const lastHtml = () => renderedHtml[renderedHtml.length - 1] ?? "";

  try {
    delete process.env.TENDER_RFQ_ATTACHMENT_ENABLED;
    delete process.env.TENDER_RFQ_ATTACHMENT_ORG_ALLOWLIST;
    __setRfqAttachmentPdfRendererForTest(okRenderer);

    // —— 1. 内容来源；附件开关关闭照样生成；零出站 ——
    const pA = await mkProject({
      name: "Fixture Bedding Supply",
      reqs: [...BASE_REQS, { category: "INSURANCE", text: "CGL insurance of $5M is required.", zh: "须投保 500 万商业责任险。" }, { category: "PRODUCT", text: "Unconfirmed colour spec.", zh: "未确认的颜色规格。", status: "AI_EXTRACTED" }],
    });
    const rA = await post(pA, { docType: "supplier_rfq" });
    const htmlA = lastHtml();
    const docA = rA.json.document;
    ok(rA.status === 200 && !!docA && renders === 1, "生成成功（附件开关未设），PDF 只生成一次", rA.json);
    ok(["R-001", "R-002", "R-003", "睡袋须达到 -20°C", "合同授予后 30 天内交付", "随报价提供 2 件样品"].every((x) => htmlA.includes(x)) && !["R-004", "R-005", "责任险", "CGL", "未确认的颜色规格"].some((x) => htmlA.includes(x)), "只收已确认的供应商侧要求（保险类与未确认的不进）");
    ok(htmlA.includes("Fixture Purchasing") && htmlA.includes("请注明报价贸易条款") && htmlA.includes("询价单 / 符合性确认表"), "抬头取组织询价设置，贸易条款留给供应商注明，用询价附件的模板");
    ok(!["Fixture Bedding Supply", "预估金额", "毛利", MAILBOX, "Fixture Supplier"].some((x) => htmlA.includes(x)), "渲染内容没有项目名称、项目描述、任何邮箱与供应商名称");
    ok(!!docA && /^询价单-RFQ-SUNNY-2026-[0-9A-Z]{5} v1$/.test(docA.title) && docA.version === 1 && docA.stale === false && !!docA.fileUrl && !("fontLimitation" in rA.json), "响应：标题「询价单-{询价编号} v1」、有文件地址、不再带 fontLimitation", { title: docA?.title, keys: Object.keys(rA.json) });
    const metaA = JSON.parse(docA?.metaJson ?? "{}") as Record<string, unknown>;
    ok(/^[0-9a-f]{64}$/.test(String(metaA.contentHash)) && metaA.contentHash === createHash("sha256").update(htmlA, "utf8").digest("hex") && metaA.templateVersion === RFQ_ATTACHMENT_TEMPLATE_VERSION && metaA.renderMode === "chromium_pdf" && metaA.conclusionVersion === `rfq_sheet_v${RFQ_ATTACHMENT_TEMPLATE_VERSION}` && metaA.replyLeadDays === 7 && metaA.pages === 2 && typeof metaA.draftedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(String(metaA.draftedOn)) && docA?.title === `询价单-${String(metaA.reference)} v1` && !("projectName" in metaA), "元数据：询价编号、起草时刻与日期、内容指纹（= 渲染内容的 SHA-256）、版式版本、提前量、页数；没有项目名称", metaA);
    const filesA = await fileDocs(pA);
    const blobsA = blobFiles();
    ok(filesA.length === 1 && filesA[0].fileType === "pdf" && filesA[0].source === "generated" && filesA[0].title === docA?.title && blobsA.length === 1 && blobsA[0].endsWith(".pdf") && readFileSync(blobsA[0]).subarray(0, 5).toString("latin1") === "%PDF-", "落库：一份以 %PDF- 开头的文件、一条项目文件记录（PDF）", { files: filesA.length, blobs: blobsA });
    ok((await db.projectInquiry.count({ where: { projectId: pA } })) === 0 && (await db.pendingAction.count({ where: { orgId: ORG } })) === 0, "零出站：没有建询价轮次，没有建审批卡");

    // —— 2. 与起草询价的附件同一份（内容指纹相同、同一个询价编号）；联邦标不带招标身份 ——
    process.env.TENDER_RFQ_ATTACHMENT_ENABLED = "1";
    process.env.TENDER_RFQ_ATTACHMENT_ORG_ALLOWLIST = ORG;
    const pFed = await mkProject({ ...FED, reqs: BASE_REQS });
    const drafted = await prepareRfqRound({ projectId: pFed, orgId: ORG, userId: OWNER, source: "web", supplierIds, incoterm: null, now: FED_NOW });
    const card = await db.pendingAction.findFirst({ where: { orgId: ORG, projectId: pFed, type: TENDER_SEND_RFQ_TYPE } });
    const payload = card?.payload as unknown as Payload | undefined;
    const attachmentHtml = lastHtml();
    ok(drafted.ok && !!payload?.attachment, "先起草一轮带附件的询价（发起人什么都没填、贸易条款不指定）", drafted.ok ? null : drafted);
    const rowFed = await generateProjectDocument({ projectId: pFed, orgId: ORG, userId: OWNER, docType: "supplier_rfq", now: FED_NOW });
    const htmlFed = lastHtml();
    const metaFed = JSON.parse((rowFed as { metaJson?: string | null }).metaJson ?? "{}") as Record<string, unknown>;
    ok(!!payload?.attachment && metaFed.contentHash === payload.attachment.contentHash && htmlFed === attachmentHtml, "同一项目、同一时刻：询价单文件与询价附件的渲染内容逐字节相同，内容指纹相同", { sheet: metaFed.contentHash, attachment: payload?.attachment?.contentHash });
    ok(!!payload && metaFed.reference === payload.attachment?.draft.reference && payload.items.every((i) => i.subject.includes(String(metaFed.reference))) && metaFed.draftedOn === "2026-11-18" && metaFed.draftedAt === FED_NOW.toISOString() && htmlFed.includes("2026-11-18") && !htmlFed.includes("2026-11-19"), "询价单文件与询价邮件用同一个询价编号；起草日期按组织时区（UTC 11-19 03:30 = 多伦多 11-18）", metaFed);
    ok(htmlFed.includes(String(metaFed.reference)) && htmlFed.includes("询价单 / 符合性确认表") && htmlFed.includes("目的地 Ottawa, ON") && !["24062-27-057", "Treasury Board", "Sleeping Bags and Mats", "2026-12-05", "Constellation", "K1A"].some((x) => htmlFed.includes(x)), "联邦标：有标题与询价编号，没有招标编号、采购方、项目名称、截标日期与精确地址，目的地为 Ottawa, ON");
    const cardsBefore = await db.pendingAction.count({ where: { orgId: ORG } });
    const roundsBefore = await db.projectInquiry.count({ where: { projectId: pFed } });
    await generateProjectDocument({ projectId: pFed, orgId: ORG, userId: OWNER, docType: "supplier_rfq", now: FED_NOW });
    ok((await db.pendingAction.count({ where: { orgId: ORG } })) === cardsBefore && (await db.projectInquiry.count({ where: { projectId: pFed } })) === roundsBefore, "附件开关打开时生成询价单文件：同样不建轮次、不建审批卡");
    delete process.env.TENDER_RFQ_ATTACHMENT_ENABLED;
    delete process.env.TENDER_RFQ_ATTACHMENT_ORG_ALLOWLIST;
    // 同一项目已生成两次：版本号 1、2，只有最新一条未过期；再来一次是 3
    await generateProjectDocument({ projectId: pFed, orgId: ORG, userId: OWNER, docType: "supplier_rfq", now: FED_NOW });
    const fedRows = await genDocs(pFed);
    ok(same(fedRows.map((r) => [r.version, r.stale]), [[1, true], [2, true], [3, false]]) && new Set(fedRows.map((r) => r.title)).size === 3, "同一项目生成三次：版本号 1 / 2 / 3，只有最新一条未过期", fedRows.map((r) => [r.title, r.stale]));

    // 模板文字命中（回复截止落在截标当天，既有规则）：经菜单路径同样整份不生成，不启动 PDF 生成、什么都不写
    {
      const before = { c: await counts(pFed), renders };
      let caught: unknown = null;
      try { await generateProjectDocument({ projectId: pFed, orgId: ORG, userId: OWNER, docType: "supplier_rfq", now: new Date("2026-12-03T15:00:00Z") }); } catch (e) { caught = e; }
      const hits = caught instanceof SupplierIdentityLeakError ? caught.hits : [];
      ok(caught instanceof SupplierIdentityLeakError && hits.length > 0 && hits.every((h) => h.category === "close_date" && h.where === "询价附件") && caught.message === "供应商侧文件含招标身份信息（命中：截标日期·询价附件），未生成。" && renders === before.renders && same(await counts(pFed), before.c), "截标前 2 天生成：模板文字命中截标日期·询价附件 → 抛身份命中，PDF 生成函数没被调用，记录与文件都没有变", caught instanceof Error ? caught.message : caught);
    }

    // —— 3. 分析综合里的「毛利」「预算」与采购方带不进来 ——
    const leakyItem = { id: "TR-1", titleZh: "泡沫密度要求（预算内）", explanationZh: "Cox Agency 要求密度不低于 50kg/m3；我方毛利空间有限，预算紧。", whyItMattersZh: "不达标即技术不合格。", phase: "TECHNICAL_COMPLIANCE", impact: "BID_REQUIRED", severity: "HIGH", supportingRequirementIds: [], supportingFactIds: [], supportingRiskIds: [] };
    const pSyn = await mkProject({
      name: "Fixture Mattress Supply", clientOrganization: "Cox Agency", reqs: BASE_REQS,
      analystSynthesis: { version: "tender-analyst-synthesis/v1", language: "zh-CN", technicalRequirements: [leakyItem], commercialAndDelivery: [{ ...leakyItem, id: "CD-1" }], keyRequirements: [], risksAndGaps: [], clarifications: [], nextActions: [] },
    });
    const rSyn = await post(pSyn, { docType: "supplier_rfq" });
    const htmlSyn = lastHtml();
    ok(rSyn.status === 200 && !["毛利", "预算", "Cox Agency", "泡沫密度"].some((x) => htmlSyn.includes(x)) && htmlSyn.includes("睡袋须达到 -20°C"), "分析综合里写着毛利、预算与采购方：照常生成，渲染内容里没有这些（不读分析综合）", rSyn.json);

    // —— 4. 没有可收入的要求：422，什么都不写，旧记录的过期标记不动 ——
    const pNone = await mkProject({ name: "Fixture No Confirmed", reqs: [{ category: "PRODUCT", text: "Unconfirmed spec.", zh: "未确认的规格。", status: "AI_EXTRACTED" }, { category: "INSURANCE", text: "CGL insurance.", zh: "责任险。" }] });
    const oldNone = await oldRecord(pNone, "supplier_rfq", "国内供应商询价 v1");
    const cNone = await counts(pNone);
    const rNone = await post(pNone, { docType: "supplier_rfq" });
    ok(rNone.status === 422 && rNone.json.errorCode === "NO_CONFIRMED_REQUIREMENTS" && rNone.json.error === "没有已确认且属于供应商侧的要求，先在青砚「招标要求」里逐条确认后再生成询价。" && !rNone.json.document, "没有已确认的供应商侧要求 → 422 与那句说明", rNone);
    ok(same(await counts(pNone), cNone) && (await db.projectGeneratedDocument.findUnique({ where: { id: oldNone.id } }))?.stale === false, "没有新记录、没有新文件，之前那份询价单记录没有被标成可能过期");
    const pNoRun = await mkProject({ name: "Fixture No Analysis", reqs: [], noRun: true });
    const rNoRun = await post(pNoRun, { docType: "supplier_rfq" });
    ok(rNoRun.status === 422 && rNoRun.json.errorCode === "NO_CONFIRMED_REQUIREMENTS" && (await counts(pNoRun)).gen === 0, "没有可用分析 → 同样 422", rNoRun);

    // —— 5. 命中内部财务信息 / 招标身份：422，什么都不写 ——
    const pSens = await mkProject({ name: "Fixture Sensitive", reqs: [{ category: "PRODUCT", text: "Bags shall be rated to -20C.", zh: "我方底价 12 元，睡袋须达到 -20°C。" }] });
    const cSens = await counts(pSens);
    const rSens = await post(pSens, { docType: "supplier_rfq" });
    ok(rSens.status === 422 && rSens.json.errorCode === "SENSITIVE_LEAK" && rSens.json.error === RFQ_SHEET_FAILURES.SENSITIVE_LEAK.message && !JSON.stringify(rSens.json).includes("12 元") && same(await counts(pSens), cSens), "要求里写着底价 → 422 SENSITIVE_LEAK，说明不含命中的原文，记录数不变", rSens);
    const pIdent = await mkProject({ name: "Fixture Identity", clientOrganization: "City of Ottawa", reqs: [...BASE_REQS.slice(0, 1), { category: "DELIVERY", code: "R-07", text: "Deliver to the City of Ottawa warehouse.", zh: "送到指定仓库。" }] });
    const cIdent = await counts(pIdent);
    const rIdent = await post(pIdent, { docType: "supplier_rfq" });
    ok(rIdent.status === 422 && rIdent.json.errorCode === "IDENTITY_LEAK" && rIdent.json.error === "供应商侧文件含招标身份信息（命中：采购方名称·要求 R-07），未生成。" && !String(rIdent.json.error).includes("City of Ottawa") && same(await counts(pIdent), cIdent), "已确认的要求写着采购方 → 422 IDENTITY_LEAK，说明写类别与位置、不含原文，记录数不变", rIdent);

    // —— 6. PDF 检查不过：不保存，不回落 HTML ——
    const pPdf = await mkProject({ name: "Fixture Pdf Checks", reqs: BASE_REQS });
    const cPdf = await counts(pPdf);
    __setRfqAttachmentPdfRendererForTest(async () => Buffer.from("%PDF-1.7\n<</Type /Font /BaseFont /Helvetica>>\n1 0 obj <</Type /Page>> endobj\n%%EOF", "latin1"));
    const rNoFont = await post(pPdf, { docType: "supplier_rfq" });
    ok(rNoFont.status === 503 && rNoFont.json.errorCode === "RFQ_SHEET_RENDER_FAILED" && rNoFont.json.error === "询价单 PDF 没能生成，没有保存任何文件。请稍后再试；一直不行请联系管理员。" && same(await counts(pPdf), cPdf), "PDF 没有内嵌中文字体 → 503，没有记录、没有任何文件（含 HTML）", rNoFont);
    __setRfqAttachmentPdfRendererForTest(async () => { throw new Error("chromium exploded at /var/task/secret"); });
    const rThrow = await post(pPdf, { docType: "supplier_rfq" });
    ok(rThrow.status === 503 && rThrow.json.errorCode === "RFQ_SHEET_RENDER_FAILED" && !JSON.stringify(rThrow.json).includes("chromium") && same(await counts(pPdf), cPdf), "生成函数抛错 → 503，说明不含异常原文，什么都没保存", rThrow);
    __setRfqAttachmentPdfRendererForTest(async () => Buffer.from("<html>not a pdf</html>", "utf8"));
    const rNotPdf = await post(pPdf, { docType: "supplier_rfq" });
    ok(rNotPdf.status === 503 && rNotPdf.json.errorCode === "RFQ_SHEET_RENDER_FAILED" && same(await counts(pPdf), cPdf), "输出不是 PDF → 503，什么都没保存", rNotPdf);
    __setRfqAttachmentPdfRendererForTest(async () => Buffer.concat([Buffer.from(`%PDF-1.7\n${FONT}\n`, "latin1"), Buffer.alloc(5 * 1024 * 1024 + 1, 0x20)]));
    const rBig = await post(pPdf, { docType: "supplier_rfq" });
    ok(rBig.status === 422 && rBig.json.errorCode === "RFQ_SHEET_TOO_LARGE" && rBig.json.error === "询价单 PDF 超过 5 MB，没有保存。通常是已确认的供应商侧要求太多，请联系管理员处理。" && same(await counts(pPdf), cPdf), "超过 5 MB → 422，什么都没保存", { status: rBig.status, json: rBig.json });
    __setRfqAttachmentPdfRendererForTest(okRenderer);

    // —— 7. 第二次生成：版本号接着旧记录算，旧记录标为可能过期 ——
    const pV2 = await mkProject({ name: "Fixture Second Version", reqs: BASE_REQS });
    const oldV1 = await oldRecord(pV2, "supplier_rfq", "国内供应商询价 v1");
    const otherType = await oldRecord(pV2, "internal_analysis", "内部项目分析 v1");
    const rV2 = await post(pV2, { docType: "supplier_rfq" });
    const rowsV2 = await genDocs(pV2);
    const metaV2 = JSON.parse(rV2.json.document?.metaJson ?? "{}") as Record<string, unknown>;
    const blobV2 = blobFiles().find((f) => f.includes(pV2));
    ok(rowsV2.find((r) => r.id === otherType.id)?.stale === false, "第二次生成：别的类型的记录不受影响（不会被标成可能过期）");
    ok(!!blobV2 && blobV2.endsWith("supplier_rfq-v2-" + blobV2.split("supplier_rfq-v2-")[1]) && readFileSync(blobV2).subarray(0, 5).toString("latin1") === "%PDF-" && /^[0-9a-f]{64}$/.test(String(metaV2.contentHash)) && metaV2.templateVersion === RFQ_ATTACHMENT_TEMPLATE_VERSION && !("projectName" in metaV2), "第二次生成：存下的文件以 %PDF- 开头、路径带 v2；元数据有内容指纹与版式版本，没有项目名称", { blobV2, metaV2 });
    ok(rV2.status === 200 && /^询价单-RFQ-SUNNY-2026-[0-9A-Z]{5} v2$/.test(rV2.json.document?.title ?? "") && rV2.json.document?.version === 2 && rV2.json.document?.stale === false && rowsV2.find((r) => r.id === oldV1.id)?.stale === true && rowsV2.find((r) => r.id === oldV1.id)?.title === "国内供应商询价 v1", "第二次生成：新记录「询价单-{询价编号} v2」未过期，旧记录标为可能过期、标题不动", rowsV2.map((r) => [r.title, r.stale]));

    // —— 8. 项目所属组织没有保存过询价设置：用默认值照常生成 ——
    const pBare = await mkProject({ name: "Fixture Bare Org", orgId: ORG_BARE, reqs: BASE_REQS });
    const rBare = await post(pBare, { docType: "supplier_rfq" });
    ok(rBare.status === 200 && lastHtml().includes("Qyan-Sunny Purchasing") && /^询价单-RFQ-BARE-2026-[0-9A-Z]{5} v1$/.test(rBare.json.document?.title ?? ""), "组织没有询价设置：发件抬头用默认值，询价编号用本组织代码，照常生成", rBare.json.document?.title);

    // —— 9. 已停用的两类：POST 被拒；不认识的类型照旧；GET 仍列出旧记录 ——
    const pRet = await mkProject({ name: "Fixture Retired", reqs: BASE_REQS });
    const oldTech = await oldRecord(pRet, "tech_confirm", "供应商技术确认表 v1");
    const oldBrief = await oldRecord(pRet, "china_supplier_brief", "China Supplier Sourcing Brief v1");
    const cRet = await counts(pRet);
    const rendersBefore = renders;
    const rTech = await post(pRet, { docType: "tech_confirm" });
    const rBrief = await post(pRet, { docType: "china_supplier_brief", previewOnly: true, includePublicHistoricalAmounts: true, confirmNotes: "请参考 Cox Agency 的往年订单" });
    const rBriefGen = await post(pRet, { docType: "china_supplier_brief", confirmNotes: "请核对：仅公开/招标确认项可发给国内厂家；默认不含估值与内部成本。" });
    ok(rTech.status === 400 && rTech.json.errorCode === "DOC_TYPE_RETIRED" && rTech.json.error === "「供应商技术确认表」已停用，请改用「供应商询价单 PDF」。之前生成的文件仍可在列表里打开、下载。", "tech_confirm → 400 DOC_TYPE_RETIRED 与指路的说明", rTech);
    ok([rBrief, rBriefGen].every((r) => r.status === 400 && r.json.errorCode === "DOC_TYPE_RETIRED" && r.json.error === "「国内供应商简报」已停用，请改用「供应商询价单 PDF」。之前生成的文件仍可在列表里打开、下载。" && !("previewText" in r.json) && !r.json.document), "china_supplier_brief（预览与生成）→ 400 DOC_TYPE_RETIRED，不返回任何简报文字", rBrief);
    ok(same(await counts(pRet), cRet) && renders === rendersBefore, "已停用的类型：不生成任何内容，不写文件与记录");
    const rNope = await post(pRet, { docType: "nope" });
    const rEmpty = await post(pRet, {});
    const rNull = await post(pRet, null);
    const rArray = await post(pRet, { docType: ["tech_confirm"] });
    ok([rNope, rEmpty, rNull, rArray].every((r) => r.status === 400 && r.json.error === "docType 无效" && r.json.errorCode === undefined) && same([...(rNope.json.allowed ?? [])].sort(), ["analyst_memo", "bid_draft", "internal_analysis", "owner_clarification", "supplier_rfq", "teammate_tasks"]), "不认识的类型、空对象、JSON null、docType 不是字符串 → 400「docType 无效」，可用类型里没有已停用的两类", [rNope, rEmpty, rNull, rArray].map((r) => [r.status, r.json.error]));
    const listed = await list(pRet);
    const listedIds = listed.json.documents.map((d) => d.id);
    ok(listed.status === 200 && listedIds.includes(oldTech.id) && listedIds.includes(oldBrief.id) && listed.json.documents.find((d) => d.id === oldTech.id)?.title === "供应商技术确认表 v1" && listed.json.documents.every((d) => !!d.fileUrl), "列表里仍有之前生成的两类旧记录，标题不变、带文件地址", listed.json.documents.map((d) => [d.docType, d.title]));
    const listedV2 = await list(pV2);
    ok(listedV2.json.documents.length === 3 && listedV2.json.documents.some((d) => d.title === "国内供应商询价 v1"), "旧版询价文件的记录也仍在列表里");
    const briefListed = listed.json.documents.find((d) => d.id === oldBrief.id);
    ok(briefListed?.title === "China Supplier Sourcing Brief v1" && briefListed.fileUrl === "/api/files/blob?pathname=old-china_supplier_brief.pdf" && listed.json.documents.find((d) => d.id === oldTech.id)?.fileUrl === "/api/files/blob?pathname=old-tech_confirm.pdf", "旧记录的标题与文件地址原样不变", listed.json.documents.map((d) => [d.title, d.fileUrl]));

    // —— 10. Chromium 不可用（真实生成函数）：供应商询价单不保存；内部文件照旧回落成 HTML ——
    __setRfqAttachmentPdfRendererForTest(null);
    process.env.CHROME_EXECUTABLE_PATH = "/nonexistent/chrome-for-rfq-sheet-test";
    const pFall = await mkProject({ name: "Fixture Fallback", reqs: BASE_REQS });
    const cFall = await counts(pFall);
    const rSheetNoChrome = await post(pFall, { docType: "supplier_rfq" });
    ok(rSheetNoChrome.status === 503 && rSheetNoChrome.json.errorCode === "RFQ_SHEET_RENDER_FAILED" && same(await counts(pFall), cFall), "Chromium 不可用：供应商询价单 → 503，不保存、不回落 HTML", rSheetNoChrome);
    const rTasks = await post(pFall, { docType: "teammate_tasks" });
    const tasksMeta = JSON.parse(rTasks.json.document?.metaJson ?? "{}") as Record<string, unknown>;
    const tasksFile = (await fileDocs(pFall))[0];
    ok(rTasks.status === 200 && String(tasksMeta.renderMode).startsWith("html_fallback:") && tasksMeta.projectName === "Fixture Fallback" && tasksFile?.fileType === "html" && rTasks.json.document?.title === "同事执行任务单 v1" && blobFiles().some((f) => f.includes(pFall) && f.endsWith(".html")), "Chromium 不可用：同事任务单照旧存成 HTML 并标注降级原因", { status: rTasks.status, meta: tasksMeta, file: tasksFile?.fileType });
  } finally {
    __setRfqAttachmentPdfRendererForTest(null);
    const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    restore("PRODUCT_CONTENT_LOCAL_STORE", prevEnv.store);
    restore("PRODUCT_CONTENT_LOCAL_STORE_DIR", prevEnv.dir);
    restore("CHROME_EXECUTABLE_PATH", prevEnv.chrome);
    restore("TENDER_RFQ_ATTACHMENT_ENABLED", prevEnv.flag);
    restore("TENDER_RFQ_ATTACHMENT_ORG_ALLOWLIST", prevEnv.allow);
    restore("TENDER_RFQ_FROM_NAME", prevEnv.fromName);
    restore("TENDER_RFQ_FROM_EMAIL", prevEnv.fromEmail);
    restore("TENDER_RFQ_MAILBOX_EMAIL", prevEnv.mailbox);
    rmSync(blobDir, { recursive: true, force: true });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG_BARE] } }, { userId: OWNER }] } });
    await db.pendingAction.deleteMany({ where: { orgId: { in: [ORG, ORG_BARE] } } });
    await db.notification.deleteMany({ where: { orgId: { in: [ORG, ORG_BARE] } } }).catch(() => undefined);
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: projectIds } } } });
    await db.projectInquiry.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectGeneratedDocument.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectDocument.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.task.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => undefined);
    await db.tenderExtractedRequirement.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.supplier.deleteMany({ where: { orgId: ORG } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.emailProvider.deleteMany({ where: { userId: OWNER } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_BARE] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_BARE] } } });
    await db.user.deleteMany({ where: { id: OWNER } });
    await db.$disconnect();
  }
  console.log(`RFQ-PDF-1 rfq sheet download DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
