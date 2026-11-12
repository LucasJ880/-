/**
 * FLOW-H1 项目页「下一步」——真实 DB（隔离库）经真实路由处理函数：一个标从没传文件走到已提交
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/tender-next-step/__tests__/web-next-step-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 供应商）。不发任何邮件、不批准任何卡。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FLOW-H1 下一步 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FLOW-H1 web next step DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 2000) : ""); }
}

type Target = { kind: string; tab?: string; anchor?: string | null; href?: string };
type View = { rule: string; headlineZh: string; reasonsZh: string[]; action: { labelZh: string; target: Target } | null; urgencyZh: string | null; closesAt: string | null; also: Array<{ textZh: string; target: Target }>; actualStage: string; recordedStage: string; shownStage: string };
type Body = { view?: View; error?: string };

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { listApprovalInbox } = await import("@/lib/approval/port");
  const { closedLabelOf, isWon } = await import("../service");
  const { buildFollowUpPolicy } = await import("@/lib/tender-rfq/followup-coverage");
  const { formatChaseNote, chaseTemplateHash } = await import("@/lib/tender-rfq/chase-pure");
  const route = await import("@/app/api/projects/[id]/next-step/route");
  const workspaceRoute = await import("@/app/api/projects/[id]/bid-workspace/route");

  console.log("FLOW-H1 web next step — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `nsowner_${stamp}`, VIEWER = `nsviewer_${stamp}`, ORGMATE = `nsmate_${stamp}`, OUTSIDER = `nsout_${stamp}`;
  const ORG = `nsorg_${stamp}`, ORG_B = `nsorgb_${stamp}`;
  const users = [OWNER, VIEWER, ORGMATE, OUTSIDER];
  const email = (id: string) => `${id}@fixture.test`;
  const DAY = 86_400_000;
  process.env.TENDER_WEB_NEXT_STEP_ENABLED = "1";
  delete process.env.TENDER_WEB_NEXT_STEP_ORG_ALLOWLIST;
  delete process.env.TENDER_SUBMISSION_RECORD_ENABLED;
  delete process.env.TENDER_SUBMISSION_RECORD_ORG_ALLOWLIST;
  delete process.env.TENDER_BID_WORKSPACE_ENABLED;
  delete process.env.TENDER_BID_WORKSPACE_ORG_ALLOWLIST;
  delete process.env.TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED;

  for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
  // 项目负责人的等待天数是 5；看页面的另一个人自己设的是 2
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `ns-${stamp}`, ownerId: OWNER, settingsJson: { museBridge: { userPrefs: { [OWNER]: { defaultSupplierIds: [], defaultIncoterm: null, chaseAfterDays: 5, lastUpdatedAt: null }, [VIEWER]: { defaultSupplierIds: [], defaultIncoterm: null, chaseAfterDays: 2, lastUpdatedAt: null } } } } } });
  await db.organization.create({ data: { id: ORG_B, name: "Other Fixture Org", code: `nsb-${stamp}`, ownerId: OUTSIDER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: VIEWER, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: ORGMATE, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG_B, userId: OUTSIDER, role: "org_admin", status: "active" } });

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(o: { orgId?: string; ownerId?: string; workDomain?: string; closeInDays?: number | null; estimatedValue?: number } = {}) {
    seq += 1;
    const id = `nsproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({
      data: {
        id, name: `Fixture Tender ${stamp}-${seq}`, orgId: o.orgId ?? ORG, ownerId: o.ownerId ?? OWNER, workDomain: o.workDomain ?? "tender", intakeStatus: "dispatched",
        closeDate: o.closeInDays === null ? null : new Date(Date.now() + (o.closeInDays ?? 20) * DAY),
        ...(o.estimatedValue ? { estimatedValue: o.estimatedValue } : {}),
      },
    });
    return id;
  }
  const P = await mkProject({ estimatedValue: 123456.78 });
  await db.projectMember.create({ data: { projectId: P, userId: VIEWER, role: "viewer", status: "active" } });
  const supplierIds: string[] = [];
  const mkSupplier = async (name: string) => { const s = await db.supplier.create({ data: { orgId: ORG, name, contactEmail: `${name.toLowerCase().replace(/[^a-z]/g, "")}@fixture.test`, status: "active", createdById: OWNER } }); supplierIds.push(s.id); return s.id; };

  const cookieOf = async (userId: string) => `qy_session=${await createSession({ sub: userId, email: email(userId), role: "user" })}`;
  const call = async (projectId: string, userId: string | null = OWNER) => {
    const res = await route.GET(new NextRequest(`http://localhost/api/projects/${projectId}/next-step`, { headers: userId ? { cookie: await cookieOf(userId) } : {} }), { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, body: (await res.json()) as Body };
  };
  const view = async (projectId: string, userId: string = OWNER): Promise<View> => {
    const r = await call(projectId, userId);
    if (!r.body.view) throw new Error(`no view: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.view;
  };
  const at = (v: View) => (v.action ? `${v.action.target.kind}:${v.action.target.tab ?? v.action.target.href ?? ""}${v.action.target.anchor ? `#${v.action.target.anchor}` : ""}` : "none");
  const snapshot = async () =>
    JSON.stringify({
      audits: await db.auditLog.count({ where: { OR: [{ orgId: { in: [ORG, ORG_B] } }, { userId: { in: users } }, { projectId: { in: projectIds } }] } }),
      projects: (await db.project.findMany({ where: { id: { in: projectIds } }, orderBy: { id: "asc" }, select: { id: true, updatedAt: true, submittedAt: true, supplierInquiredAt: true } })).map((p) => [p.id, p.updatedAt.toISOString(), p.submittedAt, p.supplierInquiredAt]),
      runs: (await db.tenderAnalysisRun.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true } })).map((r) => [r.id, r.status, r.updatedAt.toISOString()]),
      requirements: (await db.tenderExtractedRequirement.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" }, select: { id: true, reviewStatus: true, updatedAt: true } })).map((r) => [r.id, r.reviewStatus, r.updatedAt.toISOString()]),
      inquiries: (await db.projectInquiry.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true } })).map((r) => [r.id, r.status, r.updatedAt.toISOString()]),
      items: (await db.inquiryItem.findMany({ where: { inquiry: { projectId: { in: projectIds } } }, orderBy: { id: "asc" }, select: { id: true, status: true, isSelected: true, contactNotes: true, updatedAt: true } })).map((r) => [r.id, r.status, r.isSelected, r.contactNotes, r.updatedAt.toISOString()]),
      actions: (await db.pendingAction.findMany({ where: { OR: [{ projectId: { in: projectIds } }, { orgId: { in: [ORG, ORG_B] } }] }, orderBy: { id: "asc" }, select: { id: true, status: true, decidedById: true, decidedAt: true, executedAt: true } })).map((a) => [a.id, a.status, a.decidedById, a.decidedAt, a.executedAt]),
      notifications: await db.notification.count({ where: { userId: { in: users } } }),
      orgs: (await db.organization.findMany({ where: { id: { in: [ORG, ORG_B] } }, orderBy: { id: "asc" }, select: { id: true, updatedAt: true } })).map((o) => [o.id, o.updatedAt.toISOString()]),
    });
  let cardSeq = 0;
  const mkCard = (o: { projectId: string; type?: string; inquiryId?: string | null; createdById?: string; expiresInHours?: number; createdAgoHours?: number; title?: string; orgId?: string; status?: string }) => {
    cardSeq += 1;
    return db.pendingAction.create({
      data: {
        type: o.type ?? "tender.send_rfq", title: o.title ?? `fixture card ${cardSeq}`, preview: "fixture", payload: o.inquiryId === null ? {} : { inquiryId: o.inquiryId ?? "none" },
        status: o.status ?? "pending", createdById: o.createdById ?? OWNER, orgId: o.orgId ?? ORG, projectId: o.projectId,
        createdAt: new Date(Date.now() - (o.createdAgoHours ?? 1) * 3600_000), expiresAt: new Date(Date.now() + (o.expiresInHours ?? 72) * 3600_000), idempotencyKey: `ns-${stamp}-${cardSeq}`,
      },
    });
  };

  try {
    // —— 0. closedLabelOf（判断项目是否已结束的那一小段）——
    ok(closedLabelOf({ status: "abandoned", tenderStatus: null }) === "已放弃" && closedLabelOf({ status: "archived", tenderStatus: null }) === "已归档" && closedLabelOf({ status: "active", tenderStatus: "lost" }) === "未中标" && closedLabelOf({ status: "active", tenderStatus: "bidding" }) === null && closedLabelOf({ status: "active", tenderStatus: null }) === null, "项目已放弃 / 已归档 / 招投标状态是终态 → 已结束的说法；进行中的 → 没有");
    ok(closedLabelOf({ status: "active", tenderStatus: "WON" }) === null && isWon({ tenderStatus: "WON" }) && !isWon({ tenderStatus: "lost" }) && !isWon({ tenderStatus: null }), "已中标另算（不说成「已结束」）");

    // —— 1. 权限与开关（先于任何内容）——
    const anon = await call(P, null);
    const outsider = await call(P, OUTSIDER);
    const orgmate = await call(P, ORGMATE);
    ok(anon.status === 401 && !anon.body.view, "没登录：401，没有内容", anon);
    ok(outsider.status >= 400 && outsider.status < 500 && !outsider.body.view && !JSON.stringify(outsider.body).includes("Fixture Tender"), "别的组织的人：被拒，拿不到任何项目内容", outsider);
    ok(orgmate.status >= 400 && orgmate.status < 500 && !orgmate.body.view, "本组织的人但不是项目成员：被拒", { status: orgmate.status });
    delete process.env.TENDER_WEB_NEXT_STEP_ENABLED;
    const off = await call(P);
    ok(off.status === 404 && off.body.error === "下一步未启用" && !off.body.view, "开关关闭：404，没有内容", off);
    process.env.TENDER_WEB_NEXT_STEP_ENABLED = "1";
    process.env.TENDER_WEB_NEXT_STEP_ORG_ALLOWLIST = ORG_B;
    ok((await call(P)).status === 404, "功能只对别的组织开放：404");
    process.env.TENDER_WEB_NEXT_STEP_ORG_ALLOWLIST = `${ORG_B}, ${ORG}`;
    ok((await call(P)).status === 200, "组织在名单里：照常");
    delete process.env.TENDER_WEB_NEXT_STEP_ORG_ALLOWLIST;
    const notTender = await mkProject({ workDomain: "sales" });
    ok((await call(notTender)).status === 404, "不是招投标项目：404");

    // —— 2. 一个标从头走到尾 ——
    let v = await view(P);
    ok(v.rule === "no_documents" && at(v) === "files:" && v.action?.labelZh === "上传招标文件" && v.urgencyZh === null && typeof v.closesAt === "string", "刚建的项目：还没上传招标文件 → 文件抽屉；带着截标时间", v);
    ok(v.actualStage === "initiation", "实际进度：只有项目本身 → 立项", v.actualStage);

    const doc = await db.projectDocument.create({ data: { projectId: P, title: "Tender.pdf", url: "fixture://tender.pdf", fileType: "pdf", parseStatus: "pending" } as never });
    v = await view(P);
    ok(v.rule === "parsing" && v.action === null, "文件刚上传、排队等解析：照实说正在解析，没有要去的位置", v);
    await db.projectDocument.update({ where: { id: doc.id }, data: { parseStatus: "parsing" } });
    ok((await view(P)).rule === "parsing", "文件解析中：同样");
    await db.projectDocument.update({ where: { id: doc.id }, data: { parseStatus: "done" } });
    v = await view(P);
    ok(v.rule === "no_analysis" && at(v) === "tab:requirements#tender-analysis" && v.reasonsZh[0].includes("已上传 1 个文件"), "解析完、还没分析 → 「招标要求」的招标分析", v);

    const run = await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId: P, status: "ANALYZING", idempotencyKey: `ns-${stamp}-run1`, sourceHashFingerprint: "fixture", createdById: OWNER } });
    v = await view(P);
    ok(v.rule === "analysis_running" && v.headlineZh === "招标文件正在分析" && v.actualStage === "initiation", "分析进行中；实际进度仍是立项（还没有可用的分析）", v);

    await db.tenderAnalysisRun.update({ where: { id: run.id }, data: { status: "REVIEW_REQUIRED", summaryJson: { criticalFacts: { buyer: { status: "KNOWN", factId: "f1" }, closing_datetime: { status: "UNKNOWN" } } } } });
    for (let i = 1; i <= 3; i += 1) await db.tenderExtractedRequirement.create({ data: { projectId: P, analysisRunId: run.id, requirementCode: `R-00${i}`, category: "product", originalRequirement: `Fixture requirement ${i}`, chineseTranslation: `示例要求 ${i}`, mandatory: i === 1, reviewStatus: "AI_EXTRACTED" } });
    v = await view(P);
    ok(v.rule === "unknown_facts" && v.headlineZh === "分析完了，1 个关键事实没证据" && at(v) === "tab:requirements#tender-analysis", "分析完、1 个关键事实没证据 → 去核对", v);
    ok(v.actualStage === "interpretation", "实际进度：有了等待审核的分析 → 项目解读", v.actualStage);
    await db.tenderAnalysisRun.update({ where: { id: run.id }, data: { summaryJson: { criticalFacts: { buyer: { status: "KNOWN", factId: "f1" } } } } });
    v = await view(P);
    ok(v.rule === "requirements_review" && v.reasonsZh[0].startsWith("还有 3 条要求待确认") && v.reasonsZh[1] === "至少确认一条，才能从页面上问供应商要价" && at(v) === "tab:requirements#tender-analysis" && v.action?.labelZh === "去确认并批准", "关键事实齐了：等你确认要求并批准（不是去询价）；写明还有 3 条待确认、至少确认一条才能询价", v);
    await db.tenderExtractedRequirement.updateMany({ where: { analysisRunId: run.id, requirementCode: { in: ["R-001", "R-002"] } }, data: { reviewStatus: "CONFIRMED" } });
    v = await view(P);
    ok(v.reasonsZh[0].startsWith("还有 1 条要求待确认") && v.reasonsZh[1] === "已确认的 2 条已经可以用来问供应商要价" && v.also.some((a) => a.target.anchor === "rfq-section"), "确认了两条：还有 1 条待确认；已确认的 2 条已经可以拿去询价（顺带提示）", v);
    // 一条不是强制的要求标成无法满足：不算「强制要求不满足」
    await db.tenderExtractedRequirement.update({ where: { analysisRunId_requirementCode: { analysisRunId: run.id, requirementCode: "R-002" } }, data: { complianceStatus: "NON_COMPLIANT" } });
    ok((await view(P)).rule === "requirements_review", "一条非强制的要求标成无法满足：不算「强制要求不满足」");
    await db.tenderExtractedRequirement.update({ where: { analysisRunId_requirementCode: { analysisRunId: run.id, requirementCode: "R-002" } }, data: { complianceStatus: "NOT_ASSESSED" } });
    await db.tenderExtractedRequirement.update({ where: { analysisRunId_requirementCode: { analysisRunId: run.id, requirementCode: "R-001" } }, data: { complianceStatus: "NON_COMPLIANT" } });
    v = await view(P);
    ok(v.rule === "mandatory_gap" && v.headlineZh === "1 条强制要求当前无法满足", "一条强制要求标成无法满足 → 先看这条", v);
    await db.tenderExtractedRequirement.update({ where: { analysisRunId_requirementCode: { analysisRunId: run.id, requirementCode: "R-001" } }, data: { complianceStatus: "NOT_ASSESSED" } });

    await db.tenderExtractedRequirement.updateMany({ where: { analysisRunId: run.id }, data: { reviewStatus: "CONFIRMED" } });
    await db.tenderAnalysisRun.update({ where: { id: run.id }, data: { status: "APPROVED", approvedById: OWNER, approvedAt: new Date() } });
    v = await view(P);
    ok(v.rule === "no_rfq" && v.headlineZh === "还没问过供应商" && at(v) === "tab:bid#rfq-section" && v.action?.labelZh === "去供应商询价", "分析批准了 → 还没问过供应商 → 「标书与报价」的供应商询价", v);
    ok(v.reasonsZh[0].startsWith("「问供应商要价」现在还不能用：") && v.reasonsZh[0].includes("还没连接 Gmail") && v.reasonsZh[1] === "那里也可以手工建一轮", "这个组织还没连接发信邮箱：把页面上那个入口自己给的原因写出来（不是笼统地说「去问供应商要价」）", v.reasonsZh);
    // 项目管理员有写权限
    await db.projectMember.create({ data: { projectId: P, userId: ORGMATE, role: "project_admin", status: "active" } });
    ok(!JSON.stringify(await view(P, ORGMATE)).includes("没有修改权限"), "项目管理员看同一页：没有「要项目负责人来做」这一句");
    await db.projectMember.deleteMany({ where: { projectId: P, userId: ORGMATE } });
    const asViewer = await view(P, VIEWER);
    ok(asViewer.rule === "no_rfq" && asViewer.reasonsZh[asViewer.reasonsZh.length - 1].includes("没有修改权限"), "项目里的只读成员看同一页：同一条结论，并说明这一步要项目负责人来做", asViewer);

    // 询价：一轮，三家，3 天前发出
    const [sA, sB, sC] = [await mkSupplier("Alpha Mills"), await mkSupplier("Beta Textiles"), await mkSupplier("Gamma Linen")];
    const round1 = await db.projectInquiry.create({ data: { projectId: P, roundNumber: 1, title: "round 1", scope: "bedding", status: "in_progress", createdById: OWNER } });
    const sentAt = new Date(Date.now() - 3 * DAY - 3600_000);
    const mkItem = (supplierId: string, o: { status?: string; contactNotes?: string | null } = {}) => db.inquiryItem.create({ data: { inquiryId: round1.id, supplierId, status: o.status ?? "sent", sentAt, contactNotes: o.contactNotes ?? null, createdById: OWNER } });
    const unsent = await db.inquiryItem.create({ data: { inquiryId: round1.id, supplierId: sA, status: "pending", createdById: OWNER } });
    ok((await view(P)).actualStage === "interpretation", "实际进度：轮次建了、供应商加了但还没发出 → 仍是项目解读（没发出不算询价）");
    await db.inquiryItem.delete({ where: { id: unsent.id } });
    const iA = await mkItem(sA), iB = await mkItem(sB), iC = await mkItem(sC);
    ok((await view(P)).actualStage === "supplier_inquiry", "实际进度：一轮询价已发出 → 供应商询价");
    await db.inquiryItem.update({ where: { id: iA.id }, data: { status: "replied", repliedAt: new Date() } });
    ok((await view(P)).actualStage === "supplier_inquiry", "实际进度：有一家回复了但报价还没录入 → 仍是供应商询价（回复不等于报价）");
    await db.inquiryItem.update({ where: { id: iA.id }, data: { status: "sent", repliedAt: null } });
    v = await view(P, VIEWER);
    ok(v.rule === "waiting_replies" && v.reasonsZh[0] === "满 5 天没回，这里会提示" && at(v) === `tab:bid#rfq-round-${round1.id}`, "发出 3 天没回；项目负责人设的是 5 天、看页面的人自己设的是 2 天：按负责人的 5 天算，还在等回复（与定时催单扫描同一口径）", v);
    await db.inquiryItem.updateMany({ where: { inquiryId: round1.id }, data: { sentAt: new Date(Date.now() - 6 * DAY) } });
    v = await view(P);
    ok(v.rule === "no_reply" && v.headlineZh === "3 家没回" && at(v) === `tab:bid#rfq-round-${round1.id}` && v.reasonsZh.some((x) => x.includes("没有邮件线程")), "发出 6 天没回：3 家没回；这三家都没有邮件线程，写明要手工联系", v);
    // 这一轮批准时带了跟进授权、里面定格的是 8 天：按 8 天算（与定时催单扫描相同），还在等
    process.env.TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED = "1";
    const policy = buildFollowUpPolicy({ chaseAfterDays: 8, replyBy: null, templateHash: chaseTemplateHash() });
    const sendCard = await db.pendingAction.create({ data: { type: "tender.send_rfq", title: "第 1 轮询价（3 家）", preview: "fixture", payload: { inquiryId: round1.id, followUpPolicy: policy }, status: "executed", createdById: OWNER, orgId: ORG, projectId: P, decidedById: OWNER, decidedAt: new Date(), executedAt: new Date(), expiresAt: new Date(Date.now() + 72 * 3600_000), idempotencyKey: `ns-${stamp}-send1` } });
    v = await view(P);
    ok(!!policy && v.rule === "waiting_replies" && v.reasonsZh[0] === "满 8 天没回，这里会提示", "这一轮带着已批准的跟进授权（定格 8 天）：发出 6 天按 8 天算，还在等——不是按负责人的 5 天说「没回」", v);
    delete process.env.TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED;
    ok((await view(P)).rule === "no_reply", "跟进授权的开关关着：回到负责人的 5 天");
    await db.pendingAction.delete({ where: { id: sendCard.id } });
    // 有一家已经催过两次
    await db.inquiryItem.update({ where: { id: iA.id }, data: { sentAt: new Date(Date.now() - 20 * DAY), contactNotes: [formatChaseNote({ index: 1, kind: "no_reply", messageId: "m1", at: new Date(Date.now() - 12 * DAY) }), formatChaseNote({ index: 2, kind: "no_reply", messageId: "m2", at: new Date(Date.now() - 1 * DAY) })].join("\n") } });
    v = await view(P);
    ok(v.rule === "no_reply" && v.headlineZh === "2 家没回", "其中一家已经催过两次（最后一次是昨天）：它不再算「该催了」，剩 2 家没回", v);
    await db.inquiryItem.update({ where: { id: iA.id }, data: { sentAt: new Date(Date.now() - 6 * DAY), contactNotes: null } });

    // 待批的范围
    const mine = await mkCard({ projectId: P, inquiryId: round1.id, title: "催单：Alpha Mills", type: "tender.send_chase", createdAgoHours: 5 });
    const otherProject = await mkProject();
    await mkCard({ projectId: otherProject, inquiryId: "x", title: "别的项目的卡" });
    await mkCard({ projectId: P, inquiryId: round1.id, title: "已经过期的卡", expiresInHours: -1, createdAgoHours: 50 });
    await mkCard({ projectId: P, inquiryId: round1.id, title: "已经批过的卡", status: "executed", createdAgoHours: 60 });
    v = await view(P);
    ok(v.rule === "pending_approval" && v.headlineZh === "有 1 条等你批" && v.reasonsZh[0] === "最早一条：催单：Alpha Mills" && at(v) === `tab:bid#rfq-round-${round1.id}`, "项目上一条待批的催单，另有别的项目的、已过期的、已批过的各一条：只算这 1 条；位置是它所在的那一轮", v);
    const inbox = (await listApprovalInbox(VIEWER, { orgId: ORG })).filter((i) => i.kind === "pending_action" && i.source.projectId === P).length;
    const viewerView = await view(P, VIEWER);
    ok((inbox === 0) === (viewerView.rule !== "pending_approval") && (inbox === 0 || viewerView.headlineZh === `有 ${inbox} 条等你批`), `另一个人看同一页：他在这个项目上看得到的待批条数与他的审批收件箱一致（${inbox} 条）`, { inbox, viewerView });
    // 负责人这边：看得到的条数与他的审批收件箱一致（不是只在 0 条时才一致）
    const second = await mkCard({ projectId: P, inquiryId: round1.id, title: "第二张待批的卡", createdAgoHours: 2 });
    const ownerInbox = (await listApprovalInbox(OWNER, { orgId: ORG })).filter((i) => i.kind === "pending_action" && i.source.projectId === P).length;
    const ownerView = await view(P);
    ok(ownerInbox === 2 && ownerView.headlineZh === "有 2 条等你批", `负责人看：这个项目上 ${ownerInbox} 条待批，与他的审批收件箱一致`, { ownerInbox, ownerView });
    await db.pendingAction.delete({ where: { id: second.id } });
    // 催单卡针对的那一家已经报价了：那一轮里不会列出这张卡 → 去审批中心，并说明可以驳回
    await db.pendingAction.update({ where: { id: mine.id }, data: { payload: { inquiryId: round1.id, inquiryItemId: iA.id, kind: "no_reply" } } });
    await db.inquiryItem.update({ where: { id: iA.id }, data: { status: "quoted" } });
    v = await view(P);
    ok(v.rule === "pending_approval" && at(v) === "href:/capabilities/approvals" && v.reasonsZh[1].includes("已经用不上了"), "催单针对的那一家已经报价了：位置改为审批中心，说明这张催单用不上了、可以驳回", v);
    await db.inquiryItem.update({ where: { id: iA.id }, data: { status: "sent" } });
    ok(at(await view(P)) === `tab:bid#rfq-round-${round1.id}`, "那一家仍然没回：催单卡还有用，位置是那一轮");
    await mkCard({ projectId: P, type: "project.generic_action", inquiryId: null, title: "别的类型的审批", createdAgoHours: 90 });
    v = await view(P);
    ok(v.headlineZh === "有 2 条等你批" && v.reasonsZh[0] === "最早一条：别的类型的审批" && at(v) === "href:/capabilities/approvals", "再来一条更早的、别的类型的审批：2 条，最早一条不是询价 → 位置是审批中心", v);
    const before = await snapshot();
    for (let i = 0; i < 3; i += 1) await call(P);
    await call(P, VIEWER);
    ok((await snapshot()) === before, "反复调用之后：审计、项目、分析、要求、询价、供应商行、审批（没有一张被批准或执行）、通知、组织，都没有变化");
    ok((await db.pendingAction.findUnique({ where: { id: mine.id }, select: { status: true, decidedById: true } }))?.status === "pending", "那张待批的卡仍然是待批");
    await db.pendingAction.updateMany({ where: { projectId: P, status: "pending" }, data: { status: "rejected", decidedById: OWNER, decidedAt: new Date() } });

    // 报价回来
    await db.inquiryItem.update({ where: { id: iA.id }, data: { status: "quoted", repliedAt: new Date(), unitPrice: 9.87, totalPrice: 23362.29, currency: "CAD" } });
    await db.inquiryItem.update({ where: { id: iB.id }, data: { status: "declined" } });
    await db.inquiryItem.update({ where: { id: iC.id }, data: { status: "no_response" } });
    v = await view(P);
    ok(v.rule === "single_quote" && at(v) === `tab:bid#rfq-round-${round1.id}`, "一家报价、一家谢绝、一家未响应：只有 1 家报价", v);
    ok(v.actualStage === "supplier_quote", "实际进度：有一家已报价 → 供应商报价", v.actualStage);
    const asViewerStage = await view(P, VIEWER);
    ok(asViewerStage.actualStage === v.actualStage && asViewerStage.shownStage === v.shownStage && asViewerStage.recordedStage === v.recordedStage, "只读成员看到的三个阶段与负责人相同（与有没有写权限无关）");
    const recorded = await db.project.findUnique({ where: { id: P }, select: { supplierQuotedAt: true, supplierInquiredAt: true, interpretedAt: true, submittedAt: true, tenderStatus: true } });
    ok(recorded?.supplierQuotedAt === null && recorded?.supplierInquiredAt === null && recorded?.interpretedAt === null && recorded?.submittedAt === null, "阶段记录没有被写过：项目上的几个阶段时间仍然是空的（只改显示）", recorded);
    await db.inquiryItem.update({ where: { id: iB.id }, data: { status: "quoted", repliedAt: new Date(), unitPrice: 11.5, totalPrice: 27220.5, currency: "CAD" } });
    v = await view(P);
    ok(v.rule === "quotes_ready" && v.headlineZh === "报价齐了，还没定供应商" && at(v) === `tab:bid#rfq-round-${round1.id}` && v.action?.labelZh === "去比价并选定", "两家报价：报价齐了 → 那一轮", v);
    await db.inquiryItem.update({ where: { id: iA.id }, data: { isSelected: true } });
    v = await view(P);
    ok(v.rule === "price_pending" && at(v) === "tab:bid#bid-quote-area" && v.reasonsZh[0].includes("Alpha Mills"), "选定了一家：还没定投标价 → 「标书与报价」的投标价", v);

    const dead = await db.projectQuote.create({ data: { projectId: P, orgId: ORG, createdById: OWNER, status: "cancelled", totalAmount: 111 } });
    const dead2 = await db.projectQuote.create({ data: { projectId: P, orgId: ORG, createdById: OWNER, status: "superseded", totalAmount: 222 } });
    ok((await view(P)).rule === "price_pending", "只有已取消、已被取代的报价：不算「投标价已有」，仍然是还没定投标价");
    await db.projectQuote.deleteMany({ where: { id: { in: [dead.id, dead2.id] } } });
    const quote = await db.projectQuote.create({ data: { projectId: P, orgId: ORG, createdById: OWNER, status: "draft", totalAmount: 45678.9, profitMargin: 23.45, internalCost: 34567.8 } });
    v = await view(P);
    ok(v.rule === "prepare_submission" && at(v) === "tab:submission" && !JSON.stringify(v).includes("阻断"), "有了投标价、投标工作区没开：准备提交 → 「提交」页签；没有阻断项的说法", v);

    // 投标工作区开启但从没用过：不说「提交前还有阻断项」
    process.env.TENDER_BID_WORKSPACE_ENABLED = "1";
    v = await view(P);
    ok(v.rule === "prepare_submission" && v.headlineZh === "投标价已有，准备提交" && at(v) === "tab:submission" && !JSON.stringify(v.reasonsZh).includes("阻断") && v.also.some((a) => a.textZh === "价格表还没录，可以从招标分析带入"), "工作区开启但从没用过（没有价格表）：照常准备提交，价格表的事在顺带要办的事里", v);
    const saved = await workspaceRoute.PUT(
      new NextRequest(`http://localhost/api/projects/${P}/bid-workspace`, { method: "PUT", headers: { cookie: await cookieOf(OWNER), "content-type": "application/json" }, body: JSON.stringify({ priceSchedule: { lines: [{ lineNo: 1, description: "Twin Mattress Cover", quantity: "2367", uom: "Each", dimensions: "39 x 75 x 9" }] } }) }),
      { params: Promise.resolve({ id: P }) },
    );
    v = await view(P);
    ok(saved.status === 200 && v.rule === "prepare_submission" && v.headlineZh === "投标价已有，提交前还有阻断项" && v.reasonsZh[0].startsWith("投标工作区还有 1 个阻断项") && v.reasonsZh[1] === "第 1 行尺寸尚未核对" && at(v) === "tab:bid#bid-workspace", "工作区开启、价格表里有一行尺寸还没核对：列出这条阻断项 → 投标工作区", v);
    ok(!JSON.stringify(v).includes("还没有成本核算") && v.reasonsZh[0].includes("这里看不到"), "成本类的阻断项不列，并照实说成本核算这里看不到");
    delete process.env.TENDER_BID_WORKSPACE_ENABLED;

    // 金额不出现
    const texts = JSON.stringify([await view(P), await view(P, VIEWER)]);
    ok(!/123456|123,456|45678|45,678|34567|23\.45|9\.87|11\.5|23362|27220/.test(texts) && !/[$¥€£]|毛利|估值|报价金额/.test(texts), "项目有估值、供应商报了价、投标报价有总额与毛利：响应的文字里这些数字一个都不出现", texts.slice(0, 600));
    ok(Object.keys(v).sort().join() === "action,actualStage,also,closesAt,headlineZh,reasonsZh,recordedStage,rule,shownStage,urgencyZh", "响应里只有这十个字段");

    // 临近截标：提醒与下一步并存
    await db.projectQuote.delete({ where: { id: quote.id } });
    await db.project.update({ where: { id: P }, data: { closeDate: new Date(Date.now() + 2 * DAY + 60_000) } });
    v = await view(P);
    ok(v.urgencyZh === "2 天后截标，还没提交" && v.rule === "price_pending", "两天后截标、还没定价：提醒「2 天后截标，还没提交」与下一步「还没定投标价」并存", v);
    // 只有内部的到期日、没有截标时间：不拿它当截标
    await db.project.update({ where: { id: P }, data: { closeDate: null, dueDate: new Date(Date.now() - 2 * DAY) } });
    v = await view(P);
    ok(v.rule === "price_pending" && v.urgencyZh === null && v.closesAt === null && v.also.some((a) => a.textZh === "还没填截标时间" && a.target.anchor === "project-key-dates"), "项目只有内部的到期日（两天前）、没有截标时间：不说「截标已过」，照常给下一步，并提示还没填截标时间", v);
    await db.project.update({ where: { id: P }, data: { dueDate: null } });

    // 提交 / 截标已过 / 结束
    await db.project.update({ where: { id: P }, data: { closeDate: new Date(Date.now() - 3600_000) } });
    v = await view(P);
    ok(v.rule === "price_pending" && v.urgencyZh === "截标时间到了或刚过，还没有提交记录", "截标时间刚过一小时（手工填的截标时间只有日期）：不下「已过」的结论，照常给下一步并提醒", v);
    await db.project.update({ where: { id: P }, data: { closeDate: new Date(Date.now() - 30 * 3600_000) } });
    v = await view(P);
    ok(v.rule === "past_closing" && v.headlineZh === "截标日期已过，没有提交记录" && at(v) === "tab:workbench#project-key-dates" && v.urgencyZh === null, "截标日期过了一天以上、没有提交时间：照实说；位置是工作台的关键日期；不再建议定价", v);
    // FLOW-H4a：这个组织开了「提交记录」→ 同一个状态指到「提交」页签的提交记录；关掉、或组织不在名单里 → 回到关键日期
    process.env.TENDER_SUBMISSION_RECORD_ENABLED = "1";
    v = await view(P);
    ok(v.rule === "past_closing" && at(v) === "tab:submission#submission-record" && v.action?.labelZh === "去记录提交" && v.also.some((a) => a.target.kind === "tab" && a.target.tab === "workbench" && a.target.anchor === "project-key-dates"), "提交记录开着：截标已过时卡片去「提交」页签的提交记录，关键日期放在顺带要办的事里", v);
    process.env.TENDER_SUBMISSION_RECORD_ORG_ALLOWLIST = ORG_B;
    ok(at(await view(P)) === "tab:workbench#project-key-dates", "这个组织不在提交记录的名单里：仍指到关键日期");
    delete process.env.TENDER_SUBMISSION_RECORD_ORG_ALLOWLIST;
    delete process.env.TENDER_SUBMISSION_RECORD_ENABLED;
    ok(at(await view(P)) === "tab:workbench#project-key-dates", "提交记录关掉：回到关键日期");
    await db.project.update({ where: { id: P }, data: { submittedAt: new Date(Date.now() - 2 * 3600_000) } });
    v = await view(P);
    ok(v.rule === "submitted" && v.headlineZh === "已提交，等开标结果" && at(v) === "tab:submission" && v.actualStage === "submission", "有提交时间：已提交，等结果；实际进度是项目提交", v);
    await db.project.update({ where: { id: P }, data: { tenderStatus: "lost" } });
    v = await view(P);
    ok(v.rule === "closed" && v.headlineZh === "这个标已结束（未中标）" && v.action === null, "招投标状态是未中标：这个标已结束", v);
    await db.project.update({ where: { id: P }, data: { tenderStatus: "won" } });
    ok((await view(P)).rule === "won", "招投标状态是已中标：说已中标");

    // —— 3. 取哪一轮、哪一份分析 ——
    const P2 = await mkProject();
    await db.projectDocument.create({ data: { projectId: P2, title: "T.pdf", url: "fixture://t.pdf", fileType: "pdf", parseStatus: "done" } as never });
    // 两份分析：早的一份已批准（2 条已确认），晚的一份等待审核（3 条待确认）——用晚的
    const oldRun = await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId: P2, status: "APPROVED", idempotencyKey: `ns-${stamp}-run2a`, sourceHashFingerprint: "fixture", createdById: OWNER, createdAt: new Date(Date.now() - 3 * DAY) } });
    for (let i = 1; i <= 2; i += 1) await db.tenderExtractedRequirement.create({ data: { projectId: P2, analysisRunId: oldRun.id, requirementCode: `O-00${i}`, category: "product", originalRequirement: `old ${i}`, chineseTranslation: `旧 ${i}`, mandatory: false, reviewStatus: i === 1 ? "CONFIRMED" : "AI_EXTRACTED" } });
    const newRun = await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId: P2, status: "REVIEW_REQUIRED", idempotencyKey: `ns-${stamp}-run2b`, sourceHashFingerprint: "fixture", createdById: OWNER, createdAt: new Date(Date.now() - 1 * DAY), summaryJson: { criticalFacts: {} } } });
    for (let i = 1; i <= 3; i += 1) await db.tenderExtractedRequirement.create({ data: { projectId: P2, analysisRunId: newRun.id, requirementCode: `N-00${i}`, category: "product", originalRequirement: `new ${i}`, chineseTranslation: `新 ${i}`, mandatory: false, reviewStatus: "AI_EXTRACTED" } });
    v = await view(P2);
    ok(v.rule === "requirements_review" && v.reasonsZh[0].startsWith("还有 3 条要求待确认") && v.reasonsZh[1] === "至少确认一条，才能从页面上问供应商要价", "两份分析：用最新的那份（等待审核、3 条待确认）；待确认与已确认的条数只数这一份，不把旧的那份算进来", v);
    // 最新一次重新分析失败了：用之前可用的那一份，并顺带提示
    const failedRun = await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId: P2, status: "FAILED", idempotencyKey: `ns-${stamp}-run2c`, sourceHashFingerprint: "fixture", createdById: OWNER } });
    v = await view(P2);
    ok(v.rule === "requirements_review" && v.also.some((a) => a.textZh === "最近一次重新分析失败了，现在用的是之前那一份"), "最近一次重新分析失败、之前有一份可用的：主结论照可用的那份走（不说成「上次分析失败」），顺带提示", v);
    await db.tenderAnalysisRun.update({ where: { id: failedRun.id }, data: { status: "ANALYZING" } });
    ok((await view(P2)).rule === "analysis_running", "最新一次正在分析：照实说正在分析");
    await db.tenderAnalysisRun.delete({ where: { id: failedRun.id } });
    await db.tenderExtractedRequirement.updateMany({ where: { analysisRunId: newRun.id }, data: { reviewStatus: "CONFIRMED" } });
    await db.tenderAnalysisRun.update({ where: { id: newRun.id }, data: { status: "APPROVED" } });
    // 三轮：第 1 轮两家报价；第 2 轮今天发出一家；第 3 轮是空的草稿 → 用第 2 轮
    const r1 = await db.projectInquiry.create({ data: { projectId: P2, roundNumber: 1, title: "round 1", scope: "x", status: "in_progress", createdById: OWNER } });
    await db.inquiryItem.create({ data: { inquiryId: r1.id, supplierId: sA, status: "quoted", sentAt: new Date(), repliedAt: new Date(), createdById: OWNER } });
    await db.inquiryItem.create({ data: { inquiryId: r1.id, supplierId: sB, status: "quoted", sentAt: new Date(), repliedAt: new Date(), createdById: OWNER } });
    v = await view(P2);
    ok(v.rule === "quotes_ready" && at(v) === `tab:bid#rfq-round-${r1.id}`, "只有第 1 轮（两家报价）：报价齐了", v);
    const r3 = await db.projectInquiry.create({ data: { projectId: P2, roundNumber: 3, title: "round 3", scope: "x", status: "draft", createdById: OWNER } });
    v = await view(P2);
    ok(v.rule === "quotes_ready" && at(v) === `tab:bid#rfq-round-${r1.id}`, "又手工建了一个空的新轮次：不盖住上一轮的报价（不说成「还没问过供应商」）", v);
    await db.inquiryItem.create({ data: { inquiryId: r3.id, supplierId: sC, status: "pending", createdById: OWNER } });
    ok((await view(P2)).rule === "quotes_ready", "新轮次里只有一家还没发出的：同样不盖住");
    const r2 = await db.projectInquiry.create({ data: { projectId: P2, roundNumber: 2, title: "round 2", scope: "x", status: "in_progress", createdById: OWNER } });
    await db.inquiryItem.create({ data: { inquiryId: r2.id, supplierId: sC, status: "sent", sentAt: new Date(), createdById: OWNER } });
    v = await view(P2);
    ok(v.rule === "waiting_replies" && at(v) === `tab:bid#rfq-round-${r2.id}`, "第 2 轮今天发出了一家：当前这一轮是最新一轮有已发出的（第 2 轮），不是最早的第 1 轮", v);
    ok(v.actualStage === "supplier_quote", "实际进度：报价在第 1 轮、第 2 轮刚发出还没人回 → 仍是供应商报价（开新一轮不让进度倒退）", v.actualStage);
    // 把有报价的第 1 轮取消：已取消的轮次不算
    await db.projectInquiry.update({ where: { id: r1.id }, data: { status: "canceled" } });
    ok((await view(P2)).actualStage === "supplier_inquiry", "有报价的那一轮被取消了：实际进度回到供应商询价（已取消的轮次不算）");
    await db.projectInquiry.update({ where: { id: r1.id }, data: { status: "in_progress" } });
    await db.projectInquiry.update({ where: { id: r2.id }, data: { status: "canceled" } });
    ok(at(await view(P2)) === `tab:bid#rfq-round-${r1.id}`, "第 2 轮取消了：回到第 1 轮");
    // 轮次标为完成、还有一家「已发出」：定时催单不再看它，这里也不说「没回」
    await db.projectInquiry.update({ where: { id: r2.id }, data: { status: "completed" } });
    await db.inquiryItem.updateMany({ where: { inquiryId: r2.id }, data: { sentAt: new Date(Date.now() - 30 * DAY) } });
    v = await view(P2);
    ok(v.rule === "no_quotes", "第 2 轮标为完成、那一家 30 天没回：不说「1 家没回」（定时催单不看已完成的轮次），说这一轮没有拿到报价", v);
    await db.projectInquiry.update({ where: { id: r2.id }, data: { status: "in_progress" } });
    ok((await view(P2)).rule === "no_reply", "同一轮仍在进行：1 家没回");
    await db.inquiryItem.updateMany({ where: { inquiryId: r2.id }, data: { sentAt: new Date(Date.now() - 100 * DAY) } });
    ok((await view(P2)).rule === "no_quotes", "发出已经 100 天（超出定时催单 90 天的范围）：不再说没回");
    // 已批准、却没有一条已确认的要求
    const P5 = await mkProject();
    await db.projectDocument.create({ data: { projectId: P5, title: "T.pdf", url: "fixture://t.pdf", fileType: "pdf", parseStatus: "done" } as never });
    const run5 = await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId: P5, status: "APPROVED", idempotencyKey: `ns-${stamp}-run5`, sourceHashFingerprint: "fixture", createdById: OWNER } });
    await db.tenderExtractedRequirement.create({ data: { projectId: P5, analysisRunId: run5.id, requirementCode: "X-001", category: "product", originalRequirement: "x", chineseTranslation: "x", mandatory: false, reviewStatus: "REJECTED" } });
    v = await view(P5);
    ok(v.rule === "no_confirmed_requirements" && at(v) === "tab:requirements#tender-analysis", "分析已批准但没有一条已确认的要求：照实说询价入口用不了，不说「去问供应商要价」", v);
    // 老项目：有文件、没有分析，但询价已经有两家报价
    const P6 = await mkProject();
    await db.projectDocument.create({ data: { projectId: P6, title: "T.pdf", url: "fixture://t.pdf", fileType: "pdf", parseStatus: "done" } as never });
    const r6 = await db.projectInquiry.create({ data: { projectId: P6, roundNumber: 1, title: "round 1", scope: "x", status: "in_progress", createdById: OWNER } });
    await db.inquiryItem.create({ data: { inquiryId: r6.id, supplierId: sA, status: "quoted", sentAt: new Date(), createdById: OWNER } });
    await db.inquiryItem.create({ data: { inquiryId: r6.id, supplierId: sB, status: "quoted", sentAt: new Date(), createdById: OWNER } });
    v = await view(P6);
    ok(v.rule === "quotes_ready" && v.also.some((a) => a.textZh === "招标文件还没分析"), "没有分析但已有两家报价（老项目）：不卡在「去分析」，说报价齐了，分析的事顺带提示", v);
    // 一份属于别的组织的分析记录不拿来用
    const P3 = await mkProject();
    await db.projectDocument.create({ data: { projectId: P3, title: "T.pdf", url: "fixture://t.pdf", fileType: "pdf", parseStatus: "done" } as never });
    await db.tenderAnalysisRun.create({ data: { orgId: ORG_B, projectId: P3, status: "APPROVED", idempotencyKey: `ns-${stamp}-run3`, sourceHashFingerprint: "fixture", createdById: OWNER } });
    v = await view(P3);
    ok(v.rule === "no_analysis", "分析记录上的组织不是这个项目的组织：不拿来用（当作还没分析）", v);
    // 回复截止已过
    const P4 = await mkProject();
    await db.projectDocument.create({ data: { projectId: P4, title: "T.pdf", url: "fixture://t.pdf", fileType: "pdf", parseStatus: "done" } as never });
    const run4 = await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId: P4, status: "APPROVED", idempotencyKey: `ns-${stamp}-run4`, sourceHashFingerprint: "fixture", createdById: OWNER } });
    await db.tenderExtractedRequirement.create({ data: { projectId: P4, analysisRunId: run4.id, requirementCode: "Y-001", category: "product", originalRequirement: "y", chineseTranslation: "y", mandatory: false, reviewStatus: "CONFIRMED" } });
    const r4 = await db.projectInquiry.create({ data: { projectId: P4, roundNumber: 1, title: "round 1", scope: "x", status: "in_progress", createdById: OWNER, dueDate: new Date(Date.now() - 3 * DAY) } });
    await db.inquiryItem.create({ data: { inquiryId: r4.id, supplierId: sA, status: "sent", sentAt: new Date(Date.now() - 12 * DAY), createdById: OWNER } });
    v = await view(P4);
    ok(v.rule === "reply_deadline_passed" && v.headlineZh === "回复截止已过，1 家没回" && !/起草催单|会再催|不会再催/.test(JSON.stringify(v)), "回复截止日已过：不提示催，说明截止已过、1 家没回", v);
    /* ---------- FLOW-H1b：记录的阶段、显示的阶段 ---------- */
    const stages = (x: View) => `${x.recordedStage}>${x.actualStage}>${x.shownStage}`;
    // P6：没有分析、第 1 轮两家报价；阶段记录只到项目分发
    v = await view(P6);
    ok(stages(v) === "distribution>supplier_quote>supplier_quote", "记录落后（项目分发）、实际有两家报价：显示供应商报价，同时给出记录的阶段", stages(v));
    await db.projectInquiry.update({ where: { id: r6.id }, data: { status: "completed" } });
    ok((await view(P6)).actualStage === "supplier_quote", "有报价的那一轮标为完成：照样算到了供应商报价");
    // 页面开着的时候，别处把阶段记录往前写了一段：记录的阶段跟着是新的
    await db.project.update({ where: { id: P6 }, data: { supplierInquiredAt: new Date() } });
    v = await view(P6);
    ok(stages(v) === "supplier_inquiry>supplier_quote>supplier_quote", "阶段记录刚被写成供应商询价：记录的阶段是新的那一段（不是页面上旧的项目数据）", stages(v));
    // 已结束的项目：显示的就是记录的阶段
    for (const [data, label] of [[{ tenderStatus: "lost" }, "未中标"], [{ tenderStatus: "won" }, "已中标"], [{ status: "abandoned" }, "已放弃"], [{ status: "archived" }, "已归档"], [{ tenderStatus: "bid_submitted" }, "招投标状态是已提交"]] as const) {
      await db.project.update({ where: { id: P6 }, data });
      v = await view(P6);
      ok(stages(v) === "supplier_inquiry>supplier_quote>supplier_inquiry", `${label}的项目：显示的阶段就是记录的供应商询价（不按实际进度往后挪）`, stages(v));
      await db.project.update({ where: { id: P6 }, data: { tenderStatus: null, status: "active" } });
    }
    ok(stages(await view(P6)) === "supplier_inquiry>supplier_quote>supplier_quote", "状态恢复成进行中：又按靠后的那个显示");
    await db.project.update({ where: { id: P6 }, data: { tenderStatus: "lost", submittedAt: new Date() } });
    ok(stages(await view(P6)) === "submission>submission>submission", "未中标但有提交时间：三项都是项目提交");
    await db.project.update({ where: { id: P6 }, data: { tenderStatus: null, submittedAt: null, supplierQuotedAt: new Date() } });
    ok(stages(await view(P6)) === "supplier_quote>supplier_quote>supplier_quote", "阶段记录也到了供应商报价：三项相同");
    // 记录超前：P4 只发出了一家，有人把阶段记录手工推到了供应商报价
    ok(stages(await view(P4)) === "distribution>supplier_inquiry>supplier_inquiry", "（前提）P4：记录项目分发、实际供应商询价");
    await db.project.update({ where: { id: P4 }, data: { supplierQuotedAt: new Date() } });
    ok(stages(await view(P4)) === "supplier_quote>supplier_inquiry>supplier_quote", "记录超前（手工推到供应商报价）、实际只发出了询价：以记录为准");
    // 只有投标报价单、没有询价
    const P7 = await mkProject();
    v = await view(P7);
    ok(stages(v) === "distribution>initiation>distribution", "刚建的项目：实际进度是立项，显示的仍是记录的项目分发（不往回拉）", stages(v));
    const q7 = await db.projectQuote.create({ data: { projectId: P7, orgId: ORG, createdById: OWNER, status: "draft", totalAmount: 100 } });
    ok(stages(await view(P7)) === "distribution>supplier_quote>supplier_quote", "没有询价、有一份投标报价单：算到了供应商报价");
    await db.projectQuote.update({ where: { id: q7.id }, data: { status: "cancelled" } });
    ok((await view(P7)).actualStage === "initiation", "报价单作废之后不再算");
    // 发出之后谢绝 / 未响应：照样算发出过
    const r7 = await db.projectInquiry.create({ data: { projectId: P7, roundNumber: 1, title: "round 1", scope: "x", status: "in_progress", createdById: OWNER } });
    const i7 = await db.inquiryItem.create({ data: { inquiryId: r7.id, supplierId: sA, status: "declined", sentAt: new Date(), createdById: OWNER } });
    ok((await view(P7)).actualStage === "supplier_inquiry", "唯一的一家谢绝了：算到了供应商询价（发出过）");
    await db.inquiryItem.update({ where: { id: i7.id }, data: { status: "no_response" } });
    ok((await view(P7)).actualStage === "supplier_inquiry", "唯一的一家标为未响应：同样");
    // 可用的分析：最近一次失败、之前有一份已批准的 → 仍算；只有失败的 → 不算
    const P8 = await mkProject();
    await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId: P8, status: "FAILED", idempotencyKey: `ns-${stamp}-run8a`, sourceHashFingerprint: "fixture", createdById: OWNER, createdAt: new Date(Date.now() - 3600_000) } });
    ok((await view(P8)).actualStage === "initiation", "只有一次失败的分析：实际进度仍是立项");
    await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId: P8, status: "APPROVED", idempotencyKey: `ns-${stamp}-run8b`, sourceHashFingerprint: "fixture", createdById: OWNER, createdAt: new Date(Date.now() - 1800_000) } });
    await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId: P8, status: "RUNNING", idempotencyKey: `ns-${stamp}-run8c`, sourceHashFingerprint: "fixture", createdById: OWNER } });
    ok((await view(P8)).actualStage === "interpretation", "之前有一份已批准的分析、现在正在重跑：仍算到了项目解读");
    const untouched = await db.project.findMany({ where: { id: { in: [P7, P8] } }, select: { interpretedAt: true, supplierInquiredAt: true, supplierQuotedAt: true, submittedAt: true, tenderStatus: true } });
    ok(untouched.every((p) => !p.interpretedAt && !p.supplierInquiredAt && !p.supplierQuotedAt && !p.submittedAt && !p.tenderStatus), "这些调用之后，没被测试改过的项目上阶段记录仍然是空的（接口不写阶段）", untouched);
    // 别的组织的项目：自己人能看，这边的人不能
    const PB = await mkProject({ orgId: ORG_B, ownerId: OUTSIDER });
    ok((await call(PB, OWNER)).status >= 400 && (await view(PB, OUTSIDER)).rule === "no_documents", "别的组织的项目：这边的人被拒，那边自己的人正常");
  } finally {
    delete process.env.TENDER_WEB_NEXT_STEP_ENABLED;
    delete process.env.TENDER_WEB_NEXT_STEP_ORG_ALLOWLIST;
    delete process.env.TENDER_SUBMISSION_RECORD_ENABLED;
    delete process.env.TENDER_SUBMISSION_RECORD_ORG_ALLOWLIST;
    delete process.env.TENDER_BID_WORKSPACE_ENABLED;
    delete process.env.TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED;
    await db.pendingAction.deleteMany({ where: { OR: [{ projectId: { in: projectIds } }, { orgId: { in: [ORG, ORG_B] } }] } });
    await db.projectQuote.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: projectIds } } } });
    await db.projectInquiry.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG_B] } }, { userId: { in: users } }] } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderExtractedRequirement.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectDocument.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_B] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\nFLOW-H1 web next step DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
