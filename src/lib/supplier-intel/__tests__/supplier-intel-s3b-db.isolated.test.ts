/**
 * S3-B 供应商能力与资质归一：服务 + HTTP 集成（隔离库执行，否则跳过）。
 *
 * 这一套守的是 S3-B 的三条纪律：
 *   1. CLAIMED ≠ VERIFIED——客户端无论怎么传都产不出 VERIFIED；
 *   2. 缺价合法——没有单价不是拒绝理由；
 *   3. 能力必须有出处——能力声明只能挂在已归属到本供应商的线索上。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("⏭  跳过 S3-B DB 测试（未提供 DATABASE_URL）");
    process.exit(0);
  }
  if (process.env.NODE_ENV !== "test") {
    console.log("⏭  跳过 S3-B DB 测试（需 NODE_ENV=test）");
    process.exit(0);
  }
  if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") {
    console.log("⏭  跳过 S3-B DB 测试（需 DATABASE_ENVIRONMENT=isolated）");
    process.exit(0);
  }
  assertSafeTestDatabase({ scriptName: "supplier-intel s3b capability" });
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
  process.env.JWT_SECRET = process.env.JWT_SECRET || "s3b-db-test-secret";

  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { isSupplierIntelError } = await import("../errors");
  const view = await import("../supplier-capability-view");
  const signalSvc = await import("../signal-service");
  const { createSession } = await import("@/lib/auth/session");

  const capabilityRoute = await import(
    "@/app/api/supplier-intel/suppliers/[supplierId]/capability/route"
  );
  const offeringsRoute = await import(
    "@/app/api/supplier-intel/suppliers/[supplierId]/offerings/route"
  );
  const certsRoute = await import(
    "@/app/api/supplier-intel/suppliers/[supplierId]/certifications/route"
  );
  const certActionRoute = await import(
    "@/app/api/supplier-intel/suppliers/[supplierId]/certifications/[certificationId]/route"
  );
  const capSignalsRoute = await import(
    "@/app/api/supplier-intel/suppliers/[supplierId]/capability-signals/route"
  );

  async function expectErr(code: string, name: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      ok(false, `${name}（期望抛 ${code}，实际成功）`);
    } catch (e) {
      if (isSupplierIntelError(e, code as never)) ok(true, name);
      else ok(false, name, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  }

  const tag = `s3b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const mk = (slug: string) =>
    db.user.create({
      data: { email: `${slug}_${tag}@test.qingyan.local`, name: slug, role: "user", status: "active" },
    });
  const owner = await mk("s3b_owner");
  const member = await mk("s3b_member");
  const stranger = await mk("s3b_stranger");

  const org = await db.organization.create({
    data: { name: `S3B Org ${tag}`, code: `s3b_${tag}`, ownerId: owner.id, status: "active" },
  });
  const otherOrg = await db.organization.create({
    data: { name: `S3B Other ${tag}`, code: `s3b_other_${tag}`, ownerId: stranger.id, status: "active" },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: org.id, userId: owner.id, role: "org_admin", status: "active" },
      { orgId: org.id, userId: member.id, role: "org_member", status: "active" },
      { orgId: otherOrg.id, userId: stranger.id, role: "org_admin", status: "active" },
    ],
  });

  const project = await db.project.create({
    data: {
      orgId: org.id, name: `S3B Proj ${tag}`, ownerId: owner.id, workDomain: "tender",
      intakeStatus: "dispatched", status: "active",
    },
  });

  const supplier = await db.supplier.create({
    data: { orgId: org.id, name: `S3B 演示供应商 ${tag}`, createdById: owner.id },
  });
  const otherSupplier = await db.supplier.create({
    data: { orgId: otherOrg.id, name: `S3B 他组织供应商 ${tag}`, createdById: stranger.id },
  });

  const actorOwner = { orgId: org.id, userId: owner.id };
  const actorStranger = { orgId: otherOrg.id, userId: stranger.id };

  async function req(
    user: { id: string; email: string },
    url: string,
    init?: { method?: string; body?: unknown },
  ) {
    const token = await createSession({ sub: user.id, email: user.email, role: "user" });
    return new NextRequest(`http://localhost${url}`, {
      method: init?.method ?? "GET",
      headers: { cookie: `qy_session=${token}`, "content-type": "application/json" },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  }

  const cleanupOrgs = [org.id, otherOrg.id];
  const cleanupUsers = [owner.id, member.id, stranger.id];

  try {
    /* 线索：一条已归属（LINKED），一条未归属（NEW） */
    const linkedSignal = await signalSvc.createSubmittedSignal(actorOwner, {
      url: `https://s3b-demo.example/${tag}/a`,
      rawText: `${tag} 工厂自述：有 CNC 与喷粉线`,
      manualEntry: true,
      projectId: project.id,
    });
    await signalSvc.reviewSignal(actorOwner, linkedSignal.id);
    await signalSvc.linkSignalToSupplier(actorOwner, linkedSignal.id, { supplierId: supplier.id });
    const looseSignal = await signalSvc.createSubmittedSignal(actorOwner, {
      url: `https://s3b-demo.example/${tag}/b`,
      rawText: `${tag} 未归属线索`,
      manualEntry: true,
      projectId: project.id,
    });

    console.log("\n== B1：访问门（org 级资源，跨 org 不泄露存在性）==");
    const v = await view.loadSupplierCapabilityView(actorOwner, supplier.id);
    ok(v.supplier.id === supplier.id, "B1a：本 org 成员可读");
    ok(v.canWrite === true, "B1b：活跃成员有写权限");
    await expectErr("NOT_FOUND", "B1c：他 org 读本 org 供应商 → NOT_FOUND", () =>
      view.loadSupplierCapabilityView(actorStranger, supplier.id));
    await expectErr("NOT_FOUND", "B1d：本 org 读他 org 供应商 → NOT_FOUND", () =>
      view.loadSupplierCapabilityView(actorOwner, otherSupplier.id));
    const httpForbidden = await capabilityRoute.GET(
      await req(stranger, `/api/supplier-intel/suppliers/${supplier.id}/capability?orgId=${otherOrg.id}`),
      { params: Promise.resolve({ supplierId: supplier.id }) },
    );
    ok(httpForbidden.status === 404, "B1e：HTTP 跨 org → 404", `实际 ${httpForbidden.status}`);
    ok(
      !JSON.stringify(await httpForbidden.json()).includes(tag),
      "B1f：404 响应零业务内容",
    );

    console.log("\n== B2：缺价合法（Supplier ≠ Product）==");
    const noPriceRes = await offeringsRoute.POST(
      await req(member, `/api/supplier-intel/suppliers/${supplier.id}/offerings?orgId=${org.id}`, {
        method: "POST",
        body: { name: `办公椅 A ${tag}`, category: "seating" },
      }),
      { params: Promise.resolve({ supplierId: supplier.id }) },
    );
    ok(noPriceRes.status === 201, "B2a：不带价格也能建档", `实际 ${noPriceRes.status}`);
    const noPriceBody = (await noPriceRes.json()) as { offering: { id: string; priceStatus: string; unitPrice: unknown } };
    ok(noPriceBody.offering.priceStatus === "UNKNOWN", "B2b：priceStatus 默认 UNKNOWN");
    ok(noPriceBody.offering.unitPrice === null, "B2c：单价为空不是错误");

    console.log("\n== B3：来源不可被客户端冒称 ==");
    const spoofRes = await offeringsRoute.POST(
      await req(member, `/api/supplier-intel/suppliers/${supplier.id}/offerings?orgId=${org.id}`, {
        method: "POST",
        body: { name: `冒称来源 ${tag}`, sourceKind: "DISCOVERY" },
      }),
      { params: Promise.resolve({ supplierId: supplier.id }) },
    );
    ok(spoofRes.status === 201, "B3a：请求本身成功");
    const spoofBody = (await spoofRes.json()) as { offering: { id: string; sourceKind: string } };
    ok(
      spoofBody.offering.sourceKind === "MANUAL",
      "B3b：sourceKind 被服务端固定为 MANUAL（客户端不能自称「这是搜出来的」）",
      `实际 ${spoofBody.offering.sourceKind}`,
    );

    console.log("\n== B4：资质登记永远只产出 CLAIMED ==");
    const certRes = await certsRoute.POST(
      await req(member, `/api/supplier-intel/suppliers/${supplier.id}/certifications?orgId=${org.id}`, {
        method: "POST",
        body: {
          scope: "SUPPLIER",
          certificationType: "ISO_9001",
          issuer: "Demo Registrar",
          // 客户端试图直接声称已核验
          status: "VERIFIED",
          sourceKind: "SOCIAL",
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      }),
      { params: Promise.resolve({ supplierId: supplier.id }) },
    );
    ok(certRes.status === 201, "B4a：资质登记成功", `实际 ${certRes.status}`);
    const certBody = (await certRes.json()) as { certification: { id: string; status: string } };
    ok(
      certBody.certification.status === "CLAIMED",
      "B4b：客户端传 status=VERIFIED 无效，落库仍是 CLAIMED",
      `实际 ${certBody.certification.status}`,
    );
    const certId = certBody.certification.id;

    console.log("\n== B5：VERIFIED 必须有独立证据 ==");
    const noEvidence = await certActionRoute.PATCH(
      await req(member, `/api/supplier-intel/suppliers/${supplier.id}/certifications/${certId}?orgId=${org.id}`, {
        method: "PATCH", body: { action: "verify" },
      }),
      { params: Promise.resolve({ supplierId: supplier.id, certificationId: certId }) },
    );
    ok(noEvidence.status === 422, "B5a：无证据 verify → 422", `实际 ${noEvidence.status}`);
    const noEvidenceBody = (await noEvidence.json()) as { code?: string };
    ok(
      noEvidenceBody.code === "CERT_VERIFY_REQUIRES_EVIDENCE",
      "B5b：错误码明确要求证据",
      `实际 ${noEvidenceBody.code}`,
    );
    ok(
      (await db.supplierCertification.findUniqueOrThrow({ where: { id: certId } })).status === "CLAIMED",
      "B5c：失败后状态未变",
    );

    const badArchive = await certActionRoute.PATCH(
      await req(member, `/api/supplier-intel/suppliers/${supplier.id}/certifications/${certId}?orgId=${org.id}`, {
        method: "PATCH", body: { action: "verify", archiveItemId: "does-not-exist" },
      }),
      { params: Promise.resolve({ supplierId: supplier.id, certificationId: certId }) },
    );
    ok(
      badArchive.status >= 400,
      "B5d：坏的档案证据指针被拒（不静默回落到其它证据路径）",
      `实际 ${badArchive.status}`,
    );
    ok(
      (await db.supplierCertification.findUniqueOrThrow({ where: { id: certId } })).status === "CLAIMED",
      "B5e：坏证据后状态仍未变",
    );

    console.log("\n== B6：能力声明必须有出处，且永远不是 VERIFIED ==");
    const looseCap = await capSignalsRoute.POST(
      await req(member, `/api/supplier-intel/suppliers/${supplier.id}/capability-signals?orgId=${org.id}`, {
        method: "POST",
        body: { discoverySignalId: looseSignal.id, type: "CNC_CAPABILITY", evidenceStatus: "CLAIMED" },
      }),
      { params: Promise.resolve({ supplierId: supplier.id }) },
    );
    ok(looseCap.status === 422, "B6a：未归属线索不能当能力出处 → 422", `实际 ${looseCap.status}`);
    const missingSource = await capSignalsRoute.POST(
      await req(member, `/api/supplier-intel/suppliers/${supplier.id}/capability-signals?orgId=${org.id}`, {
        method: "POST", body: { type: "CNC_CAPABILITY", evidenceStatus: "CLAIMED" },
      }),
      { params: Promise.resolve({ supplierId: supplier.id }) },
    );
    ok(missingSource.status === 400, "B6b：不给出处直接 400");

    const verifiedCap = await capSignalsRoute.POST(
      await req(member, `/api/supplier-intel/suppliers/${supplier.id}/capability-signals?orgId=${org.id}`, {
        method: "POST",
        body: { discoverySignalId: linkedSignal.id, type: "CNC_CAPABILITY", evidenceStatus: "VERIFIED" },
      }),
      { params: Promise.resolve({ supplierId: supplier.id }) },
    );
    ok(verifiedCap.status === 422, "B6c：social 写路径产不出 VERIFIED → 422", `实际 ${verifiedCap.status}`);

    const unknownType = await capSignalsRoute.POST(
      await req(member, `/api/supplier-intel/suppliers/${supplier.id}/capability-signals?orgId=${org.id}`, {
        method: "POST",
        body: { discoverySignalId: linkedSignal.id, type: "TELEPORTATION", evidenceStatus: "CLAIMED" },
      }),
      { params: Promise.resolve({ supplierId: supplier.id }) },
    );
    ok(unknownType.status >= 400, "B6d：目录外的能力类型 fail-closed 拒收", `实际 ${unknownType.status}`);

    // 能力声明挂在**项目范围**的线索上，因此除了 org 级供应商门，还要过该线索所属项目的写权限。
    // 这不是多余的一层：供应商是 org 级的，但「这条线索说了什么」属于某个项目的情报。
    // member 是 org_member 且没有本项目角色 → 必须被拦住。
    const noProjectAccess = await capSignalsRoute.POST(
      await req(member, `/api/supplier-intel/suppliers/${supplier.id}/capability-signals?orgId=${org.id}`, {
        method: "POST",
        body: { discoverySignalId: linkedSignal.id, type: "CNC_CAPABILITY", evidenceStatus: "CLAIMED" },
      }),
      { params: Promise.resolve({ supplierId: supplier.id }) },
    );
    ok(
      noProjectAccess.status === 403,
      "B6e：org 成员但无该线索所属项目权限 → 403（供应商门不替代项目门）",
      `实际 ${noProjectAccess.status}`,
    );

    const goodCap = await capSignalsRoute.POST(
      await req(owner, `/api/supplier-intel/suppliers/${supplier.id}/capability-signals?orgId=${org.id}`, {
        method: "POST",
        body: {
          discoverySignalId: linkedSignal.id,
          type: "CNC_CAPABILITY",
          value: "3 轴 × 6",
          evidenceStatus: "CLAIMED",
          explanation: "厂家自述，未核实",
        },
      }),
      { params: Promise.resolve({ supplierId: supplier.id }) },
    );
    ok(goodCap.status === 201, "B6f：有项目权限者可写入能力声明", `实际 ${goodCap.status}`);
    const goodCapBody = (await goodCap.json()) as { capability: { extractedBy: string } };
    ok(goodCapBody.capability.extractedBy === "HUMAN", "B6g：人工入口固定 extractedBy=HUMAN");

    console.log("\n== B7：聚合视图如实呈现（含出处回溯）==");
    const v2 = await view.loadSupplierCapabilityView(actorOwner, supplier.id);
    ok(v2.offerings.length === 2, "B7a：两条可供产品", `实际 ${v2.offerings.length}`);
    ok(v2.certifications.length === 1, "B7b：一条资质");
    ok(v2.capabilities.length === 1, "B7c：一条能力声明");
    ok(
      v2.capabilities[0]?.source?.signalId === linkedSignal.id,
      "B7d：能力可回溯到具体线索（能力 → 线索 → 原文）",
    );
    ok(v2.counts.verifiedCertifications === 0, "B7e：没有任何 VERIFIED 资质");
    ok(v2.linkedSignals.length === 1, "B7f：只列已归属的线索");
    ok(
      v2.linkedSignals.every((s) => s.id !== looseSignal.id),
      "B7g：未归属线索不出现在本供应商名下",
    );

    console.log("\n== B8：过期是客观事实，不依赖有没有人来点一下 ==");
    const expiredCert = await db.supplierCertification.create({
      data: {
        orgId: org.id, supplierId: supplier.id, scope: "SUPPLIER", certificationType: "BIFMA",
        status: "CLAIMED", sourceKind: "USER_ENTRY",
        expiresAt: new Date(Date.now() - 86_400_000),
      },
    });
    const v3 = await view.loadSupplierCapabilityView(actorOwner, supplier.id);
    const expiredView = v3.certifications.find((c) => c.id === expiredCert.id);
    ok(expiredView?.expiredByDate === true, "B8a：已过日期的资质被标为过期");
    ok(expiredView?.status === "CLAIMED", "B8b：但不擅自改写落库状态（人工裁决仍需人来做）");
    const stillValid = v3.certifications.find((c) => c.id === certId);
    ok(stillValid?.expiredByDate === false, "B8c：未到期的不被误标");

    console.log("\n== B9：跨供应商写入被拒（不能给 A 的能力挂 B 的证据）==");
    const crossWrite = await capSignalsRoute.POST(
      await req(stranger, `/api/supplier-intel/suppliers/${supplier.id}/capability-signals?orgId=${otherOrg.id}`, {
        method: "POST",
        body: { discoverySignalId: linkedSignal.id, type: "CNC_CAPABILITY", evidenceStatus: "CLAIMED" },
      }),
      { params: Promise.resolve({ supplierId: supplier.id }) },
    );
    ok(crossWrite.status === 404, "B9a：他 org 写本 org 供应商 → 404", `实际 ${crossWrite.status}`);
    const crossOffering = await offeringsRoute.POST(
      await req(stranger, `/api/supplier-intel/suppliers/${supplier.id}/offerings?orgId=${otherOrg.id}`, {
        method: "POST", body: { name: "越权产品" },
      }),
      { params: Promise.resolve({ supplierId: supplier.id }) },
    );
    ok(crossOffering.status === 404, "B9b：他 org 写本 org 产品 → 404", `实际 ${crossOffering.status}`);
    ok(
      (await db.supplierOffering.count({ where: { supplierId: supplier.id } })) === 2,
      "B9c：越权请求没有产生任何行",
    );

    console.log(`\nS3-B 断言：${pass} 通过 / ${fail} 失败`);
  } finally {
    await db.supplierCertification.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierCapabilitySignal.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierOffering.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierDiscoverySignal.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplierSearchRun.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
    await db.supplier.deleteMany({ where: { orgId: { in: cleanupOrgs } } });
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
