/**
 * Supplier Intelligence S2 Trust-Boundary Closure — DB + HTTP 集成（隔离库执行，否则跳过）
 *
 * 运行：
 *   DATABASE_URL=... DIRECT_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *     JWT_SECRET=... SUPPLIER_INTEL_ENABLED=1 \
 *     npx tsx src/lib/supplier-intel/__tests__/supplier-intel-s2tb-db.isolated.test.ts
 *
 * R1（项目级授权贯穿信号读写）R1-T1..T8：**同一个 org 内的两个项目 + 不同权限用户**，
 *   不是只测 cross-org；服务行为 + HTTP 边界都测，不只做源码字符串守卫。
 * R2（canonical 来源不可证完整时明确阻断）R2-T6/T7：阻断点在 Run 创建 / LLM / provider 之前，
 *   客户端伪造 requirements 与完整性声明不解除阻断，HTTP 返回领域错误而非 500。
 * R1 Edge Closure A1..A4 / B1..B4：org_admin 的列表·单条一致性（非 dispatched 项目不得从列表或
 *   计数泄露）、super_admin 既有特权不放松 org 隔离与不可解析 Run 保护、tenderId↔Run.projectId
 *   对称对质（含 HTTP 与 discovered-signal 共享路径）。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("⏭  跳过 S2-TB DB 测试（未提供 DATABASE_URL）");
    process.exit(0);
  }
  if (process.env.NODE_ENV !== "test") {
    console.log("⏭  跳过 S2-TB DB 测试（需 NODE_ENV=test）");
    process.exit(0);
  }
  if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") {
    console.log("⏭  跳过 S2-TB DB 测试（需 DATABASE_ENVIRONMENT=isolated）");
    process.exit(0);
  }
  assertSafeTestDatabase({ scriptName: "supplier-intel s2 trust-boundary closure" });
}

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: string) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  requireIsolatedTestDb();
  process.env.SUPPLIER_INTEL_ENABLED = process.env.SUPPLIER_INTEL_ENABLED || "1";
  process.env.JWT_SECRET = process.env.JWT_SECRET || "s2tb-trust-boundary-test-secret";

  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { isSupplierIntelError } = await import("../errors");
  const signalSvc = await import("../signal-service");
  const runSvc = await import("../run-service");
  const projectRunSvc = await import("../project-run-service");
  const canonicalMod = await import("../canonical-requirements");
  const er = await import("../entity-resolution");
  const discovery = await import("../discovery-service");
  const { createSession } = await import("@/lib/auth/session");
  const { SUPPLIER_INTEL_AUDIT_ACTIONS } = await import("../constants");
  const { buildCanonicalRisksStructuredJson } = await import("./fixtures/canonical-risks-writer");
  type LlmInvoker = import("@/lib/tender-understanding/llm").LlmInvoker;
  type Provider = import("../providers").DiscoveryProvider;

  const signalsRoute = await import("@/app/api/supplier-intel/signals/route");
  const signalItemRoute = await import("@/app/api/supplier-intel/signals/[id]/route");
  const signalResolveRoute = await import("@/app/api/supplier-intel/signals/[id]/resolve/route");
  const runsRoute = await import("@/app/api/supplier-intel/runs/route");

  async function expectErr(code: string, name: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      ok(false, `${name}（期望抛 ${code}，实际成功）`);
    } catch (e) {
      if (isSupplierIntelError(e, code as never)) ok(true, name);
      else ok(false, name, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  }

  const tag = `s2tb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const PENDING_MARKER = `PENDING_PROJECT_BODY_${tag}`;
  const SECRET_MARKERS = {
    title: `PROTECTED_TITLE_${tag}`,
    description: `PROTECTED_DESC_${tag}`,
    note: `PROTECTED_NOTE_${tag}`,
    rawText: `PROTECTED_RAW_${tag}`,
  };

  // ───────────────────────── Fixture ─────────────────────────
  const mkUser = (slug: string, status = "active") =>
    db.user.create({
      data: {
        email: `${slug}_${tag}@test.qingyan.local`,
        name: slug,
        role: "user",
        status,
      },
    });

  const userOwner = await mkUser("tb_owner");
  const uWriterA = await mkUser("tb_writer_a");
  const uReaderA = await mkUser("tb_reader_a");
  const uWriterB = await mkUser("tb_writer_b");
  const uPlain = await mkUser("tb_plain");
  const uInactiveMember = await mkUser("tb_inactive_member");
  const uSuspended = await mkUser("tb_suspended", "suspended");
  const uOrgAdmin = await mkUser("tb_org_admin");            // 非 super_admin 的 org_admin（非项目 owner）
  const uSuper = await db.user.create({
    data: { email: `tb_super_${tag}@test.qingyan.local`, name: "tb_super", role: "super_admin", status: "active" },
  });

  const orgA = await db.organization.create({
    data: { name: `TB Org ${tag}`, code: `tb_${tag}`, ownerId: userOwner.id, status: "active" },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: orgA.id, userId: userOwner.id, role: "org_admin", status: "active" },
      { orgId: orgA.id, userId: uWriterA.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uReaderA.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uWriterB.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uPlain.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uInactiveMember.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uSuspended.id, role: "org_member", status: "active" },
      { orgId: orgA.id, userId: uOrgAdmin.id, role: "org_admin", status: "active" },
      { orgId: orgA.id, userId: uSuper.id, role: "org_member", status: "active" },
    ],
  });

  const projA = await db.project.create({
    data: { orgId: orgA.id, name: `TB ProjA ${tag}`, ownerId: userOwner.id, workDomain: "tender", intakeStatus: "dispatched" },
  });
  const projB = await db.project.create({
    data: { orgId: orgA.id, name: `TB ProjB ${tag}`, ownerId: userOwner.id, workDomain: "tender", intakeStatus: "dispatched" },
  });
  await db.projectMember.createMany({
    data: [
      { projectId: projA.id, userId: uWriterA.id, role: "project_admin", status: "active" },
      { projectId: projA.id, userId: uReaderA.id, role: "viewer", status: "active" },
      { projectId: projB.id, userId: uWriterB.id, role: "project_admin", status: "active" },
      { projectId: projA.id, userId: uInactiveMember.id, role: "project_admin", status: "inactive" },
      { projectId: projA.id, userId: uSuspended.id, role: "project_admin", status: "active" },
    ],
  });

  // 跨 org
  const userX = await mkUser("tb_x");
  const orgX = await db.organization.create({
    data: { name: `TB OrgX ${tag}`, code: `tbx_${tag}`, ownerId: userX.id, status: "active" },
  });
  await db.organizationMember.create({
    data: { orgId: orgX.id, userId: userX.id, role: "org_admin", status: "active" },
  });

  const actorOwner = { orgId: orgA.id, userId: userOwner.id };
  const actorWriterA = { orgId: orgA.id, userId: uWriterA.id };
  const actorReaderA = { orgId: orgA.id, userId: uReaderA.id };
  const actorWriterB = { orgId: orgA.id, userId: uWriterB.id };
  const actorPlain = { orgId: orgA.id, userId: uPlain.id };
  const actorInactive = { orgId: orgA.id, userId: uInactiveMember.id };
  const actorSuspended = { orgId: orgA.id, userId: uSuspended.id };
  const actorX = { orgId: orgX.id, userId: userX.id };
  const actorOrgAdmin = { orgId: orgA.id, userId: uOrgAdmin.id };
  const actorSuper = { orgId: orgA.id, userId: uSuper.id };

  const requirements = [
    { id: "q1", code: "R-001", text: "ANSI/BIFMA X5.1", category: "MANDATORY", mandatory: true, mandatorySignal: "must" },
  ];

  // HTTP 帮手：真实 cookie 会话（trusted principal 全部来自服务端上下文）
  async function req(user: { id: string; email: string }, url: string, init?: { method?: string; body?: unknown }) {
    const token = await createSession({ sub: user.id, email: user.email, role: "user" });
    return new NextRequest(`http://localhost${url}`, {
      method: init?.method ?? "GET",
      headers: { cookie: `qy_session=${token}`, "content-type": "application/json" },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const cleanupOrgs = [orgA.id, orgX.id];
  const cleanupUsers = [
    userOwner.id, uWriterA.id, uReaderA.id, uWriterB.id, uPlain.id,
    uInactiveMember.id, uSuspended.id, userX.id, uOrgAdmin.id, uSuper.id,
  ];

  try {
    // 连接池预热（与 S1 夹具同手段）：本套件在同一进程里跑服务层 + 路由 + 隔离库，
    // 首次并发查询会同时新建多条 Neon 连接（约 3s/条），默认 10s 池超时下偶发
    // "Timed out fetching a new connection"。预热只放宽预热事务自身的等待，不改生产默认值。
    {
      const t0 = Date.now();
      await Promise.all(
        Array.from({ length: 4 }, () =>
          db.$transaction(
            async (tx) => {
              await tx.$queryRaw`SELECT 1`;
              await new Promise((r) => setTimeout(r, 400));
            },
            { maxWait: 30_000, timeout: 30_000 },
          ),
        ),
      );
      console.log(`  · 连接池预热 4 条并发事务，耗时 ${Date.now() - t0}ms`);
    }

    // ── 被保护的对象 ──────────────────────────────────────────
    const runA = await runSvc.createSearchRun(actorOwner, {
      projectId: projA.id,
      brief: { productKeywords: ["办公椅"] },
      requirements,
    });
    const sigADirect = await signalSvc.createSubmittedSignal(actorOwner, {
      rawText: `${SECRET_MARKERS.rawText} 项目A直挂线索`,
      manualEntry: true,
      projectId: projA.id,
    });
    const sigAViaRun = await signalSvc.createSubmittedSignal(actorOwner, {
      rawText: "项目A经由 Run 归属的线索（projectId 为空）",
      manualEntry: true,
      searchRunId: runA.id,
    });
    ok(
      (await db.supplierDiscoverySignal.findUnique({ where: { id: sigAViaRun.id } }))?.projectId === null,
      "夹具前提：sigAViaRun 的 projectId 确实为 null（只能靠 Run 继承归属）",
    );
    const sigOrg = await signalSvc.createSubmittedSignal(actorPlain, {
      rawText: "组织级线索（无任何项目指针）",
      manualEntry: true,
    });

    console.log("\n== R1-T1：同 org、对项目 A 无权限 → 读不到 A 的信号，列表也看不到 ==");
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T1a：单条读取被拒（projectId 直挂）", () =>
      signalSvc.getSignal(actorWriterB, sigADirect.id));
    const listB = await signalSvc.listSignals(actorWriterB);
    const listBIds = new Set(listB.map((s) => s.id));
    ok(!listBIds.has(sigADirect.id), "R1-T1b：列表不含 A 的直挂信号");
    ok(!listBIds.has(sigAViaRun.id), "R1-T1c：列表不含 A 的 Run 继承信号");
    ok(listBIds.has(sigOrg.id), "R1-T1d：组织级线索仍可见（既有行为保留）");
    ok(
      !JSON.stringify(listB).includes(SECRET_MARKERS.rawText),
      "R1-T1e：列表载荷零受保护正文",
    );
    const countB = await signalSvc.countSignals(actorWriterB);
    ok(countB === listB.length, "R1-T1f：计数与列表同口径（不从计数泄露）", `count=${countB} list=${listB.length}`);

    console.log("\n== R1-T2：同一用户不能 review / reject / link / resolve A 的信号 ==");
    const supX = await db.supplier.create({
      data: { orgId: orgA.id, name: `TB 供应商X ${tag}`, createdById: userOwner.id },
    });
    const before = await db.supplierDiscoverySignal.findUnique({ where: { id: sigADirect.id } });
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T2a：review 被拒", () =>
      signalSvc.reviewSignal(actorWriterB, sigADirect.id));
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T2b：reject 被拒", () =>
      signalSvc.rejectSignal(actorWriterB, sigADirect.id));
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T2c：link 被拒", () =>
      signalSvc.linkSignalToSupplier(actorWriterB, sigADirect.id, { supplierId: supX.id }));
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T2d：resolve 被拒（append resolutionJson 是写）", () =>
      er.resolveSignalEntity(actorWriterB, sigADirect.id));
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T2e：capability 挂靠被拒", () =>
      signalSvc.createCapabilitySignal(actorWriterB, {
        discoverySignalId: sigADirect.id,
        type: "CNC_CAPABILITY",
        evidenceStatus: "CLAIMED",
        extractedBy: "HUMAN",
      }));
    const after = await db.supplierDiscoverySignal.findUnique({ where: { id: sigADirect.id } });
    ok(after?.status === before?.status && after?.status === "NEW", "R1-T2f：状态未发生业务变化");
    ok(after?.linkedSupplierId === null, "R1-T2g：关联未发生变化");
    ok(after?.resolutionJson === null, "R1-T2h：resolutionJson 未被 append");
    ok(
      (await db.supplierCapabilitySignal.count({ where: { discoverySignalId: sigADirect.id } })) === 0,
      "R1-T2i：capability 零写入",
    );

    console.log("\n== R1-T3：项目只读用户可读不可写 ==");
    const readByReader = await signalSvc.getSignal(actorReaderA, sigADirect.id);
    ok(readByReader?.id === sigADirect.id, "R1-T3a：viewer 可读单条");
    const readerList = await signalSvc.listSignals(actorReaderA);
    ok(readerList.some((s) => s.id === sigADirect.id), "R1-T3b：viewer 列表可见 A 的信号");
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T3c：viewer 不能 review", () =>
      signalSvc.reviewSignal(actorReaderA, sigADirect.id));
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T3d：viewer 不能 reject", () =>
      signalSvc.rejectSignal(actorReaderA, sigADirect.id));
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T3e：viewer 不能 link", () =>
      signalSvc.linkSignalToSupplier(actorReaderA, sigADirect.id, { supplierId: supX.id }));
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T3f：viewer 不能 resolve", () =>
      er.resolveSignalEntity(actorReaderA, sigADirect.id));

    console.log("\n== R1-T4：projectId=null 但 searchRunId 指向项目 A → 仍受 A 的权限保护 ==");
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T4a：无权用户读不到（不因 projectId 为空就当组织公共线索）", () =>
      signalSvc.getSignal(actorWriterB, sigAViaRun.id));
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T4b：无权用户不能 resolve", () =>
      er.resolveSignalEntity(actorWriterB, sigAViaRun.id));
    ok(
      (await signalSvc.getSignal(actorReaderA, sigAViaRun.id))?.id === sigAViaRun.id,
      "R1-T4c：项目 A 的 viewer 可读（归属解析正确，不是一律拒绝）",
    );

    console.log("\n== R1-T5：混合指针不得绕过权限 ==");
    await expectErr("INVALID_INPUT", "R1-T5a：有权项目 B 的 projectId + 无权项目 A 的 searchRunId → 冲突拒绝", () =>
      signalSvc.createSubmittedSignal(actorWriterB, {
        rawText: "混合指针尝试",
        manualEntry: true,
        projectId: projB.id,
        searchRunId: runA.id,
      }));
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T5b：只带无权项目 A 的 searchRunId → 按 A 鉴权拒绝", () =>
      signalSvc.createSubmittedSignal(actorWriterB, {
        rawText: "仅 Run 指针",
        manualEntry: true,
        searchRunId: runA.id,
      }));
    await expectErr("INVALID_INPUT", "R1-T5c：即使双项目都有权（owner），指针冲突仍拒绝（不自动重新归类）", () =>
      signalSvc.createSubmittedSignal(actorOwner, {
        rawText: "owner 混合指针",
        manualEntry: true,
        projectId: projB.id,
        searchRunId: runA.id,
      }));
    ok(
      (await db.supplierDiscoverySignal.count({ where: { orgId: orgA.id, projectId: projB.id } })) === 0,
      "R1-T5d：冲突路径零落库",
    );

    console.log("\n== R1-T6：合法项目写用户正常通过；组织级线索保留既有行为 ==");
    const sigByWriterA = await signalSvc.createSubmittedSignal(actorWriterA, {
      rawText: "项目 A 写权限用户的新线索",
      manualEntry: true,
      projectId: projA.id,
    });
    ok(Boolean(sigByWriterA.id), "R1-T6a：project_admin 可在本项目创建");
    ok((await signalSvc.reviewSignal(actorWriterA, sigByWriterA.id))?.status === "REVIEWED", "R1-T6b：可 review");
    const linked = await signalSvc.linkSignalToSupplier(actorWriterA, sigByWriterA.id, { supplierId: supX.id });
    ok(linked?.status === "LINKED" && linked?.linkedSupplierId === supX.id, "R1-T6c：可 link");
    const sigByWriterARun = await signalSvc.createSubmittedSignal(actorWriterA, {
      rawText: "挂 Run 的新线索",
      manualEntry: true,
      searchRunId: runA.id,
    });
    ok(Boolean(sigByWriterARun.id), "R1-T6d：可在本项目的 Run 上挂信号");
    const plainOrgSignal = await signalSvc.createSubmittedSignal(actorPlain, {
      rawText: "普通成员的组织级线索",
      manualEntry: true,
    });
    ok(Boolean(plainOrgSignal.id), "R1-T6e：无项目角色的 org 成员仍可建组织级线索（既有行为）");
    ok(
      (await signalSvc.getSignal(actorPlain, plainOrgSignal.id))?.id === plainOrgSignal.id,
      "R1-T6f：组织级线索可被同 org 成员读取",
    );
    ok(
      (await signalSvc.reviewSignal(actorPlain, plainOrgSignal.id))?.status === "REVIEWED",
      "R1-T6g：组织级线索的人审不被新增项目门误伤",
    );
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T6h：但普通成员仍读不到项目 A 的信号", () =>
      signalSvc.getSignal(actorPlain, sigADirect.id));

    console.log("\n== R1-T7：跨 org / 失效成员 / 异常归属引用 ==");
    ok((await signalSvc.getSignal(actorX, sigADirect.id)) === null, "R1-T7a：跨 org 读取按不存在处理");
    await expectErr("NOT_FOUND", "R1-T7b：跨 org 写入按不存在处理", () =>
      signalSvc.reviewSignal(actorX, sigADirect.id));
    ok((await signalSvc.listSignals(actorX)).length === 0, "R1-T7c：跨 org 列表为空");
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T7d：projectMember 已失效 → 拒绝", () =>
      signalSvc.getSignal(actorInactive, sigADirect.id));
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T7e：用户账号非 active → 拒绝", () =>
      signalSvc.getSignal(actorSuspended, sigADirect.id));

    // 异常归属引用：searchRunId 指向已不可解析的 Run → fail-closed（不降级成组织级线索）
    const orphanRun = await runSvc.createSearchRun(actorOwner, {
      projectId: projA.id,
      brief: { productKeywords: ["孤儿"] },
      requirements,
    });
    const orphanSignal = await signalSvc.createSubmittedSignal(actorOwner, {
      rawText: "指向将被移除 Run 的线索",
      manualEntry: true,
      searchRunId: orphanRun.id,
    });
    // 本 org 视角不可解析的 Run 引用（Run 实际属于另一个 org）——FK 仍成立，但归属无法解析
    const runX = await runSvc.createSearchRun(actorX, {
      brief: { productKeywords: ["跨 org"] },
      requirements,
    });
    await db.$executeRaw`UPDATE "SupplierDiscoverySignal" SET "searchRunId" = ${runX.id} WHERE "id" = ${orphanSignal.id}`;
    await expectErr("NOT_FOUND", "R1-T7f：不可解析的 Run 引用 → fail-closed，不当组织级线索", () =>
      signalSvc.getSignal(actorWriterB, orphanSignal.id));
    await expectErr("NOT_FOUND", "R1-T7g：连 owner 也不能借不可解析引用读取（不选最宽松归属）", () =>
      signalSvc.getSignal(actorOwner, orphanSignal.id));
    ok(
      !(await signalSvc.listSignals(actorOwner)).some((s) => s.id === orphanSignal.id),
      "R1-T7h：归属不可解析的信号不出现在列表里",
    );
    await db.$executeRaw`UPDATE "SupplierDiscoverySignal" SET "searchRunId" = ${orphanRun.id} WHERE "id" = ${orphanSignal.id}`;

    // 授权失败不得产生 provider 调用（既有 S2-FR-T8 不变量在信号轮的再验证）
    let providerCalls = 0;
    const countingProvider: Provider = {
      providerId: "tb-counting",
      policy: { respectsRobots: true, requiresPlatformLogin: false, dataLicense: "test" },
      isAvailable: () => true,
      search: async () => {
        providerCalls += 1;
        return { status: "SUCCESS", results: [] };
      },
    };
    await runSvc.startSearchRun(actorOwner, orphanRun.id);
    await expectErr("PROJECT_ACCESS_DENIED", "R1-T7i：无项目权限执行发现被拒", () =>
      discovery.executeSupplierSearchRun(actorWriterB, orphanRun.id, { provider: countingProvider }));
    ok(providerCalls === 0, "R1-T7j：授权失败路径 provider 调用数 = 0", `实际 ${providerCalls}`);

    console.log("\n== R1-T8：受保护项目里的同身份冲突不得被可见性过滤掉 ==");
    // 项目 A（uWriterB 无权）里：同一抖音账号先后被 LINK 到两家供应商 → org 全量宇宙里存在冲突
    const supConflict1 = await db.supplier.create({
      data: { orgId: orgA.id, name: `TB 冲突供应商1 ${tag}`, createdById: userOwner.id },
    });
    const supConflict2 = await db.supplier.create({
      data: { orgId: orgA.id, name: `TB 冲突供应商2 ${tag}`, createdById: userOwner.id },
    });
    const collideKeyUrl = `https://www.douyin.com/user/tb_collide_${tag}`;
    for (const sup of [supConflict1, supConflict2]) {
      const s = await signalSvc.createSubmittedSignal(actorOwner, {
        url: collideKeyUrl,
        rawText: `${SECRET_MARKERS.rawText} 受保护项目里的历史记录`,
        projectId: projA.id,
      });
      await db.supplierDiscoverySignal.update({
        where: { id: s.id },
        data: { title: SECRET_MARKERS.title, description: SECRET_MARKERS.description },
      });
      await signalSvc.linkSignalToSupplier(actorOwner, s.id, { supplierId: sup.id, note: SECRET_MARKERS.note });
    }
    // 单一历史（无冲突）对照：证明扫描确实看得见受保护项目的历史
    const supSolo = await db.supplier.create({
      data: { orgId: orgA.id, name: `TB 单一供应商 ${tag}`, createdById: userOwner.id },
    });
    const soloKeyUrl = `https://www.douyin.com/user/tb_solo_${tag}`;
    const soloHistory = await signalSvc.createSubmittedSignal(actorOwner, {
      url: soloKeyUrl,
      rawText: `${SECRET_MARKERS.rawText} 受保护项目里的单一历史`,
      projectId: projA.id,
    });
    await signalSvc.linkSignalToSupplier(actorOwner, soloHistory.id, { supplierId: supSolo.id });

    const sigInB = await signalSvc.createSubmittedSignal(actorWriterB, {
      url: collideKeyUrl,
      rawText: "项目 B 里看到同一个账号",
      projectId: projB.id,
    });
    const resB = await er.resolveSignalEntity(actorWriterB, sigInB.id);
    ok(resB.decision === "NEEDS_HUMAN_REVIEW", "R1-T8a：受保护项目里的同身份冲突仍生效 → 不给强匹配", resB.decision);
    ok(resB.supplierId === undefined, "R1-T8b：不返回被挑选的 supplierId");
    ok(resB.scan.complete === true, "R1-T8c：扫描仍是 org 全量（未被可见性裁剪后谎称完整）");
    ok(
      resB.conflicts.some((c) => c.includes(supConflict1.id) && c.includes(supConflict2.id)),
      "R1-T8d：冲突元数据保留全部候选（不 first-wins）",
    );
    const payload = JSON.stringify(resB);
    ok(
      !payload.includes(SECRET_MARKERS.title) &&
        !payload.includes(SECRET_MARKERS.description) &&
        !payload.includes(SECRET_MARKERS.note) &&
        !payload.includes(SECRET_MARKERS.rawText),
      "R1-T8e：响应零泄露受保护项目的标题/描述/备注/正文",
    );

    const sigInBSolo = await signalSvc.createSubmittedSignal(actorWriterB, {
      url: soloKeyUrl,
      rawText: "项目 B 里看到单一历史账号",
      projectId: projB.id,
    });
    const resSolo = await er.resolveSignalEntity(actorWriterB, sigInBSolo.id);
    ok(
      resSolo.decision === "MATCHED_EXISTING" && resSolo.supplierId === supSolo.id,
      "R1-T8f：无冲突时仍按 org 全量身份宇宙给出预填（证明扫描没被裁剪）",
      resSolo.decision,
    );
    ok(
      !JSON.stringify(resSolo).includes(SECRET_MARKERS.rawText),
      "R1-T8g：预填响应同样零受保护正文",
    );

    console.log("\n== R1 HTTP 边界 ==");
    const r1 = await signalItemRoute.GET(await req(uWriterB, `/api/supplier-intel/signals/${sigADirect.id}`), ctx(sigADirect.id));
    ok(r1.status === 403, "HTTP-1：无项目权限 GET 单条 → 403", `实际 ${r1.status}`);
    ok(!JSON.stringify(await r1.json()).includes(SECRET_MARKERS.rawText), "HTTP-2：403 响应零受保护内容");

    const r2 = await signalItemRoute.GET(await req(uReaderA, `/api/supplier-intel/signals/${sigADirect.id}`), ctx(sigADirect.id));
    ok(r2.status === 200, "HTTP-3：项目 viewer GET 单条 → 200", `实际 ${r2.status}`);

    const r3 = await signalItemRoute.PATCH(
      await req(uReaderA, `/api/supplier-intel/signals/${sigADirect.id}`, { method: "PATCH", body: { action: "review" } }),
      ctx(sigADirect.id),
    );
    ok(r3.status === 403, "HTTP-4：项目 viewer PATCH review → 403", `实际 ${r3.status}`);
    ok(
      (await db.supplierDiscoverySignal.findUnique({ where: { id: sigADirect.id } }))?.status === "NEW",
      "HTTP-5：被拒的 PATCH 零业务写入",
    );

    const r4 = await signalResolveRoute.POST(
      await req(uWriterB, `/api/supplier-intel/signals/${sigADirect.id}/resolve`, { method: "POST", body: {} }),
      ctx(sigADirect.id),
    );
    ok(r4.status === 403, "HTTP-6：无权用户 POST resolve → 403（写操作）", `实际 ${r4.status}`);
    ok(
      (await db.supplierDiscoverySignal.findUnique({ where: { id: sigADirect.id } }))?.resolutionJson === null,
      "HTTP-7：被拒的 resolve 未 append resolutionJson",
    );

    const r5 = await signalsRoute.GET(await req(uWriterB, `/api/supplier-intel/signals`));
    const listPayload = (await r5.json()) as { signals: Array<{ id: string }> };
    ok(r5.status === 200, "HTTP-8：列表 200");
    ok(
      !listPayload.signals.some((s) => s.id === sigADirect.id || s.id === sigAViaRun.id),
      "HTTP-9：列表不含无权项目的信号",
    );

    const r6 = await signalsRoute.POST(
      await req(uWriterB, `/api/supplier-intel/signals`, {
        method: "POST",
        body: { rawText: "HTTP 混合指针尝试", manualEntry: true, projectId: projB.id, searchRunId: runA.id },
      }),
    );
    ok(r6.status === 400, "HTTP-10：HTTP 面混合指针 → 400 领域错误（非 500）", `实际 ${r6.status}`);
    const r6body = (await r6.json()) as { code?: string };
    ok(r6body.code === "INVALID_INPUT", "HTTP-11：返回明确领域错误码", JSON.stringify(r6body));

    const r7 = await signalsRoute.POST(
      await req(uWriterB, `/api/supplier-intel/signals`, {
        method: "POST",
        body: { rawText: "HTTP 借 Run 越权", manualEntry: true, searchRunId: runA.id },
      }),
    );
    ok(r7.status === 403, "HTTP-12：借 Run 归属越权创建 → 403", `实际 ${r7.status}`);

    // ─────────────────── R2：来源不可证完整 → 明确阻断 ───────────────────
    console.log("\n== R2-T6：阻断发生在 Run 创建 / LLM / provider 之前 ==");
    let llmCalls = 0;
    const countingInvoker: LlmInvoker = async () => {
      llmCalls += 1;
      return { content: "{}", model: "should-not-be-called", elapsedMs: 1 };
    };

    // projC：有 Boolean=false 的需求行，但 RISKS 章节缺失
    const projC = await db.project.create({
      data: { orgId: orgA.id, name: `TB ProjC ${tag}`, ownerId: userOwner.id, workDomain: "tender", intakeStatus: "dispatched" },
    });
    const analysisC = await db.tenderAnalysisRun.create({
      data: { orgId: orgA.id, projectId: projC.id, status: "APPROVED", idempotencyKey: `tb_c_${tag}`, sourceHashFingerprint: "tb" },
    });
    for (const r of [
      { code: "R-001", mandatory: true },
      { code: "R-002", mandatory: false },
    ]) {
      await db.tenderExtractedRequirement.create({
        data: {
          projectId: projC.id,
          analysisRunId: analysisC.id,
          requirementCode: r.code,
          category: "technical",
          originalRequirement: `req ${r.code}`,
          chineseTranslation: `req ${r.code}`,
          mandatory: r.mandatory,
        },
      });
    }
    await expectErr("BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE", "R2-T1（DB）：RISKS 缺失 → 阻断，不生成静默 false 快照", () =>
      canonicalMod.loadCanonicalSupplierRequirementSnapshot({ orgId: orgA.id, projectId: projC.id }));
    await expectErr("BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE", "R2-T6a：createProjectSearchRun 被阻断", () =>
      projectRunSvc.createProjectSearchRun(actorOwner, { projectId: projC.id }, { invoker: countingInvoker }));
    ok((await db.supplierSearchRun.count({ where: { orgId: orgA.id, projectId: projC.id } })) === 0, "R2-T6b：可执行 Run 创建数 = 0");
    ok(llmCalls === 0, "R2-T6c：LLM 调用数 = 0", `实际 ${llmCalls}`);
    ok(
      (await db.supplierDiscoverySignal.count({ where: { orgId: orgA.id, projectId: projC.id } })) === 0,
      "R2-T6d：零 Run ⇒ 零发现执行 ⇒ provider 调用数 = 0（无信号落库）",
    );

    // projD：RISKS 存在但结构非法（legacy report.ts 形状）
    const projD = await db.project.create({
      data: { orgId: orgA.id, name: `TB ProjD ${tag}`, ownerId: userOwner.id, workDomain: "tender", intakeStatus: "dispatched" },
    });
    const analysisD = await db.tenderAnalysisRun.create({
      data: { orgId: orgA.id, projectId: projD.id, status: "REVIEW_REQUIRED", idempotencyKey: `tb_d_${tag}`, sourceHashFingerprint: "tb" },
    });
    await db.tenderExtractedRequirement.create({
      data: {
        projectId: projD.id, analysisRunId: analysisD.id, requirementCode: "R-001",
        category: "technical", originalRequirement: "req", chineseTranslation: "req", mandatory: false,
      },
    });
    await db.tenderAnalysisSection.create({
      data: { runId: analysisD.id, sectionKey: "RISKS", contentZh: "legacy", structuredJson: { kind: "risks", inventedHistoricalAwards: false } },
    });
    await expectErr("BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE", "R2-T2（DB）：legacy/非法结构 → 阻断", () =>
      projectRunSvc.createProjectSearchRun(actorOwner, { projectId: projD.id }, { invoker: countingInvoker }));
    ok((await db.supplierSearchRun.count({ where: { orgId: orgA.id, projectId: projD.id } })) === 0, "R2-T6e：非法结构路径 Run 数 = 0");

    console.log("\n== R2-T3/T4（DB）：真实 writer 的有效分析正常读取，三值准确保留 ==");
    const analysisA = await db.tenderAnalysisRun.create({
      data: { orgId: orgA.id, projectId: projA.id, status: "APPROVED", idempotencyKey: `tb_a_${tag}`, sourceHashFingerprint: "tb" },
    });
    const seed = [
      { code: "R-001", mandatory: true as const },
      { code: "R-002", mandatory: false as const },
      { code: "R-003", mandatory: "uncertain" as const },
    ];
    for (const r of seed) {
      await db.tenderExtractedRequirement.create({
        data: {
          projectId: projA.id, analysisRunId: analysisA.id, requirementCode: r.code,
          category: "technical", originalRequirement: `req ${r.code}`, chineseTranslation: `req ${r.code}`,
          // 持久层塌缩：uncertain 落库为 false
          mandatory: r.mandatory === true,
        },
      });
    }
    await db.tenderAnalysisSection.create({
      data: {
        runId: analysisA.id,
        sectionKey: "RISKS",
        contentZh: "1 条强制性不确定",
        structuredJson: buildCanonicalRisksStructuredJson(seed) as never,
      },
    });
    const snap = await canonicalMod.loadCanonicalSupplierRequirementSnapshot({ orgId: orgA.id, projectId: projA.id });
    const byCode = new Map(snap.entries.map((e) => [e.code, e.mandatory]));
    ok(byCode.get("R-001") === true, "R2-T4a：true 忠实");
    ok(byCode.get("R-002") === false, "R2-T4b：合法 false 不被错误升级");
    ok(byCode.get("R-003") === "uncertain", "R2-T4c：uncertain 幸存");
    ok(snap.uncertainSourceStatus === "VALID", "R2-T4d：来源判定随快照返回（审计）");

    const validRun = await projectRunSvc.createProjectSearchRun(
      actorOwner,
      { projectId: projA.id, allowLlm: false },
      { invoker: countingInvoker },
    );
    ok(Boolean(validRun.id), "R2-T3（DB）：有效来源正常开搜（不是一律阻断）");
    const cfg = validRun.sourceConfigJson as Record<string, unknown>;
    ok(cfg.canonicalUncertainSourceStatus === "VALID", "R2：Run 快照留下来源判定审计指针");

    // 零 uncertain 的有效分析同样放行
    const projE = await db.project.create({
      data: { orgId: orgA.id, name: `TB ProjE ${tag}`, ownerId: userOwner.id, workDomain: "tender", intakeStatus: "dispatched" },
    });
    const analysisE = await db.tenderAnalysisRun.create({
      data: { orgId: orgA.id, projectId: projE.id, status: "APPROVED", idempotencyKey: `tb_e_${tag}`, sourceHashFingerprint: "tb" },
    });
    const seedE = [
      { code: "R-001", mandatory: true as const },
      { code: "R-002", mandatory: false as const },
    ];
    for (const r of seedE) {
      await db.tenderExtractedRequirement.create({
        data: {
          projectId: projE.id, analysisRunId: analysisE.id, requirementCode: r.code,
          category: "technical", originalRequirement: `req ${r.code}`, chineseTranslation: `req ${r.code}`,
          mandatory: r.mandatory,
        },
      });
    }
    await db.tenderAnalysisSection.create({
      data: {
        runId: analysisE.id, sectionKey: "RISKS", contentZh: "无不确定项",
        structuredJson: buildCanonicalRisksStructuredJson(seedE) as never,
      },
    });
    const snapE = await canonicalMod.loadCanonicalSupplierRequirementSnapshot({ orgId: orgA.id, projectId: projE.id });
    ok(snapE.uncertainCount === 0 && snapE.uncertainSourceReason === "NO_UNCERTAIN_AGGREGATE",
      "R2-T3b：可证零 uncertain 的分析正常放行（有效空集合 ≠ 无效来源）");

    console.log("\n== R2-T7：客户端伪造 requirements / 完整性声明不解除阻断（HTTP）==");
    const r8 = await runsRoute.POST(
      await req(userOwner, `/api/supplier-intel/runs`, {
        method: "POST",
        body: {
          projectId: projC.id,
          requirements: [{ id: "x", code: "R-001", text: "客户端伪造", mandatory: false, mandatorySignal: null }],
          uncertainComplete: true,
          complete: true,
          canonicalUncertainSourceStatus: "VALID",
          useLlm: false,
        },
      }),
    );
    ok(r8.status === 409, "R2-T7a：伪造完整性声明仍被阻断（409 领域错误，非 500/201）", `实际 ${r8.status}`);
    const r8body = (await r8.json()) as { code?: string };
    ok(r8body.code === "BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE", "R2-T7b：返回既有领域错误码", JSON.stringify(r8body));
    ok((await db.supplierSearchRun.count({ where: { orgId: orgA.id, projectId: projC.id } })) === 0, "R2-T7c：HTTP 伪造路径 Run 数仍为 0");
    ok(llmCalls === 0, "R2-T7d：全部阻断路径 LLM 调用数累计 = 0", `实际 ${llmCalls}`);

    const r9 = await runsRoute.POST(
      await req(userOwner, `/api/supplier-intel/runs`, {
        method: "POST",
        body: { projectId: projA.id, useLlm: false, requirements: [{ code: "R-999", mandatory: false }] },
      }),
    );
    ok(r9.status === 201, "R2-T7e：有效项目仍能开搜（伪造字段被忽略而非致错）", `实际 ${r9.status}`);
    const r9body = (await r9.json()) as { run: { requirementSnapshotJson: Array<Record<string, unknown>> } };
    const snapCodes = r9body.run.requirementSnapshotJson.map((e) => e.code);
    ok(!snapCodes.includes("R-999"), "R2-T7f：客户端 requirements 未进入服务端快照");
    ok(
      r9body.run.requirementSnapshotJson.find((e) => e.code === "R-003")?.mandatory === "uncertain",
      "R2-T7g：服务端 canonical 三值仍然生效",
    );


    // ════════════ R1 Edge Closure ════════════
    console.log("\n== A：org_admin 的列表 / 计数 / 单条必须同口径（非 dispatched 项目不得泄露）==");
    // 夹具：项目派发期间由 owner 正常建 Run 与信号，随后项目回到 pending_dispatch
    const projPending = await db.project.create({
      data: { orgId: orgA.id, name: `TB ProjPending ${tag}`, ownerId: userOwner.id, workDomain: "tender", intakeStatus: "dispatched" },
    });
    const runPending = await runSvc.createSearchRun(actorOwner, {
      projectId: projPending.id,
      brief: { productKeywords: ["待派发"] },
      requirements,
    });
    const sigPendingDirect = await signalSvc.createSubmittedSignal(actorOwner, {
      rawText: `${PENDING_MARKER} 非 dispatched 项目直挂线索`,
      manualEntry: true,
      projectId: projPending.id,
    });
    const sigPendingViaRun = await signalSvc.createSubmittedSignal(actorOwner, {
      rawText: "非 dispatched 项目经 Run 继承的线索",
      manualEntry: true,
      searchRunId: runPending.id,
    });
    await db.project.update({ where: { id: projPending.id }, data: { intakeStatus: "pending_dispatch" } });
    ok(
      (await db.supplierDiscoverySignal.findUnique({ where: { id: sigPendingViaRun.id } }))?.projectId === null,
      "A 夹具前提：sigPendingViaRun 的 projectId 为 null（只能靠 Run 继承）",
    );

    // A1：单条不可读 → 列表/计数必须一致
    await expectErr("NOT_FOUND", "A1a：org_admin 读不到非 dispatched 项目的信号（单条 canonical 口径）", () =>
      signalSvc.getSignal(actorOrgAdmin, sigPendingDirect.id));
    const adminList = await signalSvc.listSignals(actorOrgAdmin, { take: 200 });
    const adminIds = new Set(adminList.map((x) => x.id));
    ok(!adminIds.has(sigPendingDirect.id), "A1b：列表不返回该信号（修复前 org_admin 走 unrestricted 会返回）");
    ok(
      !JSON.stringify(adminList).includes(PENDING_MARKER),
      "A1c：列表载荷零非 dispatched 项目正文",
    );
    const adminCount = await signalSvc.countSignals(actorOrgAdmin);
    ok(adminCount === adminList.length, "A1d：计数与列表同口径", `count=${adminCount} list=${adminList.length}`);

    // A2：projectId=null、经 searchRunId 继承非 dispatched 项目
    await expectErr("NOT_FOUND", "A2a：Run 继承的非 dispatched 项目信号单条不可读", () =>
      signalSvc.getSignal(actorOrgAdmin, sigPendingViaRun.id));
    ok(!adminIds.has(sigPendingViaRun.id), "A2b：列表同样不返回（tenderId / Run 继承受同一约束）");

    // A3：dispatched 正常读取与组织级线索不回归
    ok(
      (await signalSvc.getSignal(actorOrgAdmin, sigADirect.id))?.id === sigADirect.id,
      "A3a：org_admin 仍可读 dispatched 项目的信号",
    );
    ok(adminIds.has(sigADirect.id), "A3b：dispatched 项目信号仍在列表内");
    ok(adminIds.has(sigOrg.id), "A3c：真正的组织级线索不回归");
    ok(
      (await signalSvc.reviewSignal(actorOrgAdmin, sigAViaRun.id))?.status === "REVIEWED",
      "A3d：org_admin 对 dispatched 项目的写操作不回归",
    );

    // A4：super_admin 既有特权保留，但 org 隔离与不可解析 Run 保护不放松
    ok(
      (await signalSvc.getSignal(actorSuper, sigPendingDirect.id))?.id === sigPendingDirect.id,
      "A4a：super_admin 既有特殊规则保留（单条可读）",
    );
    const superList = await signalSvc.listSignals(actorSuper, { take: 200 });
    ok(superList.some((x) => x.id === sigPendingDirect.id), "A4b：super_admin 列表与单条一致");
    const foreignSignal = await signalSvc.createSubmittedSignal(actorX, {
      rawText: "另一个 org 的线索",
      manualEntry: true,
    });
    ok(!superList.some((x) => x.id === foreignSignal.id), "A4c：super_admin 仍受 org 隔离（不跨 org）");
    const superOrphan = await signalSvc.createSubmittedSignal(actorOwner, {
      rawText: "指向他 org Run 的线索",
      manualEntry: true,
      searchRunId: orphanRun.id,
    });
    await db.$executeRaw`UPDATE "SupplierDiscoverySignal" SET "searchRunId" = ${runX.id} WHERE "id" = ${superOrphan.id}`;
    const superList2 = await signalSvc.listSignals(actorSuper, { take: 200 });
    ok(
      !superList2.some((x) => x.id === superOrphan.id),
      "A4d：不可解析 Run 的保护对 super_admin 同样成立",
    );
    await expectErr("NOT_FOUND", "A4e：super_admin 单条同样 fail-closed", () =>
      signalSvc.getSignal(actorSuper, superOrphan.id));

    console.log("\n== A HTTP：org_admin 走真实路由的一致性 ==");
    const ra1 = await signalItemRoute.GET(
      await req(uOrgAdmin, `/api/supplier-intel/signals/${sigPendingDirect.id}`),
      ctx(sigPendingDirect.id),
    );
    ok(ra1.status === 404, "A-HTTP1：org_admin GET 非 dispatched 项目信号 → 404", `实际 ${ra1.status}`);
    const ra2 = await signalsRoute.GET(await req(uOrgAdmin, `/api/supplier-intel/signals`));
    const ra2body = (await ra2.json()) as { signals: Array<{ id: string }> };
    ok(
      ra2.status === 200 && !ra2body.signals.some((x) => x.id === sigPendingDirect.id || x.id === sigPendingViaRun.id),
      "A-HTTP2：org_admin 列表不含非 dispatched 项目的信号",
    );
    ok(ra2body.signals.some((x) => x.id === sigADirect.id), "A-HTTP3：dispatched 项目信号仍在 HTTP 列表内");

    console.log("\n== B：tenderId 与 Run 项目归属的对称校验 ==");
    // userOwner 是 org_admin，对 projA / projB 都有写权限 → 拒绝理由只能是指针冲突本身
    const beforeB = await db.supplierDiscoverySignal.count({ where: { orgId: orgA.id } });
    const beforeAudit = await db.auditLog.count({
      where: { orgId: orgA.id, action: SUPPLIER_INTEL_AUDIT_ACTIONS.SIGNAL_CREATED },
    });
    await expectErr("INVALID_INPUT", "B1a：Run(projectId=A, tenderId=null) + Input(tenderId=B) → 冲突拒绝", () =>
      signalSvc.createSubmittedSignal(actorOwner, {
        rawText: "遗漏组合",
        manualEntry: true,
        tenderId: projB.id,
        searchRunId: runA.id,
      }));
    const rb1 = await signalsRoute.POST(
      await req(userOwner, `/api/supplier-intel/signals`, {
        method: "POST",
        body: { rawText: "HTTP 遗漏组合", manualEntry: true, tenderId: projB.id, searchRunId: runA.id },
      }),
    );
    ok(rb1.status === 400, "B1b：HTTP 创建同样拒绝（400 领域错误）", `实际 ${rb1.status}`);
    ok(((await rb1.json()) as { code?: string }).code === "INVALID_INPUT", "B1c：返回 INVALID_INPUT 语义");
    ok(
      (await db.supplierDiscoverySignal.count({ where: { orgId: orgA.id } })) === beforeB,
      "B1d：service 与 HTTP 两条拒绝路径零信号落库",
    );
    ok(
      (await db.auditLog.count({
        where: { orgId: orgA.id, action: SUPPLIER_INTEL_AUDIT_ACTIONS.SIGNAL_CREATED },
      })) === beforeAudit,
      "B1e：两条拒绝路径零新增成功业务审计记录（前后差值 0）",
    );

    // B2：既有反向组合继续拒绝（Run.projectId=null / Run.tenderId=A，Input.projectId=B）
    const runTenderOnly = await runSvc.createSearchRun(actorOwner, {
      tenderId: projA.id,
      brief: { productKeywords: ["仅 tender"] },
      requirements,
    });
    ok(
      (await db.supplierSearchRun.findUnique({ where: { id: runTenderOnly.id } }))?.projectId === null,
      "B2 夹具前提：该 Run 只挂 tenderId",
    );
    await expectErr("INVALID_INPUT", "B2：Run(tenderId=A) + Input(projectId=B) 继续拒绝", () =>
      signalSvc.createSubmittedSignal(actorOwner, {
        rawText: "反向组合",
        manualEntry: true,
        projectId: projB.id,
        searchRunId: runTenderOnly.id,
      }));

    // B3：合法指针通过
    const okSame = await signalSvc.createSubmittedSignal(actorOwner, {
      rawText: "同项目指针",
      manualEntry: true,
      projectId: projA.id,
      searchRunId: runA.id,
    });
    ok(Boolean(okSame.id), "B3a：projectId 与 Run 一致 → 通过");
    const okTenderSame = await signalSvc.createSubmittedSignal(actorOwner, {
      rawText: "tenderId 指向 Run 的项目",
      manualEntry: true,
      tenderId: projA.id,
      searchRunId: runA.id,
    });
    ok(Boolean(okTenderSame.id), "B3b：tenderId 指向 Run 的 projectId → 通过（不误伤）");
    const okInherit = await signalSvc.createSubmittedSignal(actorOwner, {
      rawText: "仅继承 Run",
      manualEntry: true,
      searchRunId: runA.id,
    });
    ok(Boolean(okInherit.id), "B3c：省略直接指针、仅继承 Run → 通过");

    // B4：discovered-signal 共享路径同样生效（零新增逐结果权限查询——仍是事务内纯函数校验）
    await expectErr("INVALID_INPUT", "B4a：createDiscoveredSignal 走同一 helper，冲突同样拒绝", () =>
      signalSvc.createDiscoveredSignal(actorOwner, {
        searchRunId: runA.id,
        platform: "OPEN_WEB",
        contentUrl: `https://b4-conflict-${tag}.example/x`,
        tenderId: projB.id,
      }));
    const discovered = await signalSvc.createDiscoveredSignal(actorOwner, {
      searchRunId: runA.id,
      platform: "OPEN_WEB",
      contentUrl: `https://b4-ok-${tag}.example/x`,
    });
    ok(discovered.created && discovered.signal.projectId === projA.id, "B4b：正常 discovered 路径不回归（继承 Run 归属）");

    console.log(`\nS2-TB 断言：${pass} 通过 / ${fail} 失败`);
  } finally {
    // 清理（顺序：情报 → tender → 项目 → 组织 → 用户）
    await db.supplierCapabilitySignal.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierDiscoverySignal.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierCandidate.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierSearchRun.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplier.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.tenderAnalysisSection.deleteMany({ where: { run: { orgId: { in: cleanupOrgs } } } });
    await db.tenderExtractedRequirement.deleteMany({ where: { analysisRun: { orgId: { in: cleanupOrgs } } } });
    await db.tenderAnalysisRun.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.auditLog.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.projectMember.deleteMany({ where: { project: { orgId: { in: cleanupOrgs } } } });
    await db.project.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.organization.deleteMany({ where: { id: { in: cleanupOrgs } } });
    await db.user.deleteMany({ where: { id: { in: cleanupUsers } } });
    await db.$disconnect();
  }

  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
