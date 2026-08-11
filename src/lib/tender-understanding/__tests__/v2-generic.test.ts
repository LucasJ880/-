/**
 * V2 通用理解测试（V2-01 … V2-10）
 *
 * 核心主张：V2 管线内没有任何 case-specific 答案 —— 换编号/买方/日期格式/产品域，
 * 结果只随源文档变化；同一要求跨文档去重但证据全保留；补遗按修订语义 supersede；
 * 无修订语言的矛盾必须浮出而非静默择一。
 */

import assert from "node:assert";

import { analyzeTender } from "../analyzer";
import { normalizeFactValue } from "../normalize";
import { doc, input, makeOk, scriptedInvoker } from "./helpers";

const { ok, count } = makeOk();

async function run(): Promise<void> {
  // ── V2-01 / V2-02：不同 tender number / 不同 buyer —— 结果只随文档变 ──
  for (const [caseName, num, buyer] of [
    ["V2-01a", "ABC-99-0001", "City of Halifax"],
    ["V2-01b", "XYZ-2027-777", "Toronto Transit Commission"],
  ] as const) {
    await ok(`${caseName}: tender number=${num} / buyer=${buyer} 原样进入结果（无硬编码答案）`, async () => {
      const page = `Request for Proposal\nSolicitation No. ${num}\nIssued by ${buyer}\nThe bidder must submit two copies of the technical proposal.`;
      const d = doc("d1", "BASE_TENDER", { 1: page });
      const invoker = scriptedInvoker({
        extract: () => ({
          facts: [
            {
              factType: "tender_number",
              claim: `Solicitation number is ${num}`,
              rawValue: num,
              sourceDocumentId: "d1",
              pageNumber: 1,
              sourceSnippet: `Solicitation No. ${num}`,
              confidence: "HIGH",
            },
            {
              factType: "buyer",
              claim: `Buyer is ${buyer}`,
              rawValue: buyer,
              sourceDocumentId: "d1",
              pageNumber: 1,
              sourceSnippet: `Issued by ${buyer}`,
              confidence: "HIGH",
            },
          ],
          requirements: [
            {
              category: "SUBMISSION",
              statement: "The bidder must submit two copies of the technical proposal",
              actor: "bidder",
              action: "submit",
              object: "two copies of the technical proposal",
              mandatory: true,
              mandatorySignal: "must",
              deadline: null,
              quantity: "two",
              unit: "copies",
              submissionStage: null,
              technicalArea: null,
              revisionAction: null,
              revisionTargetHint: null,
              sourceDocumentId: "d1",
              pageNumber: 1,
              sourceSnippet: "The bidder must submit two copies of the technical proposal.",
              confidence: "HIGH",
            },
          ],
        }),
      });
      const { result } = await analyzeTender(input(d), { invoker });
      const numberSlot = result.criticalFacts.tender_number;
      assert.equal(numberSlot.status, "KNOWN");
      const fact = result.facts.find(
        (f) => numberSlot.status === "KNOWN" && f.id === numberSlot.factId,
      )!;
      assert.equal(fact.rawValue, num);
      const buyerSlot = result.criticalFacts.buyer;
      assert.equal(buyerSlot.status, "KNOWN");
      assert.equal(result.requirements.length, 1);
      assert.equal(result.requirements[0]!.mandatory, true);
    });
  }

  // ── V2-03：不同日期格式归一化等价 ──
  await ok("V2-03: 'August 18, 2026' / '2026-08-18' / '18 August 2026' 归一化一致", () => {
    for (const raw of ["August 18, 2026", "2026-08-18", "18 August 2026"]) {
      const norm = normalizeFactValue("closing_datetime", raw, `closing ${raw}`);
      assert.ok(norm && norm.kind === "datetime" && norm.date === "2026-08-18", raw);
    }
  });

  // ── V2-04：不同产品域（照明设备）—— 管线不注入任何域内容 ──
  await ok("V2-04: 照明设备域 tender 正常抽取，无任何背包/窗饰域内容", async () => {
    const page =
      "Supply of LED lighting fixtures for arena retrofits. The contractor shall provide photometric reports for each fixture type. Warranty: minimum 5 years on drivers.";
    const d = doc("d1", "BASE_TENDER", { 1: page });
    const invoker = scriptedInvoker({
      extract: () => ({
        requirements: [
          {
            category: "TECHNICAL",
            statement: "The contractor shall provide photometric reports for each fixture type",
            actor: "contractor",
            action: "provide",
            object: "photometric reports",
            mandatory: true,
            mandatorySignal: "shall",
            deadline: null,
            quantity: null,
            unit: null,
            submissionStage: null,
            technicalArea: "lighting",
            revisionAction: null,
            revisionTargetHint: null,
            sourceDocumentId: "d1",
            pageNumber: 1,
            sourceSnippet: "The contractor shall provide photometric reports for each fixture type.",
            confidence: "HIGH",
          },
        ],
        facts: [
          {
            factType: "warranty",
            claim: "Minimum 5 years warranty on drivers",
            rawValue: "minimum 5 years",
            sourceDocumentId: "d1",
            pageNumber: 1,
            sourceSnippet: "Warranty: minimum 5 years on drivers.",
            confidence: "HIGH",
          },
        ],
      }),
    });
    const { result } = await analyzeTender(input(d), { invoker });
    const corpus = JSON.stringify(result).toLowerCase();
    for (const leak of ["backpack", "rcmp", "roller shade", "somfy", "1000d", "背包", "卷帘"]) {
      assert.ok(!corpus.includes(leak), `leak: ${leak}`);
    }
    assert.equal(result.criticalFacts.warranty.status, "KNOWN");
  });

  // ── V2-05：mandatory 语言变体 + signal 验证 ──
  await ok("V2-05: 'will be rejected' 等变体判 mandatory；无 signal 支撑 → 降级 uncertain", async () => {
    const page =
      "Bids received after the closing time will be rejected. Bidders are encouraged to attend the site meeting.";
    const d = doc("d1", "BASE_TENDER", { 1: page });
    const invoker = scriptedInvoker({
      extract: () => ({
        requirements: [
          {
            category: "SUBMISSION",
            statement: "Bids must be received before the closing time",
            actor: "bidder",
            action: "submit before closing",
            object: "bid",
            mandatory: true,
            mandatorySignal: "will be rejected",
            deadline: null,
            quantity: null,
            unit: null,
            submissionStage: null,
            technicalArea: null,
            revisionAction: null,
            revisionTargetHint: null,
            sourceDocumentId: "d1",
            pageNumber: 1,
            sourceSnippet: "Bids received after the closing time will be rejected.",
            confidence: "HIGH",
          },
          {
            category: "SITE_VISIT",
            statement: "Bidders should attend the site meeting",
            actor: "bidder",
            action: "attend",
            object: "site meeting",
            mandatory: true,
            // signal 与证据不符（页面写 encouraged）→ 必须降级 uncertain
            mandatorySignal: "mandatory site meeting",
            deadline: null,
            quantity: null,
            unit: null,
            submissionStage: null,
            technicalArea: null,
            revisionAction: null,
            revisionTargetHint: null,
            sourceDocumentId: "d1",
            pageNumber: 1,
            sourceSnippet: "Bidders are encouraged to attend the site meeting.",
            confidence: "MEDIUM",
          },
        ],
      }),
    });
    const { result } = await analyzeTender(input(d), { invoker });
    const submission = result.requirements.find((r) => r.category === "SUBMISSION")!;
    const site = result.requirements.find((r) => r.category === "SITE_VISIT")!;
    assert.equal(submission.mandatory, true);
    assert.equal(site.mandatory, "uncertain");
    assert.ok(!result.mandatoryRequirementIds.includes(site.id));
  });

  // ── V2-06：文档没写的事实保持 UNKNOWN ──
  await ok("V2-06: 未提及的 warranty / bond 槽位 = UNKNOWN（不默认值）", async () => {
    const d = doc("d1", "BASE_TENDER", {
      1: "Closing date: 2027-03-01. Supply of office chairs.",
    });
    const invoker = scriptedInvoker({
      extract: () => ({
        facts: [
          {
            factType: "closing_datetime",
            claim: "Closing 2027-03-01",
            rawValue: "2027-03-01",
            sourceDocumentId: "d1",
            pageNumber: 1,
            sourceSnippet: "Closing date: 2027-03-01",
            confidence: "HIGH",
          },
        ],
      }),
    });
    const { result } = await analyzeTender(input(d), { invoker });
    assert.equal(result.criticalFacts.warranty.status, "UNKNOWN");
    assert.equal(result.criticalFacts.bond.status, "UNKNOWN");
    assert.ok(result.unknowns.some((u) => u.field === "warranty"));
    // summary 显式呈现 UNKNOWN 而不是编一个值
    assert.ok(result.projectSummary.includes("UNKNOWN"));
  });

  // ── V2-07 / V2-08：跨文档同一要求去重 + 多证据保留 ──
  await ok("V2-07/08: Base+Spec 重复要求 → 业务一条、EvidenceRefs ≥ 2 全保留", async () => {
    const base = doc("d_base", "BASE_TENDER", {
      3: "All fixtures must be certified to CSA C22.2 standards prior to delivery.",
    });
    const spec = doc("d_spec", "SPECIFICATION", {
      12: "Fixtures must be certified to CSA C22.2 standards prior to delivery to site.",
    });
    const mk = (docId: string, page: number, snippet: string) => ({
      category: "TECHNICAL" as const,
      statement: "All fixtures must be certified to CSA C22.2 standards prior to delivery",
      actor: "contractor",
      action: "certify",
      object: "fixtures",
      mandatory: true as const,
      mandatorySignal: "must",
      deadline: null,
      quantity: null,
      unit: null,
      submissionStage: null,
      technicalArea: null,
      revisionAction: null,
      revisionTargetHint: null,
      sourceDocumentId: docId,
      pageNumber: page,
      sourceSnippet: snippet,
      confidence: "HIGH" as const,
    });
    const invoker = scriptedInvoker({
      extract: (prompt) => {
        if (prompt.includes("documentId d_base")) {
          return {
            requirements: [
              mk("d_base", 3, "All fixtures must be certified to CSA C22.2 standards prior to delivery."),
            ],
          };
        }
        return {
          requirements: [
            mk("d_spec", 12, "Fixtures must be certified to CSA C22.2 standards prior to delivery to site."),
          ],
        };
      },
    });
    const { result } = await analyzeTender(input(base, spec), { invoker });
    assert.equal(result.requirements.length, 1);
    const req = result.requirements[0]!;
    assert.ok(req.evidence.length >= 2, `evidence=${req.evidence.length}`);
    const docs = new Set(req.evidence.map((e) => e.documentId));
    assert.ok(docs.has("d_base") && docs.has("d_spec"));
  });

  // ── V2-09：Addendum 明确修订 → base SUPERSEDED / addendum ACTIVE ──
  await ok("V2-09: Addendum 'revised to 3 years' → base(5 years) SUPERSEDED + AddendumChange", async () => {
    const base = doc("d_base", "BASE_TENDER", {
      7: "The contractor must provide a warranty of 5 years on all installed systems.",
    });
    const add = doc("d_add", "ADDENDUM", {
      1: "Addendum 2: Section 7 warranty requirement is revised to 3 years for all installed systems.",
    });
    const invoker = scriptedInvoker({
      extract: (prompt) => {
        if (prompt.includes("documentId d_base")) {
          return {
            requirements: [
              {
                category: "WARRANTY",
                statement: "The contractor must provide a warranty of 5 years on all installed systems",
                actor: "contractor",
                action: "provide warranty",
                object: "installed systems",
                mandatory: true,
                mandatorySignal: "must",
                deadline: null,
                quantity: "5",
                unit: "years",
                submissionStage: null,
                technicalArea: null,
                revisionAction: null,
                revisionTargetHint: null,
                sourceDocumentId: "d_base",
                pageNumber: 7,
                sourceSnippet: "The contractor must provide a warranty of 5 years on all installed systems.",
                confidence: "HIGH",
              },
            ],
          };
        }
        return {
          requirements: [
            {
              category: "WARRANTY",
              statement: "Warranty requirement revised to 3 years for all installed systems",
              actor: "contractor",
              action: "provide warranty",
              object: "installed systems",
              mandatory: true,
              mandatorySignal: "revised to",
              deadline: null,
              quantity: "3",
              unit: "years",
              submissionStage: null,
              technicalArea: null,
              revisionAction: "REVISES",
              revisionTargetHint: "Section 7 warranty requirement",
              sourceDocumentId: "d_add",
              pageNumber: 1,
              sourceSnippet: "warranty requirement is revised to 3 years for all installed systems.",
              confidence: "HIGH",
            },
          ],
        };
      },
    });
    const { result } = await analyzeTender(input(base, add), { invoker });
    const baseReq = result.requirements.find((r) => r.quantity === "5")!;
    const addReq = result.requirements.find((r) => r.quantity === "3")!;
    assert.equal(baseReq.status, "SUPERSEDED");
    assert.equal(baseReq.supersededById, addReq.id);
    assert.equal(addReq.status, "ACTIVE");
    assert.equal(result.addendumChanges.length, 1);
    assert.equal(result.addendumChanges[0]!.action, "REVISES");
    // mandatory 视图只含 ACTIVE
    assert.ok(!result.mandatoryRequirementIds.includes(baseReq.id));
    assert.ok(result.mandatoryRequirementIds.includes(addReq.id));
  });

  // ── V2-10：无修订语言的矛盾 → NEEDS_REVIEW + UNRESOLVED conflict，不偷偷择一 ──
  await ok("V2-10: Spec 5 年 vs 表格 3 年（无修订语言）→ 双方 NEEDS_REVIEW + conflict 浮出", async () => {
    const base = doc("d_base", "BASE_TENDER", {
      7: "The contractor must provide a warranty period of 5 years on all systems.",
    });
    const form = doc("d_form", "SUBMISSION_FORM", {
      2: "Warranty period required: contractor provides warranty of 3 years on all systems.",
    });
    const invoker = scriptedInvoker({
      extract: (prompt) => {
        if (prompt.includes("documentId d_base")) {
          return {
            requirements: [
              {
                category: "WARRANTY",
                statement: "Contractor must provide a warranty period of 5 years on all systems",
                actor: "contractor",
                action: "provide",
                object: "warranty",
                mandatory: true,
                mandatorySignal: "must",
                deadline: null,
                quantity: "5",
                unit: "years",
                submissionStage: null,
                technicalArea: null,
                revisionAction: null,
                revisionTargetHint: null,
                sourceDocumentId: "d_base",
                pageNumber: 7,
                sourceSnippet: "The contractor must provide a warranty period of 5 years on all systems.",
                confidence: "HIGH",
              },
            ],
          };
        }
        return {
          requirements: [
            {
              category: "WARRANTY",
              statement: "Contractor provides warranty of 3 years on all systems per submission form",
              actor: "contractor",
              action: "provide",
              object: "warranty",
              mandatory: "uncertain",
              mandatorySignal: null,
              deadline: null,
              quantity: "3",
              unit: "years",
              submissionStage: null,
              technicalArea: null,
              revisionAction: null,
              revisionTargetHint: null,
              sourceDocumentId: "d_form",
              pageNumber: 2,
              sourceSnippet: "contractor provides warranty of 3 years on all systems.",
              confidence: "MEDIUM",
            },
          ],
        };
      },
    });
    const { result } = await analyzeTender(input(base, form), { invoker });
    assert.equal(result.requirements.length, 2);
    // 两条同主题不同值：不得一 ACTIVE 一被忽略
    const statuses = result.requirements.map((r) => r.status).sort();
    assert.ok(
      statuses.every((s) => s === "NEEDS_REVIEW") ||
        result.conflicts.some((c) => c.resolution === "UNRESOLVED"),
      `statuses=${statuses.join(",")} conflicts=${result.conflicts.length}`,
    );
    assert.ok(result.risks.some((r) => r.riskType === "CONTRADICTION"));
  });

  // ── V2-11（扰动护栏）：文档顺序不影响业务结果 ──
  await ok("V2-11: 文档输入顺序颠倒 → requirement 集合与 mandatory 判定不变", async () => {
    const a = doc("d_a", "BASE_TENDER", {
      1: "The supplier must deliver goods within 45 days of order.",
    });
    const b = doc("d_b", "SPECIFICATION", {
      1: "All packaging must be recyclable per municipal guidelines.",
    });
    const mkExtract = (prompt: string) => {
      if (prompt.includes("documentId d_a")) {
        return {
          requirements: [
            {
              category: "DELIVERY" as const,
              statement: "The supplier must deliver goods within 45 days of order",
              actor: "supplier",
              action: "deliver",
              object: "goods",
              mandatory: true as const,
              mandatorySignal: "must",
              deadline: "45 days",
              quantity: null,
              unit: null,
              submissionStage: null,
              technicalArea: null,
              revisionAction: null,
              revisionTargetHint: null,
              sourceDocumentId: "d_a",
              pageNumber: 1,
              sourceSnippet: "The supplier must deliver goods within 45 days of order.",
              confidence: "HIGH" as const,
            },
          ],
        };
      }
      return {
        requirements: [
          {
            category: "COMPLIANCE" as const,
            statement: "All packaging must be recyclable per municipal guidelines",
            actor: "supplier",
            action: "package",
            object: "packaging",
            mandatory: true as const,
            mandatorySignal: "must",
            deadline: null,
            quantity: null,
            unit: null,
            submissionStage: null,
            technicalArea: null,
            revisionAction: null,
            revisionTargetHint: null,
            sourceDocumentId: "d_b",
            pageNumber: 1,
            sourceSnippet: "All packaging must be recyclable per municipal guidelines.",
            confidence: "HIGH" as const,
          },
        ],
      };
    };
    const r1 = await analyzeTender(input(a, b), { invoker: scriptedInvoker({ extract: mkExtract }) });
    const r2 = await analyzeTender(input(b, a), { invoker: scriptedInvoker({ extract: mkExtract }) });
    const sig = (res: typeof r1) =>
      res.result.requirements
        .map((r) => `${r.category}|${r.statement}|${r.mandatory}|${r.status}`)
        .sort()
        .join(";;");
    assert.equal(sig(r1), sig(r2));
    assert.equal(
      r1.result.mandatoryRequirementIds.length,
      r2.result.mandatoryRequirementIds.length,
    );
  });

  console.log(`\nV2 generic understanding: ${count()} 组断言全部通过`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
