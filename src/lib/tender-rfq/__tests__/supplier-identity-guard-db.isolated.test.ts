/**
 * CHAIN-4b 询价不再带出招标身份——真实 DB（隔离库）端到端
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-rfq/__tests__/supplier-identity-guard-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 供应商）；发信函数一律是注入的假函数。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 CHAIN-4b 询价身份防护 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "CHAIN-4b supplier identity guard DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { rejectApprovalItem } = await import("@/lib/approval/port");
  const { loadProjectIdentity } = await import("@/lib/bid-workflow/project-identity-sources");
  const { normalizeIdentityText } = await import("@/lib/bid-workflow/project-identity-deny");
  const { execTenderSendRfq } = await import("../execute");
  const { hashRfqPayloadItems } = await import("../round-pure");
  const { TENDER_SEND_RFQ_TYPE } = await import("../types");
  type Payload = import("../types").TenderSendRfqPayload;
  const roundsRoute = await import("@/app/api/projects/[id]/tender-rfq/rounds/route");

  console.log("CHAIN-4b supplier identity guard — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `igowner_${stamp}`, ORG = `igorg_${stamp}`;
  const email = (id: string) => `${id}@fixture.test`;
  const MAILBOX = `mailbox_${stamp}@fixture.test`;

  await db.user.create({ data: { id: OWNER, email: email(OWNER), name: "Fixture Owner", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Buyer Inc.", code: `sunny-${stamp}`, ownerId: OWNER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.emailProvider.create({ data: { userId: OWNER, type: "gmail", accessToken: "fixture", accountEmail: MAILBOX, grantedScopes: "gmail.compose gmail.readonly" } });
  await db.organization.update({ where: { id: ORG }, data: { settingsJson: { timezone: "America/Toronto", tenderRfq: { fromName: "Fixture Purchasing", fromEmail: MAILBOX, mailboxEmail: MAILBOX } } } });
  const suppliers = [];
  for (const n of ["A", "B", "C"]) {
    suppliers.push(await db.supplier.create({ data: { orgId: ORG, name: `Fixture Supplier ${n} ${stamp}`, contactEmail: `sales-${n.toLowerCase()}-${stamp}@supplier.test`, status: "active", createdById: OWNER } }));
  }
  const supplierIds = suppliers.map((s) => s.id);

  const projectIds: string[] = [];
  let seq = 0;
  /** 投标项目 + 一份已批准的分析（关键事实槽为文本）+ 已确认的要求 */
  async function mkProject(o: {
    name: string;
    solicitationNumber?: string | null;
    clientOrganization?: string | null;
    closeDate?: Date | null;
    criticalFacts?: Record<string, unknown>;
    reqs: Array<{ category: string; text: string }>;
  }) {
    seq += 1;
    const projectId = `igproj_${stamp}_${seq}`;
    projectIds.push(projectId);
    await db.project.create({
      data: {
        id: projectId, name: o.name, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched",
        solicitationNumber: o.solicitationNumber ?? null, clientOrganization: o.clientOrganization ?? null,
        closeDate: o.closeDate ?? new Date("2026-12-05T19:00:00Z"), createdAt: new Date("2026-03-01T12:00:00Z"),
      },
    });
    const run = await db.tenderAnalysisRun.create({
      data: { orgId: ORG, projectId, status: "APPROVED", idempotencyKey: `ig-${stamp}-${seq}`, sourceHashFingerprint: "fixture", createdById: OWNER, summaryJson: { criticalFacts: o.criticalFacts ?? {} } },
    });
    for (const [i, r] of o.reqs.entries()) {
      await db.tenderExtractedRequirement.create({
        data: { projectId, analysisRunId: run.id, requirementCode: `R-${String(i + 1).padStart(3, "0")}`, category: r.category, originalRequirement: r.text, chineseTranslation: `示例要求 ${i + 1}`, mandatory: true, reviewStatus: "CONFIRMED" },
      });
    }
    return projectId;
  }
  const rounds = (projectId: string) => db.projectInquiry.findMany({ where: { projectId }, include: { items: true } });
  const cards = (projectId: string) => db.pendingAction.findMany({ where: { orgId: ORG, projectId, type: TENDER_SEND_RFQ_TYPE }, orderBy: { createdAt: "asc" } });
  const cookie = `qy_session=${await createSession({ sub: OWNER, email: email(OWNER), role: "user" })}`;
  const postRound = async (projectId: string, body: Record<string, unknown> = {}) => {
    const req = new NextRequest(`http://localhost/api/projects/${projectId}/tender-rfq/rounds`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ supplierIds, incoterm: "DDP", ...body }) });
    const res = await roundsRoute.POST(req, { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, json: (await res.json()) as { ok?: boolean; errorCode?: string; userMessage?: { message: string; action: unknown } } };
  };
  const sends: unknown[] = [];
  const fakeSend = (async (_u: string, m: unknown) => { sends.push(m); return { messageId: `m_${sends.length}`, threadId: `t_${sends.length}_${stamp}` }; }) as never;

  const FED_LOCATION = "Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9";
  try {
    // —— 1. 联邦标：读出的禁出清单（任务 1.2 的 verify）——
    const pFed = await mkProject({
      name: "Sleeping Bags and Mats",
      solicitationNumber: "24062-27-057",
      clientOrganization: "Treasury Board of Canada Secretariat",
      criticalFacts: { location: { status: "KNOWN", text: FED_LOCATION }, buyer: { status: "KNOWN", text: "Treasury Board of Canada Secretariat" } },
      reqs: [
        { category: "PRODUCT", text: "Bags shall be rated to -20C; mats shall have R-value of at least 4." },
        { category: "DELIVERY", text: "Delivery within 30 days of contract award." },
      ],
    });
    const fedId = await loadProjectIdentity(pFed);
    const has = (cat: string, raw: string) => !!fedId?.denyList.entries.some((e) => e.category === cat && e.normalized === normalizeIdentityText(raw));
    ok(!!fedId && has("tender_number", "24062-27-057") && has("buyer_name", "Treasury Board of Canada Secretariat") && has("close_date", "2026-12-05") && has("close_date", "December 5, 2026")
      && has("delivery_address", "K1A 0K9") && has("delivery_address", "K1A0K9") && has("delivery_address", "2 Constellation Crescent") && has("delivery_address", FED_LOCATION) && has("project_name", "Sleeping Bags and Mats"),
      "加载器读出联邦标的五类词条（项目字段 + 分析关键事实，截标日期按组织时区）", fedId?.denyList.entries);
    ok(!!fedId && /^RFQ-SUNNY-2026-[0-9A-HJKMNP-TV-Z]{5}$/.test(fedId.reference), "询价编号取组织代码第一段、项目创建年份", fedId?.reference);

    // —— 2. 经真实路由送审：标题与正文不带身份 ——
    const r1 = await postRound(pFed);
    const fedCards = await cards(pFed);
    const p1 = fedCards[0]?.payload as unknown as Payload | undefined;
    ok(r1.status === 200 && r1.json.ok === true && fedCards.length === 1 && !!p1, "联邦标送审成功：一张待批卡", r1.json);
    const all1 = (p1?.items ?? []).map((i) => `${i.subject}\n${i.body}`).join("\n---\n");
    ok(!!p1 && p1.items.length === 3 && p1.items.every((i) => i.subject.startsWith(`询价 ${fedId?.reference}（第 1 轮）`)), "标题以「询价 RFQ-SUNNY-2026-…（第 1 轮）」开头", p1?.items.map((i) => i.subject));
    ok(!!p1 && !["24062-27-057", "Treasury Board", "Sleeping Bags and Mats", "2026-12-05"].some((t) => all1.includes(t)), "标题与正文不含编号、采购方、项目名称、截标日期", all1.slice(0, 600));
    ok(!!p1 && all1.includes("目的地 Ottawa, ON") && !all1.includes("Constellation") && !all1.includes("K1A"), "目的地只写城市, 省，不写街道与邮编");
    ok(p1?.identityGuard === 1, "载荷带防护标记");
    const fedRounds = await rounds(pFed);
    ok(fedRounds.length === 1 && fedRounds[0].items.every((i) => i.status === "pending" && i.sentAt === null) && sends.length === 0, "送审零出站：询价项都是待发");

    // —— 3. 第 2 轮编号不变；另一个项目编号不同 ——
    const rej = await rejectApprovalItem("pending_action", fedCards[0].id, { userId: OWNER, role: "org_admin", orgId: ORG });
    const r2 = await postRound(pFed);
    const p2 = (await cards(pFed))[1]?.payload as unknown as Payload | undefined;
    ok(rej.ok && r2.status === 200 && !!p2 && p2.roundNumber === 2 && p2.items.every((i) => i.subject.startsWith(`询价 ${fedId?.reference}（第 2 轮）`)), "驳回第 1 轮后起草第 2 轮：询价编号相同", { r2: r2.json, subj: p2?.items[0]?.subject });
    ok((await loadProjectIdentity(pFed))?.reference === fedId?.reference, "生成文件用的编号（同一加载器）与邮件里的相同");

    // —— 4. 要求里写了采购方名称：422，零轮次零卡 ——
    const pCity = await mkProject({
      name: "Fixture Shelving",
      clientOrganization: "City of Ottawa",
      reqs: [
        { category: "PRODUCT", text: "Steel shelving, 5 tiers." },
        { category: "DELIVERY", text: "Deliver to the City of Ottawa warehouse." },
      ],
    });
    ok((await loadProjectIdentity(pCity))?.reference !== fedId?.reference, "另一个项目的询价编号不同");
    const r4 = await postRound(pCity);
    ok(r4.status === 422 && r4.json.errorCode === "IDENTITY_LEAK" && (r4.json.userMessage?.message ?? "").includes("命中：采购方名称·要求 R-002") && !(r4.json.userMessage?.message ?? "").includes("City of Ottawa"), "要求含采购方名称 → 422 IDENTITY_LEAK，说明写类别与位置、不复述原文", r4);
    ok((await rounds(pCity)).length === 0 && (await cards(pCity)).length === 0, "命中时不建轮次、不建审批卡");
    const pAddr = await mkProject({
      name: "Fixture Cots",
      criticalFacts: { location: { status: "KNOWN", text: FED_LOCATION } },
      reqs: [{ category: "PRODUCT", text: "Folding cots, aluminium frame." }],
    });
    const r4b = await postRound(pAddr, { destination: "2 Constellation Crescent, Ottawa" });
    ok(r4b.status === 422 && r4b.json.errorCode === "IDENTITY_LEAK" && (r4b.json.userMessage?.message ?? "").startsWith("你填的目的地里含招标身份信息") && r4b.json.userMessage?.action === null, "目的地照抄精确地址 → 指明是自己填的目的地、没有出路链接", r4b);

    // —— 5. 发送前复核：上线前起草的卡（无标记）拒发 ——
    const pExec = await mkProject({
      name: "Fixture Tents",
      reqs: [{ category: "PRODUCT", text: "Tent fabric per spec ABC-123456, 4-season." }],
    });
    const r5 = await postRound(pExec);
    const card5 = (await cards(pExec))[0];
    const payload5 = card5?.payload as unknown as Payload;
    ok(r5.status === 200 && payload5?.identityGuard === 1, "无身份命中的项目照常送审", r5.json);
    const { identityGuard: _drop, ...unguarded } = payload5;
    void _drop;
    const ex5 = await execTenderSendRfq(unguarded as Payload, { userId: OWNER, role: "user", orgId: ORG }, { send: fakeSend });
    ok(!ex5.ok && ex5.errorCode === "RFQ_IDENTITY_UNGUARDED" && (ex5.error ?? "").includes("请驳回后重新起草") && sends.length === 0, "没有防护标记的卡：RFQ_IDENTITY_UNGUARDED，发信 0 次", ex5);
    ok((await rounds(pExec))[0]?.items.every((i) => i.status === "pending"), "拒发后询价项状态不动");

    // —— 6. 起草之后项目补填了招标编号，正好出现在要求里：整张卡拒发 ——
    await db.project.update({ where: { id: pExec }, data: { solicitationNumber: "ABC-123456" } });
    const ex6 = await execTenderSendRfq(payload5, { userId: OWNER, role: "user", orgId: ORG }, { send: fakeSend });
    ok(!ex6.ok && ex6.errorCode === "RFQ_IDENTITY_LEAK" && (ex6.error ?? "").includes("招标编号") && (ex6.error ?? "").includes("第 2 家") && !(ex6.error ?? "").includes("ABC-123456") && sends.length === 0, "资料变化后复查命中：RFQ_IDENTITY_LEAK，写明类别与第几家、不复述原文，发信 0 次", ex6);
    ok((await rounds(pExec))[0]?.items.every((i) => i.status === "pending"), "拒发后询价项状态仍不动");

    // —— 7. 有标记、复查干净：照常发出 ——
    await db.project.update({ where: { id: pExec }, data: { solicitationNumber: null } });
    const ex7 = await execTenderSendRfq(payload5, { userId: OWNER, role: "user", orgId: ORG }, { send: fakeSend });
    ok(ex7.ok && sends.length === 3 && (await rounds(pExec))[0]?.items.every((i) => i.status !== "pending"), "有标记且复查干净：3 家照常发出", ex7);
    ok(hashRfqPayloadItems(payload5.items) === payload5.rfqDocHash, "防护标记不进内容哈希（哈希只管邮件内容）");
  } finally {
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: OWNER }] } });
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
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: OWNER } });
    await db.$disconnect();
  }
  console.log(`CHAIN-4b supplier identity guard DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
