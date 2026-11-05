#!/usr/bin/env tsx
/**
 * PROC-1 隔离环境演示（开发验证闭环，可重复）：
 *   公开来源扫描（fixture 假 fetch）→ 候选与申请卡 → 申请人 / 规则 / 台账确认 → READY → 自助交接 → 用户报告提交
 *   → 回执核对 → 受理 → 「内附 105 页」回复信 → 披露 CSV → 复核 → 按口径分析；另有重叠草稿与历史案件。
 *
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx scripts/procurement-records-demo.ts
 *
 * 只能对隔离库运行（assertSafeTestDatabase）；全部为 fixture（组织 / 用户 / 来源数据 / 回执 / 来信 / 披露文件），
 * 不是真实官方运行，也不是真实提交证据。输出演示组织、用户与申请 id，以及可用于本地浏览的会话 cookie。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated" || process.env.NODE_ENV !== "test") {
  console.error("只能在隔离库运行：需要 NODE_ENV=test 与 DATABASE_ENVIRONMENT=isolated");
  process.exit(2);
}
assertSafeTestDatabase({ scriptName: "PROC-1 demo fixture" });
process.env.PROCUREMENT_RECORDS_SCHEMA_READY = "1";
process.env.TENDER_EXTERNAL_INTEL_ENABLED = "1";
process.env.PROCUREMENT_ATI_SUMMARIES_RESOURCE_ID = "ati-fixture";
process.env.PRODUCT_CONTENT_LOCAL_STORE = "1";
process.env.PRODUCT_CONTENT_LOCAL_STORE_DIR = process.env.PRODUCT_CONTENT_LOCAL_STORE_DIR || mkdtempSync(path.join(tmpdir(), "proc1-demo-blobs-"));

async function main() {
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { fakeFetch } = await import("@/lib/procurement-records/__tests__/fixture-sources");
  const { saveWatchConfig, setWatchEnabled, getWatchRow } = await import("@/lib/procurement-records/watch-service");
  const { enqueueManualRun, executeScanRun } = await import("@/lib/procurement-records/scan-run");
  const { seedResearchInstruments, seedHistoricalCase } = await import("@/lib/procurement-records/seed");
  const { saveApplicant, confirmApplicant } = await import("@/lib/procurement-records/applicants");
  const { listRules, updateRule } = await import("@/lib/procurement-records/rules");
  const req = await import("@/lib/procurement-records/requests");
  const { addCaseEvent } = await import("@/lib/procurement-records/events");
  const { saveAttachment, processAttachment } = await import("@/lib/procurement-records/attachments");
  const { reviewLineItem, runAnalysis } = await import("@/lib/procurement-records/analysis");

  const stamp = Date.now().toString(36);
  const OWNER = `demoowner_${stamp}`;
  const ORG = `demoorg_${stamp}`;
  const PROJECT = `demoproj_${stamp}`;
  await db.user.create({ data: { id: OWNER, email: `${OWNER}@fixture.test`, name: "演示管理员（fixture）", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "PROC-1 演示组织（fixture）", code: `demo-${stamp}`, ownerId: OWNER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.project.create({ data: { id: PROJECT, name: "演示 Tender：Pillow Forms 2027（fixture）", orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched" } });

  const must = <T extends { ok: boolean }>(r: T, label: string): T => {
    if (!r.ok) throw new Error(`${label} 失败：${JSON.stringify(r).slice(0, 400)}`);
    return r;
  };

  must(await saveWatchConfig({ orgId: ORG, userId: OWNER, body: { name: "演示监控（fixture 数据，非真实运行）" } }), "保存监控");
  await seedResearchInstruments({ orgId: ORG, userId: OWNER });
  must(await setWatchEnabled({ orgId: ORG, userId: OWNER, enabled: true }), "启用");
  const watch = await getWatchRow(ORG);
  for (let i = 0; i < 2; i++) {
    const { runId } = await enqueueManualRun({ orgId: ORG, watchId: watch!.id, userId: OWNER });
    await executeScanRun(runId, { fetchImpl: fakeFetch });
  }

  const ap = must(await saveApplicant({ orgId: ORG, userId: OWNER, body: { label: "演示公司（fixture）", legalName: "Demo Fixture Shutters Inc.", representativeName: "Demo Rep", addressLine1: "1 Fixture Street", city: "Toronto", province: "ON", postalCode: "M5V 0A0", country: "Canada", email: "records@fixture.test" } }), "申请人");
  must(await confirmApplicant({ orgId: ORG, userId: OWNER, id: ap.applicant.id, expectedVersion: 1 }), "确认申请人");
  for (const r of await listRules(ORG)) {
    if (r.jurisdiction === "CA-FED") must(await updateRule({ orgId: ORG, ruleId: r.id, userId: OWNER, patch: { officialPortalUrl: "https://fixture.example/atip-portal" }, verify: { method: "演示 fixture：模拟核对（非真实核实，不可用于真实申请）" } }), "规则");
  }
  must(await req.attestLedger({ orgId: ORG, userId: OWNER, jurisdiction: "CA-FED", institutionKey: "*", method: "USER_CONFIRMED_NONE", note: "演示 fixture：组织无历史申请" }), "台账");

  const so = await db.procurementInstrument.findFirst({ where: { orgId: ORG, normalizedNumber: "CW2379109", instrumentClass: "AWARD_INSTRUMENT" } });
  const R1 = (await db.recordsRequest.findFirst({ where: { orgId: ORG, autoDraftKey: `auto:${so!.id}` } }))!.id;
  must(await req.saveDraft({ requestId: R1, userId: OWNER, patch: { recipientInstitution: "Correctional Service Canada", recordsHolderBasis: "CSC 发出 call-up 并付款（演示 fixture）", startDate: "2021-11-01", endDate: "2026-10-31", applicantProfileId: ap.applicant.id, projectId: PROJECT } }), "填写 R1");
  must(await req.linkInstrumentToTender({ orgId: ORG, userId: OWNER, projectId: PROJECT, instrumentId: so!.id, relation: "PREDECESSOR" }), "关联 Tender");
  must(await req.markReady({ requestId: R1, userId: OWNER }), "READY");
  must(await req.startHandoff({ requestId: R1, userId: OWNER }), "交接");
  await req.recordHandoffAction({ requestId: R1, userId: OWNER, action: "COPIED_BODY" });
  await req.recordHandoffAction({ requestId: R1, userId: OWNER, action: "OPENED_PORTAL" });
  const hv = (await db.recordsRequest.findUnique({ where: { id: R1 } }))!.handoffVersionId!;
  must(await req.reportSubmission({ requestId: R1, userId: OWNER, submittedAt: "2026-11-05T15:00:00Z", channel: "ATIP Online（演示 fixture）", actualFeeCents: 500, feeCurrency: "CAD", submissionReference: "DEMO-REF-0001", text: { mode: "SAME_AS_VERSION", versionId: hv } }), "登记提交");
  const rc = await saveAttachment({ requestId: R1, userId: OWNER, kind: "RECEIPT", filename: "demo-receipt.txt", buffer: Buffer.from("ATIP Online Request — DEMO FIXTURE\nConfirmation number: DEMO-REF-0001\nInstitution: Correctional Service Canada") });
  if (rc.ok) await processAttachment(rc.attachmentId);
  if (rc.ok) must(await req.verifyReceipt({ requestId: R1, userId: OWNER, attachmentId: rc.attachmentId, confirm: true }), "回执核对");
  must(await addCaseEvent({ requestId: R1, userId: OWNER, type: "ACKNOWLEDGED", effectiveAt: "2026-11-06T15:00:00Z", payload: { caseNumber: "A-DEMO-00001", registeredAt: "2026-11-06" } }), "受理");
  const letter = await saveAttachment({ requestId: R1, userId: OWNER, kind: "GOVERNMENT_LETTER", filename: "demo-reply-letter.txt", buffer: Buffer.from("DEMO FIXTURE reply: please find enclosed 105 pages released in part. Case A-DEMO-00001.") });
  if (letter.ok) {
    await processAttachment(letter.attachmentId);
    must(await addCaseEvent({ requestId: R1, userId: OWNER, type: "RESPONSE_LETTER", attachmentIds: [letter.attachmentId], confirmedMatch: true, payload: { expectedReleasePages: 105 } }), "回复信");
  }
  const csv = [
    "Contract Number,Call-up Number,Order Date,Item Description,Qty,UOM,Unit Price,Call-up Value,Delivery Location,Currency",
    'CW2379109,CU-001,2023-08-14,Pillow form 20x26,500,EA,$12.00,"$6,000.00",Kingston ON,CAD',
    'CW2379109,CU-002,2024-02-01,Pillow form 20x26,300,EA,$12.50,"$3,750.00",Drumheller AB,CAD',
    "CW2379109,CU-003,2024-06-10,Pillow form 20x26,120,EA,$12.50,$1500.00,Kingston ON,CAD",
  ].join("\n");
  const disc = await saveAttachment({ requestId: R1, userId: OWNER, kind: "DISCLOSURE_FILE", filename: "demo-usage-report.csv", buffer: Buffer.from(csv) });
  if (disc.ok) await processAttachment(disc.attachmentId);
  const lines = await db.procurementLineItem.findMany({ where: { requestId: R1 }, orderBy: { sourceRow: "asc" } });
  for (const l of lines.slice(0, 2)) await reviewLineItem({ requestId: R1, lineItemId: l.id, userId: OWNER, action: "CONFIRM" });
  await runAnalysis({ requestId: R1, userId: OWNER, trigger: "USER" });

  const r2 = must(await req.createRequestDraft({ orgId: ORG, userId: OWNER, instrumentIds: [so!.id], channel: "INFORMAL", title: "演示：同范围改写措辞与渠道的草稿", recipientInstitution: "Service correctionnel du Canada", recordsHolderBasis: "演示 fixture", startDate: "2021-11-01", endDate: "2026-11-05", applicantProfileId: ap.applicant.id, categories: ["FINANCIALS"] }), "重叠草稿");
  await seedHistoricalCase({ orgId: ORG, userId: OWNER, asFixture: true });
  // 省级申请卡（安省 FIPPA 模板 + 提交指引；演示 fixture，规则仍为未核实种子）
  const r3 = must(await req.createRequestDraft({ orgId: ORG, userId: OWNER, jurisdiction: "CA-ON", instrumentNumbers: ["OSS-DEMO-0001"], pathType: "NEW_FORMAL_REQUEST", title: "演示：安省省级合同（fixture）", recipientInstitution: "Ministry of Public and Business Service Delivery", recordsHolderBasis: "该部签约并付款（演示 fixture）", startDate: "2024-01-01", endDate: "2025-12-31", applicantProfileId: ap.applicant.id, categories: ["CONTRACT_DOCS", "CALL_UPS_USAGE", "FINANCIALS"], projectId: PROJECT }), "安省草稿");

  const cookie = await createSession({ sub: OWNER, email: `${OWNER}@fixture.test`, role: "user" });
  console.log(JSON.stringify({ orgId: ORG, ownerId: OWNER, projectId: PROJECT, R1, R2: (r2 as { requestId: string }).requestId, R3: (r3 as { requestId: string }).requestId, cookie: `qy_session=${cookie}`, blobDir: process.env.PRODUCT_CONTENT_LOCAL_STORE_DIR }, null, 2));
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
