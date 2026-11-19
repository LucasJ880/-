/**
 * CHAIN-4a 询价 PDF 附件——真实 DB（隔离库）端到端：起草 / 执行核对 / 卡上提示 / 预览
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-rfq/__tests__/attachment-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture；PDF 生成函数与发信函数一律是注入的假函数（不启动 Chromium、不发信）。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 CHAIN-4a 询价附件 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "CHAIN-4a rfq attachment DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

async function main() {
  const { createHash } = await import("node:crypto");
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { execTenderSendRfq, RFQ_ATTACHMENT_SENT_AUDIT_ACTION } = await import("../execute");
  const { hashRfqPayloadItems } = await import("../round-pure");
  const { prepareRfqRound } = await import("../service");
  const { __setRfqAttachmentPdfRendererForTest, rebuildRfqAttachment } = await import("../attachment-service");
  const { loadRfqSendEmails } = await import("../web-entry-approval");
  const { TENDER_SEND_RFQ_TYPE } = await import("../types");
  type Payload = import("../types").TenderSendRfqPayload;
  const roundsRoute = await import("@/app/api/projects/[id]/tender-rfq/rounds/route");
  const previewRoute = await import("@/app/api/projects/[id]/tender-rfq/attachment/route");

  console.log("CHAIN-4a rfq attachment — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `atowner_${stamp}`, ORG = `atorg_${stamp}`, OUTSIDER = `atout_${stamp}`, ORG2 = `atorg2_${stamp}`;
  const email = (id: string) => `${id}@fixture.test`;
  const MAILBOX = `mailbox_${stamp}@fixture.test`;

  await db.user.create({ data: { id: OWNER, email: email(OWNER), name: "Fixture Owner", role: "user" } });
  await db.user.create({ data: { id: OUTSIDER, email: email(OUTSIDER), name: "Fixture Outsider", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Buyer Inc.", code: `sunny-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG2, name: "Other Org", code: `other-${stamp}`, ownerId: OUTSIDER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OUTSIDER, role: "org_admin", status: "active" } });
  await db.emailProvider.create({ data: { userId: OWNER, type: "gmail", accessToken: "fixture", accountEmail: MAILBOX, grantedScopes: "gmail.compose gmail.readonly" } });
  await db.organization.update({ where: { id: ORG }, data: { settingsJson: { timezone: "America/Toronto", tenderRfq: { fromName: "Fixture Purchasing", fromEmail: MAILBOX, mailboxEmail: MAILBOX } } } });
  const suppliers = [];
  for (const n of ["A", "B", "C"]) {
    suppliers.push(await db.supplier.create({ data: { orgId: ORG, name: `Fixture Supplier ${n} ${stamp}`, contactEmail: `sales-${n.toLowerCase()}-${stamp}@supplier.test`, status: "active", createdById: OWNER } }));
  }
  const supplierIds = suppliers.map((s) => s.id);

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(o: { name: string; solicitationNumber?: string | null; clientOrganization?: string | null; criticalFacts?: Record<string, unknown>; reqs: Array<{ category: string; text: string; zh?: string }> }) {
    seq += 1;
    const projectId = `atproj_${stamp}_${seq}`;
    projectIds.push(projectId);
    await db.project.create({
      data: {
        id: projectId, name: o.name, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched",
        solicitationNumber: o.solicitationNumber ?? null, clientOrganization: o.clientOrganization ?? null,
        closeDate: new Date("2026-12-05T19:00:00Z"), createdAt: new Date("2026-03-01T12:00:00Z"),
      },
    });
    const run = await db.tenderAnalysisRun.create({
      data: { orgId: ORG, projectId, status: "APPROVED", idempotencyKey: `at-${stamp}-${seq}`, sourceHashFingerprint: "fixture", createdById: OWNER, summaryJson: { criticalFacts: o.criticalFacts ?? {} } },
    });
    for (const [i, r] of o.reqs.entries()) {
      await db.tenderExtractedRequirement.create({
        data: { projectId, analysisRunId: run.id, requirementCode: `R-${String(i + 1).padStart(3, "0")}`, category: r.category, originalRequirement: r.text, chineseTranslation: r.zh ?? `示例要求 ${i + 1}`, mandatory: true, reviewStatus: "CONFIRMED" },
      });
    }
    return projectId;
  }
  const rounds = (projectId: string) => db.projectInquiry.findMany({ where: { projectId }, include: { items: true } });
  const cards = (projectId: string) => db.pendingAction.findMany({ where: { orgId: ORG, projectId, type: TENDER_SEND_RFQ_TYPE }, orderBy: { createdAt: "asc" } });
  const cookieOf = async (id: string) => `qy_session=${await createSession({ sub: id, email: email(id), role: "user" })}`;
  const cookie = await cookieOf(OWNER);
  const postRound = async (projectId: string) => {
    const req = new NextRequest(`http://localhost/api/projects/${projectId}/tender-rfq/rounds`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ supplierIds, incoterm: "DDP" }) });
    const res = await roundsRoute.POST(req, { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, json: (await res.json()) as { ok?: boolean; errorCode?: string; userMessage?: { message: string; action: unknown } } };
  };
  const getPreview = async (projectId: string, actionId: string, who: string | null = cookie) => {
    const req = new NextRequest(`http://localhost/api/projects/${projectId}/tender-rfq/attachment?actionId=${encodeURIComponent(actionId)}`, { headers: who ? { cookie: who } : {} });
    const res = await previewRoute.GET(req, { params: Promise.resolve({ id: projectId }) });
    return res;
  };
  const sends: Array<{ attachments?: Array<{ filename: string; mimeType: string; data: Buffer }> }> = [];
  const fakeSend = (async (_u: string, m: unknown) => { sends.push(m as never); return { messageId: `m_${sends.length}`, threadId: `t_${sends.length}_${stamp}` }; }) as never;
  const FONT = "<</Type /Font /BaseFont /AAAAAA+NotoSansSC-Regular>>";
  let renders = 0;
  const renderedHtml: string[] = [];
  const okRenderer = async (html: string) => { renders += 1; renderedHtml.push(html); return Buffer.from(`%PDF-1.7\n${FONT}\n1 0 obj <</Type /Page>> endobj\n2 0 obj <</Type /Page>> endobj\n% ${createHash("sha256").update(html).digest("hex")}\n%%EOF`, "latin1"); };
  const ctx = { userId: OWNER, role: "user", orgId: ORG };
  const FED_LOCATION = "Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9";
  const fedProject = () => mkProject({
    name: "Sleeping Bags and Mats",
    solicitationNumber: "24062-27-057",
    clientOrganization: "Treasury Board of Canada Secretariat",
    criticalFacts: { location: { status: "KNOWN", text: FED_LOCATION } },
    reqs: [
      { category: "PRODUCT", text: "Bags shall be rated to -20C; mats shall have R-value of at least 4.", zh: "睡袋须达到 -20°C；睡垫 R 值不低于 4。" },
      { category: "DELIVERY", text: "Delivery within 30 days of contract award.", zh: "合同授予后 30 天内交付。" },
    ],
  });

  try {
    // —— 1. 开关关闭：载荷、哈希、正文与本功能之前相同 ——
    delete process.env.TENDER_RFQ_ATTACHMENT_ENABLED;
    __setRfqAttachmentPdfRendererForTest(okRenderer);
    const pOff = await fedProject();
    const rOff = await postRound(pOff);
    const pay0 = (await cards(pOff))[0]?.payload as unknown as Payload | undefined;
    ok(rOff.status === 200 && !!pay0 && !("attachment" in pay0) && pay0.rfqDocHash === hashRfqPayloadItems(pay0.items) && pay0.items.every((i) => !i.body.includes("附件《")) && renders === 0, "开关关闭：载荷没有附件字段、哈希只按邮件算、正文没有附件那一句、没有生成 PDF", rOff.json);

    // —— 2. 开关打开：送审带附件 ——
    process.env.TENDER_RFQ_ATTACHMENT_ENABLED = "1";
    process.env.TENDER_RFQ_ATTACHMENT_ORG_ALLOWLIST = ORG;
    const pFed = await fedProject();
    const r1 = await postRound(pFed);
    const card1 = (await cards(pFed))[0];
    const p1 = card1?.payload as unknown as Payload | undefined;
    const a1 = p1?.attachment;
    ok(r1.status === 200 && !!a1 && renders === 1, "开关打开：送审成功，起草时生成了一次 PDF", r1.json);
    ok(!!a1 && a1.filename.startsWith("询价单-RFQ-SUNNY-2026-") && a1.filename.endsWith(".pdf") && a1.pages === 2 && a1.sizeBytes > 0 && /^[0-9a-f]{64}$/.test(a1.contentHash) && a1.templateVersion === 1 && a1.draft.reference === a1.filename.slice(4, -4), "载荷记文件名、页数、字节数、内容指纹、版式版本与起草参数", a1);
    ok(!!a1 && JSON.stringify(a1).length < 4096 && !/%PDF|JVBER/.test(JSON.stringify(p1)), "载荷里没有 PDF 字节（附件字段不到 4 KB）", JSON.stringify(a1 ?? {}).length);
    ok(!!p1 && !!a1 && p1.rfqDocHash === hashRfqPayloadItems(p1.items, a1) && p1.rfqDocHash !== hashRfqPayloadItems(p1.items), "载荷哈希覆盖附件");
    ok(!!p1 && !!a1 && p1.items.length === 3 && p1.items.every((i) => i.body.includes(`附件《${a1.filename}》是上面清单的表格版`)), "每一家正文都有附件那一句");
    ok((card1?.preview ?? "").includes(`附件：${a1?.filename}（2 页，`), "卡摘要多一行附件", card1?.preview);
    const html1 = renderedHtml[0] ?? "";
    ok(html1.length > 0 && !["24062-27-057", "Treasury Board", "Sleeping Bags and Mats", "2026-12-05", "Constellation", "K1A", "Fixture Supplier"].some((t) => html1.includes(t)) && html1.includes("Ottawa, ON"), "联邦标的附件不含编号、采购方、项目名称、截标日期、精确地址与供应商名称；目的地为 Ottawa, ON");

    // —— 3. 卡上：附件与预览链接；预览 ——
    const emails1 = (await loadRfqSendEmails(ORG, [card1.id]))[card1.id] ?? [];
    ok(emails1.length === 3 && emails1.every((e) => e.attachment?.filename === a1?.filename && e.attachment.previewHref === `/api/projects/${pFed}/tender-rfq/attachment?actionId=${card1.id}` && e.attachment.stale === null), "读卡：每封预览带附件与预览链接，内容一致（stale 为空）", emails1[0]);
    const pv = await getPreview(pFed, card1.id);
    const pvBody = Buffer.from(await pv.arrayBuffer());
    ok(pv.status === 200 && pv.headers.get("content-type") === "application/pdf" && (pv.headers.get("content-disposition") ?? "").startsWith("inline;") && pv.headers.get("cache-control") === "private, no-store" && pvBody.subarray(0, 5).toString("latin1") === "%PDF-", "预览：200、application/pdf、inline、不缓存", pv.status);
    ok((await cards(pFed))[0]?.status === "pending" && (await rounds(pFed))[0]?.items.every((i) => i.status === "pending") && sends.length === 0, "预览不改卡与询价项、不发信");
    const pvOther = await getPreview(pFed, card1.id, await cookieOf(OUTSIDER));
    const pvWrong = await getPreview(pOff, card1.id);
    const pvNoAtt = await getPreview(pOff, (await cards(pOff))[0].id);
    ok(pvOther.status === 404 && pvWrong.status === 404 && pvNoAtt.status === 404, "别的组织的人 / 卡不是这个项目的 / 卡上没有附件 → 都是 404", [pvOther.status, pvWrong.status, pvNoAtt.status]);
    const bodies404 = await Promise.all([pvOther, pvWrong, pvNoAtt].map((r) => r.text()));
    ok(bodies404.every((b) => b === bodies404[0] && b.includes("没有找到这份询价单 PDF")) && pvWrong.headers.get("content-type")?.startsWith("text/html"), "三种 404 回同一页中文说明（新标签页里不是 JSON）");
    const pvAnon = await getPreview(pFed, card1.id, null);
    ok(pvAnon.status === 401 && (await pvAnon.text()).includes("请先登录青砚"), "没登录：401，中文说明");

    // —— 4. 执行：每封带同一份 PDF，审计一条 ——
    const ex1 = await execTenderSendRfq(p1!, ctx, { send: fakeSend });
    ok(ex1.ok && sends.length === 3 && sends.every((m) => m.attachments?.length === 1 && m.attachments[0].mimeType === "application/pdf" && m.attachments[0].filename === a1?.filename), "执行：3 家各一封，每封带一个 application/pdf 附件、文件名同载荷", ex1);
    const pdfSha = createHash("sha256").update(sends[0].attachments![0].data).digest("hex");
    ok(sends.every((m) => createHash("sha256").update(m.attachments![0].data).digest("hex") === pdfSha), "三封带的是同一份 PDF");
    const audits = await db.auditLog.findMany({ where: { orgId: ORG, action: RFQ_ATTACHMENT_SENT_AUDIT_ACTION, targetId: p1!.inquiryId } });
    const rawAd = audits[0]?.afterData;
    const ad = (typeof rawAd === "string" ? JSON.parse(rawAd) : rawAd) as Record<string, unknown> | undefined; // AuditLog.afterData 存的是 JSON 字符串
    ok(audits.length === 1 && ad?.pdfSha256 === pdfSha && ad?.contentHash === a1?.contentHash && ad?.sentCount === 3 && ad?.filename === a1?.filename && !JSON.stringify(ad).includes("%PDF"), "审计一条：PDF 字节 SHA-256 与实际发出的相符，不记内容", ad);
    ok(ad?.pages === 2 && ad?.sizeBytes === sends[0].attachments![0].data.length && ad?.roundNumber === 1, "审计的页数、字节数取实际发出的那份；记轮次号", ad);
    const rendersBefore = renders;
    const ex1b = await execTenderSendRfq(p1!, ctx, { send: fakeSend });
    ok(sends.length === 3 && renders === rendersBefore && (ex1b.message ?? "").includes("此前已发") && (await db.auditLog.count({ where: { orgId: ORG, action: RFQ_ATTACHMENT_SENT_AUDIT_ACTION } })) === 1, "重放：不再生成 PDF、不再发、不再记审计", ex1b);
    const pvDone = await getPreview(pFed, card1.id);
    await db.pendingAction.update({ where: { id: card1.id }, data: { status: "executed" } });
    const pvDone2 = await getPreview(pFed, card1.id);
    ok(pvDone2.status === 410 && (await pvDone2.text()).includes("这张卡已经处理过"), "已处理过的卡：410，不再预览", [pvDone.status, pvDone2.status]);

    // —— 5. 起草后改了一条要求：卡上提前说、预览 409、执行拒发 ——
    const pChg = await fedProject();
    await postRound(pChg);
    const card2 = (await cards(pChg))[0];
    const p2 = card2.payload as unknown as Payload;
    await db.tenderExtractedRequirement.updateMany({ where: { projectId: pChg, requirementCode: "R-001" }, data: { chineseTranslation: "睡袋须达到 -25°C（改）" } });
    const emails2 = (await loadRfqSendEmails(ORG, [card2.id]))[card2.id] ?? [];
    ok(emails2.every((e) => e.attachment?.stale === "changed"), "读卡：内容在起草后变了 → stale = changed（面板据此不给批准）", emails2[0]?.attachment);
    const pv2 = await getPreview(pChg, card2.id);
    const pv2t = await pv2.text();
    ok(pv2.status === 409 && pv2t.includes("询价单 PDF 和现在对不上") && pv2t.includes("请点「驳回」"), "预览：409，说明起草后资料有改动、请驳回", pv2t.slice(0, 300));
    const before = sends.length;
    const ex2 = await execTenderSendRfq(p2, ctx, { send: fakeSend });
    ok(!ex2.ok && ex2.errorCode === "RFQ_ATTACHMENT_CHANGED" && (ex2.error ?? "").includes("一封都没有发") && (ex2.error ?? "").includes("请重新「问供应商要价」") && sends.length === before, "执行：RFQ_ATTACHMENT_CHANGED，发信 0 次", ex2);
    ok((await rounds(pChg))[0]?.items.every((i) => i.status === "pending"), "拒发后询价项仍为待发");

    // —— 6. 版式版本不同：按「系统更新了版式」拒发 ——
    await db.tenderExtractedRequirement.updateMany({ where: { projectId: pChg, requirementCode: "R-001" }, data: { chineseTranslation: "睡袋须达到 -20°C；睡垫 R 值不低于 4。" } });
    const rb = await rebuildRfqAttachment(p2, p2.attachment!);
    ok(rb.ok, "改回原样后重排一致", rb);
    const ex3 = await execTenderSendRfq({ ...p2, attachment: { ...p2.attachment!, templateVersion: 0 } }, ctx, { send: fakeSend });
    ok(!ex3.ok && ex3.errorCode === "RFQ_ATTACHMENT_TEMPLATE_CHANGED" && (ex3.error ?? "").includes("系统升级了询价单 PDF 的格式") && sends.length === before, "旧版式起草的卡：RFQ_ATTACHMENT_TEMPLATE_CHANGED，发信 0 次", ex3);
    const { contentHash: _ch, ...noHash } = p2.attachment!;
    void _ch;
    const ex3a = await execTenderSendRfq({ ...p2, attachment: noHash as never }, ctx, { send: fakeSend });
    ok(!ex3a.ok && ex3a.errorCode === "RFQ_PAYLOAD_INVALID" && sends.length === before, "附件字段缺内容指纹：RFQ_PAYLOAD_INVALID，不当作不带附件发出", ex3a);
    const { attachment: _a, ...stripped } = p2;
    void _a;
    const ex3b = await execTenderSendRfq(stripped as Payload, ctx, { send: fakeSend });
    ok(!ex3b.ok && ex3b.errorCode === "RFQ_PAYLOAD_TAMPERED" && sends.length === before, "把附件从载荷里去掉：哈希对不上，拒发");

    // —— 7. 执行时 PDF 生成失败 ——
    __setRfqAttachmentPdfRendererForTest(async () => { throw new Error("chromium exploded at /var/task/x.js"); });
    const ex4 = await execTenderSendRfq(p2, ctx, { send: fakeSend });
    ok(!ex4.ok && ex4.errorCode === "RFQ_ATTACHMENT_FAILED" && !(ex4.error ?? "").includes("chromium") && sends.length === before, "执行时 PDF 生成失败：RFQ_ATTACHMENT_FAILED，不复述异常，发信 0 次", ex4);
    __setRfqAttachmentPdfRendererForTest(async () => Buffer.from("%PDF-1.7\n<</BaseFont /AAAAAA+DejaVuSans>>\n%%EOF"));
    const ex4b = await execTenderSendRfq(p2, ctx, { send: fakeSend });
    ok(!ex4b.ok && ex4b.errorCode === "RFQ_ATTACHMENT_FAILED" && sends.length === before, "PDF 里没有中文字体：当作生成失败，不发");
    ok((await rounds(pChg))[0]?.items.every((i) => i.status === "pending"), "两次失败后询价项仍为待发");

    // —— 8. 起草时生成失败 / 超限：不建轮次、不建卡 ——
    const pFail = await fedProject();
    __setRfqAttachmentPdfRendererForTest(async () => { throw new Error("boom stack trace"); });
    const r5 = await postRound(pFail);
    ok(r5.status === 422 && r5.json.errorCode === "ATTACHMENT_FAILED" && (r5.json.userMessage?.message ?? "").includes("询价单 PDF 没能生成") && !(r5.json.userMessage?.message ?? "").includes("boom") && r5.json.userMessage?.action === null, "起草时生成出错：422 ATTACHMENT_FAILED，说明不含异常原文", r5.json);
    ok((await rounds(pFail)).length === 0 && (await cards(pFail)).length === 0, "零轮次零卡");
    __setRfqAttachmentPdfRendererForTest(async () => Buffer.concat([Buffer.from(`%PDF-1.7\n${FONT}\n`), Buffer.alloc(5 * 1024 * 1024)]));
    const r6 = await postRound(pFail);
    ok(r6.status === 422 && (r6.json.userMessage?.message ?? "").includes("超过 5 MB") && (await rounds(pFail)).length === 0 && (await cards(pFail)).length === 0, "超过 5 MB：422，零轮次零卡", r6.json);
    const muse = await prepareRfqRound({ projectId: pFail, orgId: ORG, userId: OWNER, source: "muse", supplierIds });
    ok(!muse.ok && muse.errorCode === "ATTACHMENT_FAILED" && muse.message.includes("超过 5 MB"), "Muse 入口走同一流程：ATTACHMENT_FAILED，说明同网页（路由落到 VALIDATION_FAILED）", muse);

    // —— 8b. 生成 PDF 那几秒里同一项目被别人建了轮次：建轮次前再查一次锁 ——
    __setRfqAttachmentPdfRendererForTest(okRenderer);
    const pRace = await fedProject();
    let nested: Awaited<ReturnType<typeof prepareRfqRound>> | null = null;
    __setRfqAttachmentPdfRendererForTest(async (html: string) => {
      __setRfqAttachmentPdfRendererForTest(okRenderer);
      nested = await prepareRfqRound({ projectId: pRace, orgId: ORG, userId: OWNER, source: "web", supplierIds, incoterm: "DDP" });
      return okRenderer(html);
    });
    const outer = await prepareRfqRound({ projectId: pRace, orgId: ORG, userId: OWNER, source: "web", supplierIds, incoterm: "DDP" });
    const nestedOk = (nested as { ok?: boolean } | null)?.ok === true;
    ok(nestedOk && !outer.ok && outer.errorCode === "ROUND_LOCKED" && (await rounds(pRace)).length === 1 && (await cards(pRace)).length === 1, "并发起草：后到的一次在建轮次前重查锁，返回 ROUND_LOCKED，只建出一轮一卡", { outer, nestedOk });

    // —— 8c. 读卡：已批准执行中的卡不再核对；命中身份信息给专门的提示 ——
    __setRfqAttachmentPdfRendererForTest(okRenderer);
    const raceCard = (await cards(pRace))[0];
    await db.tenderExtractedRequirement.updateMany({ where: { projectId: pRace, requirementCode: "R-001" }, data: { chineseTranslation: "改过的翻译" } });
    await db.pendingAction.update({ where: { id: raceCard.id }, data: { status: "approved" } });
    const approvedEmails = (await loadRfqSendEmails(ORG, [raceCard.id]))[raceCard.id] ?? [];
    ok(approvedEmails.length === 3 && approvedEmails.every((e) => e.attachment?.stale === null && !!e.attachment.previewHref), "已批准执行中的卡：不再提前核对（已不能驳回），预览链接照给");
    await db.pendingAction.update({ where: { id: raceCard.id }, data: { status: "pending" } });
    await db.tenderExtractedRequirement.updateMany({ where: { projectId: pRace, requirementCode: "R-001" }, data: { chineseTranslation: "睡袋须达到 -20°C；睡垫 R 值不低于 4。", originalRequirement: "Bags shall be rated to -20C; ref ZX-778899." } });
    await db.project.update({ where: { id: pRace }, data: { solicitationNumber: "ZX-778899" } });
    const idEmails = (await loadRfqSendEmails(ORG, [raceCard.id]))[raceCard.id] ?? [];
    ok(idEmails.every((e) => e.attachment?.stale === "identity"), "起草后项目补填的编号出现在要求里：卡上标为命中身份信息", idEmails[0]?.attachment);

    // —— 8d. 执行时附件命中招标身份：起草后确认了一条写着采购方名称的新要求（邮件正文里没有它）——
    const pId = await mkProject({ name: "Fixture Lanterns", clientOrganization: "Northwind Regional Authority", reqs: [{ category: "PRODUCT", text: "LED lantern, 300 lumen.", zh: "LED 营灯，300 流明。" }] });
    await postRound(pId);
    const pIdCard = (await cards(pId))[0]?.payload as unknown as Payload;
    const runId = (await db.tenderAnalysisRun.findFirst({ where: { projectId: pId }, select: { id: true } }))!.id;
    await db.tenderExtractedRequirement.create({ data: { projectId: pId, analysisRunId: runId, requirementCode: "R-009", category: "DELIVERY", originalRequirement: "Deliver to Northwind Regional Authority depot.", chineseTranslation: "交付到指定仓库。", mandatory: true, reviewStatus: "CONFIRMED" } });
    const beforeId = sends.length;
    const exId = await execTenderSendRfq(pIdCard, ctx, { send: fakeSend });
    ok(!exId.ok && exId.errorCode === "RFQ_IDENTITY_LEAK" && (exId.error ?? "").includes("采购方名称") && (exId.error ?? "").includes("一封都没有发") && !(exId.error ?? "").includes("Northwind") && sends.length === beforeId, "执行时附件命中身份：RFQ_IDENTITY_LEAK，写明类别、不复述原文，发信 0 次", exId);

    // —— 8e. 预览：生成失败 503；太频繁 429 ——
    const pPv = await fedProject();
    await postRound(pPv);
    const pvCard = (await cards(pPv))[0];
    __setRfqAttachmentPdfRendererForTest(async () => { throw new Error("chromium down"); });
    const pv503 = await getPreview(pPv, pvCard.id, await cookieOf(OWNER));
    ok(pv503.status === 503 && (await pv503.text()).includes("暂时生成不了") , "预览：PDF 生成失败 503，中文说明");
    __setRfqAttachmentPdfRendererForTest(okRenderer);
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await getPreview(pPv, pvCard.id)).status);
    ok(statuses.includes(429), "预览：同一个人一分钟内打开太多次 → 429", statuses);

    // —— 9. 开关关掉后，已起草的带附件卡照样按卡执行 ——
    __setRfqAttachmentPdfRendererForTest(okRenderer);
    delete process.env.TENDER_RFQ_ATTACHMENT_ENABLED;
    const ex5 = await execTenderSendRfq(p2, ctx, { send: fakeSend });
    ok(ex5.ok && sends.length === before + 3 && sends.slice(before).every((m) => m.attachments?.[0]?.filename === p2.attachment?.filename), "开关关闭后执行已起草的带附件卡：照样核对并带附件发出", ex5);
  } finally {
    __setRfqAttachmentPdfRendererForTest(null);
    delete process.env.TENDER_RFQ_ATTACHMENT_ENABLED;
    delete process.env.TENDER_RFQ_ATTACHMENT_ORG_ALLOWLIST;
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG2] } }, { userId: { in: [OWNER, OUTSIDER] } }] } });
    await db.pendingAction.deleteMany({ where: { orgId: ORG } });
    await db.notification.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: projectIds } } } });
    await db.projectInquiry.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.task.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => undefined);
    await db.tenderExtractedRequirement.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.supplier.deleteMany({ where: { orgId: ORG } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.emailProvider.deleteMany({ where: { userId: OWNER } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } });
    await db.user.deleteMany({ where: { id: { in: [OWNER, OUTSIDER] } } });
    await db.$disconnect();
  }
  console.log(`CHAIN-4a rfq attachment DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
