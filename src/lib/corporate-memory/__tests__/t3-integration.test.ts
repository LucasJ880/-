/**
 * Tender T3 Corporate Memory — DB 集成测试（隔离 Neon 分支）。
 *
 * 运行：
 *   DATABASE_URL=... DIRECT_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *     npx tsx src/lib/corporate-memory/__tests__/t3-integration.test.ts
 *
 * 安全：顶层禁止 import "@/lib/db"（guard-first，见 t2-m1 / t1b 先例）。
 * 覆盖矩阵：BUYER-01..05、MEM-01..10、RET-01..08。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

// ---- guard-first：安全检查通过前不触发 Prisma 连接 ----
function requireIsolatedTestDb(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("⏭  跳过 T3 Corporate Memory DB 测试（未提供 DATABASE_URL）");
    process.exit(0);
  }
  assertSafeTestDatabase({ scriptName: "corporate-memory t3 integration" });
  if (process.env.NODE_ENV !== "test") {
    console.log("⏭  跳过 T3 Corporate Memory DB 测试（需 NODE_ENV=test）");
    process.exit(0);
  }
}

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? detail : "");
  }
}

async function expectError(
  code: string,
  name: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  const { isCorporateMemoryError } = await import("../types");
  try {
    await fn();
    ok(false, `${name}（期望抛 ${code}，实际成功）`);
  } catch (e) {
    if (isCorporateMemoryError(e, code as never)) {
      ok(true, name);
    } else {
      ok(false, name, e instanceof Error ? e.message : String(e));
    }
  }
}

async function main() {
  requireIsolatedTestDb();
  const { db } = await import("@/lib/db");
  const cm = await import("../index");

  const tag = `t3cm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // ---------------- Fixture ----------------
  // orgA：adminA(org_admin) + memberA(org_member)；orgB：adminB(org_admin)
  const adminA = await db.user.create({
    data: { email: `admin_a_${tag}@test.qingyan.local`, name: "AdminA", role: "user", status: "active" },
  });
  const memberA = await db.user.create({
    data: { email: `member_a_${tag}@test.qingyan.local`, name: "MemberA", role: "user", status: "active" },
  });
  const adminB = await db.user.create({
    data: { email: `admin_b_${tag}@test.qingyan.local`, name: "AdminB", role: "user", status: "active" },
  });
  const orgA = await db.organization.create({
    data: { name: `T3 Org A ${tag}`, code: `t3a_${tag}`, ownerId: adminA.id, status: "active" },
  });
  const orgB = await db.organization.create({
    data: { name: `T3 Org B ${tag}`, code: `t3b_${tag}`, ownerId: adminB.id, status: "active" },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: orgA.id, userId: adminA.id, role: "org_admin", status: "active" },
      { orgId: orgA.id, userId: memberA.id, role: "org_member", status: "active" },
      { orgId: orgB.id, userId: adminB.id, role: "org_admin", status: "active" },
    ],
  });
  const projectA = await db.project.create({
    data: { orgId: orgA.id, name: `T3 Proj A ${tag}`, ownerId: adminA.id, workDomain: "tender", intakeStatus: "dispatched" },
  });
  const projectB = await db.project.create({
    data: { orgId: orgB.id, name: `T3 Proj B ${tag}`, ownerId: adminB.id, workDomain: "tender", intakeStatus: "dispatched" },
  });
  const docA = await db.projectDocument.create({
    data: { projectId: projectA.id, title: `DocA ${tag}`, url: "https://example.com/a.pdf", fileType: "pdf" },
  });
  const docB = await db.projectDocument.create({
    data: { projectId: projectB.id, title: `DocB ${tag}`, url: "https://example.com/b.pdf", fileType: "pdf" },
  });
  const archiveA = await db.tenderArchiveItem.create({
    data: {
      orgId: orgA.id, projectId: projectA.id, kind: "tender_document",
      captureKey: `cap_${tag}_a`, capturedAt: new Date(), captureMethod: "upload",
      mimeType: "application/pdf", fileSize: 1234, contentHash: `hashA_${tag}`,
      storageKey: `archive/${orgA.id}/aa/hashA_${tag}`,
    },
  });
  const archiveB = await db.tenderArchiveItem.create({
    data: {
      orgId: orgB.id, projectId: projectB.id, kind: "tender_document",
      captureKey: `cap_${tag}_b`, capturedAt: new Date(), captureMethod: "upload",
      mimeType: "application/pdf", fileSize: 1234, contentHash: `hashB_${tag}`,
      storageKey: `archive/${orgB.id}/bb/hashB_${tag}`,
    },
  });

  const actorAdminA = { userId: adminA.id };
  const actorMemberA = { userId: memberA.id };
  const actorAdminB = { userId: adminB.id };

  const goodEvidence = () => [
    {
      sourceType: "TENDER_DOCUMENT",
      sourceKey: `tenderAnalysisRun:${tag}`,
      pageNumber: 12,
      sectionLabel: "3.2 Bid Security",
      sourceSnippet: "A bid bond of 10% is required.",
      capturedAt: new Date("2026-02-01T00:00:00Z"),
      accessClass: "PUBLIC_SOURCE",
    },
  ];

  try {
    // ================= BUYER MATRIX =================
    // BUYER-01: create canonical buyer
    const b1 = await cm.createBuyer({
      orgId: orgA.id, actor: actorAdminA,
      canonicalName: "The City of Toronto", websiteDomain: "https://www.toronto.ca",
      buyerType: "municipal", province: "ON", country: "CA",
    });
    ok(b1.created && b1.buyer.normalizedName === "city of toronto" && b1.buyer.status === "ACTIVE",
      "BUYER-01 create canonical buyer", { normalizedName: b1.buyer.normalizedName });

    // BUYER-02: same org + same strong canonical identity (domain) → idempotent
    const b2 = await cm.createBuyer({
      orgId: orgA.id, actor: actorAdminA,
      canonicalName: "Toronto, City of", websiteDomain: "toronto.ca",
    });
    ok(!b2.created && b2.buyer.id === b1.buyer.id && b2.matchedBy === "website_domain",
      "BUYER-02 same strong identity → idempotent（未新建）", { matchedBy: b2.matchedBy });

    // BUYER-03a: similar name, different domain/entity → DO NOT AUTO MERGE (distinct normalized → separate ACTIVE)
    const tdsb = await cm.createBuyer({
      orgId: orgA.id, actor: actorAdminA,
      canonicalName: "Toronto District School Board", websiteDomain: "tdsb.on.ca",
    });
    const tcdsb = await cm.createBuyer({
      orgId: orgA.id, actor: actorAdminA,
      canonicalName: "Toronto Catholic District School Board", websiteDomain: "tcdsb.org",
    });
    ok(tdsb.created && tcdsb.created && tdsb.buyer.id !== tcdsb.buyer.id && tcdsb.buyer.status === "ACTIVE",
      "BUYER-03a 近似名不同实体 → 独立 ACTIVE 记录（不合并）");

    // BUYER-03b: same normalized name but conflicting domain → NEEDS_REVIEW + identity conflict pointer
    const b3b = await cm.createBuyer({
      orgId: orgA.id, actor: actorAdminA,
      canonicalName: "City of Toronto", websiteDomain: "toronto-fake.ca",
    });
    ok(b3b.created && b3b.buyer.status === "NEEDS_REVIEW" && b3b.identityConflictBuyerId === b1.buyer.id,
      "BUYER-03b 同名异域 → NEEDS_REVIEW（不自动合并）", { status: b3b.buyer.status });

    // BUYER-04: cross-org same buyer → separate tenant record
    const b4 = await cm.createBuyer({
      orgId: orgB.id, actor: actorAdminB,
      canonicalName: "City of Toronto", websiteDomain: "toronto.ca",
    });
    ok(b4.created && b4.buyer.id !== b1.buyer.id && b4.buyer.orgId === orgB.id,
      "BUYER-04 跨组织同 buyer → 独立租户记录");

    // BUYER-05: client-supplied orgId spoof → reject (adminA 不是 orgB 管理员)
    await expectError("MEMORY_WRITE_FORBIDDEN", "BUYER-05 orgId spoof → 拒绝", () =>
      cm.createBuyer({ orgId: orgB.id, actor: actorAdminA, canonicalName: "Spoof Co", websiteDomain: "spoof.ca" }),
    );
    // 附加：org_member 无写权限
    await expectError("MEMORY_WRITE_FORBIDDEN", "BUYER-05b org_member 写入 → 拒绝（CONSERVATIVE_ADMIN_ONLY）", () =>
      cm.createBuyer({ orgId: orgA.id, actor: actorMemberA, canonicalName: "Member Co", websiteDomain: "member.ca" }),
    );

    // ================= CLAIM MATRIX =================
    // MEM-01: create ACTIVE FACT claim with valid evidence
    const m1 = await cm.createMemoryClaim({
      orgId: orgA.id, actor: actorAdminA,
      subjectType: "BUYER", subjectKey: b1.buyer.id,
      claimType: "BUYER_POLICY", claimNature: "FACT",
      statement: "City of Toronto requires a 10% bid bond.",
      confidence: "HIGH", verificationStatus: "HUMAN_CONFIRMED",
      sourceType: "TENDER_DOCUMENT", capturedAt: new Date("2026-02-01T00:00:00Z"),
      evidence: goodEvidence(),
    });
    ok(m1.status === "ACTIVE" && m1.claimNature === "FACT" && m1.evidence.length === 1,
      "MEM-01 ACTIVE FACT + evidence → PASS", { status: m1.status });

    // MEM-02a: create claim without evidence (non-USER_ENTRY) → reject
    await expectError("EVIDENCE_REQUIRED", "MEM-02a 无证据（非 USER_ENTRY）→ 拒绝", () =>
      cm.createMemoryClaim({
        orgId: orgA.id, actor: actorAdminA, subjectType: "BUYER", subjectKey: b1.buyer.id,
        claimType: "BUYER_PATTERN", claimNature: "INTERPRETATION",
        statement: "No evidence here.", confidence: "LOW",
        sourceType: "TENDER_DOCUMENT", capturedAt: new Date(),
      }),
    );
    // MEM-02b: USER_ENTRY without evidence → allowed but forced NEEDS_REVIEW
    const m2b = await cm.createMemoryClaim({
      orgId: orgA.id, actor: actorAdminA, subjectType: "BUYER", subjectKey: b1.buyer.id,
      claimType: "BUYER_PATTERN", claimNature: "INTERPRETATION",
      statement: "User-entered hunch pending review.", confidence: "LOW",
      sourceType: "USER_ENTRY", capturedAt: new Date(),
    });
    ok(m2b.status === "NEEDS_REVIEW" && m2b.verificationStatus === "NEEDS_REVIEW",
      "MEM-02b USER_ENTRY 无证据 → NEEDS_REVIEW 政策", { status: m2b.status });

    // MEM-03: AI-derived claim attempts FACT → reject
    await expectError("AI_DERIVED_CANNOT_BE_FACT", "MEM-03 AI_DERIVED 标 FACT → 拒绝", () =>
      cm.createMemoryClaim({
        orgId: orgA.id, actor: actorAdminA, subjectType: "BUYER", subjectKey: b1.buyer.id,
        claimType: "BUYER_PATTERN", claimNature: "FACT",
        statement: "AI thinks this is a fact.", confidence: "HIGH",
        sourceType: "AI_DERIVED", capturedAt: new Date(), evidence: goodEvidence(),
      }),
    );

    // MEM-AI: actorType=ai directly → hard ban (AI_AUTO_MEMORY_WRITE = NO)
    await expectError("AI_AUTO_MEMORY_WRITE_DISABLED", "MEM-AI actorType=ai 直写 → 拒绝（AI_AUTO_MEMORY_WRITE=NO）", () =>
      cm.createMemoryClaim({
        orgId: orgA.id, actor: { userId: adminA.id, actorType: "ai" },
        subjectType: "BUYER", subjectKey: b1.buyer.id,
        claimType: "BUYER_PATTERN", claimNature: "INTERPRETATION",
        statement: "AI auto write attempt.", confidence: "LOW",
        sourceType: "AI_DERIVED", capturedAt: new Date(), evidence: goodEvidence(),
      }),
    );

    // MEM-04: supersede claim → old SUPERSEDED, new ACTIVE
    const sup = await cm.supersedeMemoryClaim({
      orgId: orgA.id, actor: actorAdminA, claimId: m1.id,
      replacement: {
        claimType: "BUYER_POLICY", claimNature: "FACT",
        statement: "City of Toronto now requires a 5% bid bond (addendum 2).",
        confidence: "HIGH", verificationStatus: "HUMAN_CONFIRMED",
        sourceType: "ADDENDUM", capturedAt: new Date("2026-05-01T00:00:00Z"),
        evidence: [{ sourceType: "ADDENDUM", sourceKey: `addendum:${tag}`, sourceSnippet: "Bid bond reduced to 5%.", capturedAt: new Date("2026-05-01T00:00:00Z") }],
      },
    });
    ok(sup.oldClaim.status === "SUPERSEDED" && sup.newClaim.status === "ACTIVE" &&
      sup.newClaim.supersedesClaimId === m1.id && sup.newClaim.subjectKey === b1.buyer.id,
      "MEM-04 supersede → 旧 SUPERSEDED / 新 ACTIVE / 链正确");

    // MEM-05: retract incorrect claim → history preserved
    const badClaim = await cm.createMemoryClaim({
      orgId: orgA.id, actor: actorAdminA, subjectType: "PROJECT", subjectKey: projectA.id,
      claimType: "PROJECT_FACT", claimNature: "FACT",
      statement: "Award value was $999,999 (WRONG).", confidence: "MEDIUM",
      sourceType: "PROJECT_RECORD", capturedAt: new Date("2026-03-01T00:00:00Z"),
      evidence: [{ sourceType: "PROJECT_RECORD", sourceKey: `record:${tag}`, capturedAt: new Date("2026-03-01T00:00:00Z") }],
    });
    const ret = await cm.retractMemoryClaim({
      orgId: orgA.id, actor: actorAdminA, claimId: badClaim.id, reason: "Data-entry error; see corrected claim.",
      replacement: {
        claimType: "PROJECT_FACT", claimNature: "FACT",
        statement: "Award value was $120,000.", confidence: "HIGH", verificationStatus: "HUMAN_CONFIRMED",
        sourceType: "AWARD_NOTICE", capturedAt: new Date("2026-03-02T00:00:00Z"),
        evidence: [{ sourceType: "AWARD_NOTICE", sourceUrl: "https://example.com/award", capturedAt: new Date("2026-03-02T00:00:00Z") }],
      },
    });
    const retractedRow = await db.memoryClaim.findUnique({ where: { id: badClaim.id } });
    ok(ret.retractedClaim.status === "RETRACTED" && retractedRow?.statement === "Award value was $999,999 (WRONG)." &&
      retractedRow?.retractionReason != null && ret.correctionClaim?.supersedesClaimId === badClaim.id,
      "MEM-05 retract → 旧 RETRACTED 且 statement 历史不改，修正 claim 挂链");

    // MEM-06: ordinary update cannot materially rewrite statement
    await expectError("GOVERNANCE_FIELD_FORBIDDEN", "MEM-06 原地改 statement → 拒绝", () =>
      cm.updateMemoryClaimGovernance({
        orgId: orgA.id, actor: actorAdminA, claimId: sup.newClaim.id,
        patch: { statement: "sneaky rewrite" } as never,
      }),
    );
    const govOk = await cm.updateMemoryClaimGovernance({
      orgId: orgA.id, actor: actorAdminA, claimId: sup.newClaim.id,
      patch: { reviewNote: "Verified against addendum 2.", accessClass: "INTERNAL_COMPANY" },
    });
    ok(govOk.reviewNote === "Verified against addendum 2." && govOk.statement === sup.newClaim.statement,
      "MEM-06b 治理字段（reviewNote/accessClass）可原地改，statement 不变");

    // MEM-07: cross-org read → reject / zero leakage
    await expectError("MEMORY_READ_FORBIDDEN", "MEM-07a 跨组织读（B 成员声称 orgA）→ 拒绝", () =>
      cm.getMemoryClaim({ orgId: orgA.id, actor: actorAdminB, claimId: sup.newClaim.id }),
    );
    const scopedNull = await cm.getMemoryClaim({ orgId: orgB.id, actor: actorAdminB, claimId: sup.newClaim.id });
    ok(scopedNull === null, "MEM-07b org-scoped 读 A 的 claim → null（不可枚举）");

    // MEM-08: cross-org supersede → reject (scoped to B → not found)
    await expectError("CLAIM_NOT_FOUND", "MEM-08 跨组织 supersede → 拒绝", () =>
      cm.supersedeMemoryClaim({
        orgId: orgB.id, actor: actorAdminB, claimId: sup.newClaim.id,
        replacement: {
          claimType: "BUYER_POLICY", claimNature: "INTERPRETATION", statement: "hijack",
          confidence: "LOW", sourceType: "USER_ENTRY", capturedAt: new Date(),
        },
      }),
    );

    // MEM-09: evidence source references out-of-scope org → fail closed
    await expectError("EVIDENCE_SOURCE_OUT_OF_SCOPE", "MEM-09a evidence.archiveItemId 跨 org → fail closed", () =>
      cm.createMemoryClaim({
        orgId: orgA.id, actor: actorAdminA, subjectType: "BUYER", subjectKey: b1.buyer.id,
        claimType: "BUYER_POLICY", claimNature: "FACT", statement: "cross-org archive evidence",
        confidence: "HIGH", sourceType: "TENDER_DOCUMENT", capturedAt: new Date(),
        evidence: [{ sourceType: "TENDER_DOCUMENT", archiveItemId: archiveB.id, capturedAt: new Date() }],
      }),
    );
    await expectError("EVIDENCE_SOURCE_OUT_OF_SCOPE", "MEM-09b evidence.documentId 跨 org → fail closed", () =>
      cm.createMemoryClaim({
        orgId: orgA.id, actor: actorAdminA, subjectType: "BUYER", subjectKey: b1.buyer.id,
        claimType: "BUYER_POLICY", claimNature: "FACT", statement: "cross-org doc evidence",
        confidence: "HIGH", sourceType: "TENDER_DOCUMENT", capturedAt: new Date(),
        evidence: [{ sourceType: "TENDER_DOCUMENT", documentId: docB.id, capturedAt: new Date() }],
      }),
    );
    await expectError("SUBJECT_OUT_OF_SCOPE", "MEM-09c subject=BUYER 指向跨 org buyer → fail closed", () =>
      cm.createMemoryClaim({
        orgId: orgA.id, actor: actorAdminA, subjectType: "BUYER", subjectKey: b4.buyer.id,
        claimType: "BUYER_POLICY", claimNature: "FACT", statement: "foreign buyer subject",
        confidence: "HIGH", sourceType: "TENDER_DOCUMENT", capturedAt: new Date(), evidence: goodEvidence(),
      }),
    );
    // in-scope archive/doc evidence still works
    const m9ok = await cm.createMemoryClaim({
      orgId: orgA.id, actor: actorAdminA, subjectType: "PROJECT", subjectKey: projectA.id,
      claimType: "PROJECT_FACT", claimNature: "FACT", statement: "In-scope archive + doc evidence.",
      confidence: "HIGH", sourceType: "TENDER_DOCUMENT", capturedAt: new Date(),
      evidence: [
        { sourceType: "TENDER_DOCUMENT", archiveItemId: archiveA.id, capturedAt: new Date() },
        { sourceType: "TENDER_DOCUMENT", documentId: docA.id, pageNumber: 3, capturedAt: new Date() },
      ],
    });
    ok(m9ok.evidence.length === 2, "MEM-09d 本 org archive/doc 证据 → 通过");

    // MEM-10: multiple evidence records preserved
    const m10 = await cm.attachMemoryClaimEvidence({
      orgId: orgA.id, actor: actorAdminA, claimId: m9ok.id,
      evidence: [{ sourceType: "EMAIL", sourceKey: `email:${tag}`, sourceSnippet: "confirmation email", capturedAt: new Date() }],
    });
    ok(m10.evidence.length === 3, "MEM-10 多证据保留（create 2 + attach 1 = 3）", { count: m10.evidence.length });

    // ================= RETRIEVAL MATRIX =================
    // 为检索准备一组同 subject 的 claim（buyer b1）
    const capBase = new Date("2026-04-01T00:00:00Z");
    const capNewer = new Date("2026-06-01T00:00:00Z");
    const rHuman = await cm.createMemoryClaim({
      orgId: orgA.id, actor: actorAdminA, subjectType: "BUYER", subjectKey: b1.buyer.id,
      claimType: "BUYER_PATTERN", claimNature: "INTERPRETATION", statement: "Buyer favors phased delivery (human-confirmed).",
      confidence: "HIGH", verificationStatus: "HUMAN_CONFIRMED",
      sourceType: "PROJECT_RECORD", capturedAt: capBase, evidence: [{ sourceType: "PROJECT_RECORD", sourceKey: `r:${tag}:h`, capturedAt: capBase }],
    });
    const rAi = await cm.createMemoryClaim({
      orgId: orgA.id, actor: actorAdminA, subjectType: "BUYER", subjectKey: b1.buyer.id,
      claimType: "BUYER_PATTERN", claimNature: "INFERENCE", statement: "Buyer may prefer local suppliers (ai-extracted).",
      confidence: "MEDIUM", verificationStatus: "AI_EXTRACTED",
      sourceType: "PUBLIC_WEB", capturedAt: capBase, evidence: [{ sourceType: "PUBLIC_WEB", sourceUrl: "https://example.com/pattern", capturedAt: capBase }],
    });
    const rNewer = await cm.createMemoryClaim({
      orgId: orgA.id, actor: actorAdminA, subjectType: "BUYER", subjectKey: b1.buyer.id,
      claimType: "PRICE_FACT", claimNature: "FACT", statement: "Recent award band $100k-250k.",
      confidence: "HIGH", verificationStatus: "AI_EXTRACTED",
      sourceType: "AWARD_NOTICE", capturedAt: capNewer, evidence: [{ sourceType: "AWARD_NOTICE", sourceUrl: "https://example.com/award2", capturedAt: capNewer }],
    });

    // RET-01: subject filter
    const bySubject = await cm.searchMemoryClaims({ orgId: orgA.id, actor: actorAdminA, subjectType: "BUYER", subjectKey: b1.buyer.id });
    ok(bySubject.length > 0 && bySubject.every((c) => c.subjectType === "BUYER" && c.subjectKey === b1.buyer.id),
      "RET-01 subject 过滤 → 仅匹配 claim");

    // RET-02: claimType filter
    const byType = await cm.searchMemoryClaims({ orgId: orgA.id, actor: actorAdminA, subjectKey: b1.buyer.id, subjectType: "BUYER", claimType: "PRICE_FACT" });
    ok(byType.length >= 1 && byType.every((c) => c.claimType === "PRICE_FACT"),
      "RET-02 claimType 过滤 → 正确");

    // RET-03: ACTIVE default excludes superseded
    const defaultActive = await cm.searchMemoryClaims({ orgId: orgA.id, actor: actorAdminA, subjectType: "BUYER", subjectKey: b1.buyer.id });
    ok(defaultActive.every((c) => c.status === "ACTIVE") && !defaultActive.some((c) => c.claimId === m1.id),
      "RET-03 默认仅 ACTIVE（superseded 被排除）");

    // RET-04: includeHistory shows superseded/retracted
    const withHistory = await cm.searchMemoryClaims({ orgId: orgA.id, actor: actorAdminA, subjectType: "BUYER", subjectKey: b1.buyer.id, includeHistory: true });
    ok(withHistory.some((c) => c.claimId === m1.id && c.status === "SUPERSEDED"),
      "RET-04 includeHistory → superseded 可见");

    // RET-05: trust ordering (human-confirmed before ai-extracted when otherwise equal)
    const trustOrder = defaultActive.filter((c) => c.claimId === rHuman.id || c.claimId === rAi.id);
    const hIdx = defaultActive.findIndex((c) => c.claimId === rHuman.id);
    const aIdx = defaultActive.findIndex((c) => c.claimId === rAi.id);
    ok(trustOrder.length === 2 && hIdx >= 0 && aIdx >= 0 && hIdx < aIdx,
      "RET-05 trust 排序：human-confirmed 先于 ai-extracted（同 freshness）", { hIdx, aIdx });

    // RET-06: freshness ordering — newer ACTIVE favored among same trust
    const aiRows = defaultActive.filter((c) => c.verificationStatus === "AI_EXTRACTED");
    const newerIdx = defaultActive.findIndex((c) => c.claimId === rNewer.id);
    const aiOlderIdx = defaultActive.findIndex((c) => c.claimId === rAi.id);
    ok(aiRows.length >= 2 && newerIdx >= 0 && aiOlderIdx >= 0 && newerIdx < aiOlderIdx,
      "RET-06 freshness 排序：同 trust 下更新的 ACTIVE 在前", { newerIdx, aiOlderIdx });

    // RET-07: cross-org zero leakage
    const bLeak = await cm.searchMemoryClaims({ orgId: orgB.id, actor: actorAdminB, subjectType: "BUYER", subjectKey: b1.buyer.id });
    ok(bLeak.length === 0, "RET-07 跨组织检索 → 零泄漏");
    await expectError("MEMORY_READ_FORBIDDEN", "RET-07b B 成员声称 orgA 检索 → 拒绝", () =>
      cm.searchMemoryClaims({ orgId: orgA.id, actor: actorAdminB }),
    );

    // RET-08: evidence included (citation metadata)
    const priceRes = byType.find((c) => c.claimId === rNewer.id);
    ok(!!priceRes && priceRes.evidenceCount >= 1 && priceRes.evidence[0]?.sourceType === "AWARD_NOTICE" &&
      priceRes.confidence === "HIGH" && priceRes.verificationStatus === "AI_EXTRACTED",
      "RET-08 检索结果含证据摘要 + confidence + verificationStatus");

    // ACCESS 分级过滤（§35）：仅 PUBLIC_SOURCE 时不返回 INTERNAL_COMPANY claim
    const publicOnly = await cm.searchMemoryClaims({
      orgId: orgA.id, actor: actorAdminA, subjectType: "BUYER", subjectKey: b1.buyer.id,
      allowedAccessClasses: ["PUBLIC_SOURCE"],
    });
    ok(publicOnly.every((c) => c.accessClass === "PUBLIC_SOURCE"),
      "ACCESS 分级过滤 → 仅返回允许的 accessClass");
  } finally {
    // ---------------- cleanup（Evidence Restrict → 先删证据） ----------------
    await db.memoryClaimEvidence.deleteMany({ where: { orgId: { in: [orgA.id, orgB.id] } } });
    await db.memoryClaim.deleteMany({ where: { orgId: { in: [orgA.id, orgB.id] } } });
    await db.buyer.deleteMany({ where: { orgId: { in: [orgA.id, orgB.id] } } });
    await db.tenderArchiveItem.deleteMany({ where: { orgId: { in: [orgA.id, orgB.id] } } });
    await db.projectDocument.deleteMany({ where: { id: { in: [docA.id, docB.id] } } });
    await db.project.deleteMany({ where: { id: { in: [projectA.id, projectB.id] } } });
    await db.auditLog.deleteMany({ where: { orgId: { in: [orgA.id, orgB.id] } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [orgA.id, orgB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [adminA.id, memberA.id, adminB.id] } } });
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("T3 集成测试异常:", e);
  process.exit(1);
});
