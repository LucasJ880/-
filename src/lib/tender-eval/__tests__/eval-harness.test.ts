/**
 * tender-eval 评分引擎自测（纯逻辑，无 DB / 无 LLM / 无真实 PDF）
 *
 * 保护对象是"评估基础设施本身的可信度"：归一化判等、要求匹配判定、
 * 证据核验（含"值对证据错=失败"）、澄清分类、幻觉探针、expectedUnknown。
 */

import assert from "node:assert";

import type {
  ClarificationCandidate,
  FactCandidate,
  RequirementCandidate,
} from "@/lib/tender-auto-analysis/extract/types";
import type { TenderEvalCase } from "@/lib/tender-eval/contract";
import { evaluateCase } from "@/lib/tender-eval/evaluate";
import {
  anchorGroupsMatch,
  extractDatesYmd,
  extractDurationsDays,
  extractMoneyAmounts,
  extractTimesHm,
  tokenCoverage,
  valueMatchesText,
} from "@/lib/tender-eval/normalize";

let passed = 0;
function ok(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/* ---------------- normalize ---------------- */

ok("日期归一化：2026-08-13 == Aug 13 2026 == August 13, 2026 == 13 August 2026", () => {
  for (const s of [
    "closing 2026-08-13",
    "Aug 13 2026",
    "August 13, 2026",
    "13 August 2026",
    "due Aug. 13th, 2026",
  ]) {
    assert.ok(extractDatesYmd(s).includes("2026-08-13"), s);
  }
  assert.ok(!extractDatesYmd("Aug 14 2026").includes("2026-08-13"));
});

ok("时间归一化：14 :00 == 14:00 == 2:00 pm", () => {
  assert.ok(extractTimesHm("At /à : 14 :00 MDT").includes("14:00"));
  assert.ok(extractTimesHm("closes at 2:00 pm").includes("14:00"));
  assert.ok(!extractTimesHm("closes at 2:00 pm").includes("02:00"));
});

ok("金额归一化：$2,000,000 == 2000000；$400K == 400000", () => {
  assert.ok(extractMoneyAmounts("Minimum $2,000,000 general liability").includes(2_000_000));
  assert.ok(extractMoneyAmounts("must not exceed $400,000.00").includes(400_000));
  assert.ok(extractMoneyAmounts("cap of $400K applies").includes(400_000));
});

ok("时长归一化：30 days == 30 calendar days == 30 个日历日", () => {
  for (const s of ["within 30 days", "30 calendar days", "30 个日历日", "30 天内"]) {
    assert.ok(extractDurationsDays(s).includes(30), s);
  }
});

ok("valueMatchesText：datetime 需日期+时间+时区齐备", () => {
  const expected = {
    kind: "datetime",
    date: "2026-08-18",
    time: "14:00",
    tz: "MDT",
  } as const;
  assert.ok(valueMatchesText(expected, "截标 August 18, 2026 14 :00 MDT"));
  assert.ok(!valueMatchesText(expected, "截标 August 18, 2026 14:00 EST"));
  assert.ok(!valueMatchesText(expected, "截标 August 18, 2026"));
});

ok("anchorGroupsMatch：组内 AND、组间 OR", () => {
  assert.ok(anchorGroupsMatch("call-up 后 30 天", [["call-up", "30"], ["never"]]));
  assert.ok(!anchorGroupsMatch("call-up 后 30 天", [["call-up", "60"]]));
  assert.ok(!anchorGroupsMatch("anything", []));
});

ok("tokenCoverage 对停用词不敏感", () => {
  const cov = tokenCoverage(
    "Delivery must be completed within 30 days of call-up issuance",
    "delivery completed within 30 days of call-up issuance yes",
  );
  assert.ok(cov > 0.9, String(cov));
});

/* ---------------- evaluateCase 端到端（微型合成 case） ---------------- */

const PAGE_TEXT =
  "Bid closing: 2026-05-01\nThe bidder must provide a performance warranty of 2 years.\nDelivery within 30 days of order.";

function miniCase(): TenderEvalCase {
  return {
    contractVersion: "tender-eval/v1",
    caseId: "mini",
    title: "mini",
    projectType: "test",
    provenance: {
      kind: "SYNTHETIC",
      source: "inline",
      redaction: "NONE",
      goldenAnswerMethod: "PENDING_HUMAN_CONFIRMATION",
      confirmedBy: null,
      confirmedAt: null,
    },
    documentSet: [
      {
        documentId: "d1",
        role: "MAIN",
        title: "main",
        pages: [{ documentId: "d1", pageNumber: 1, contentText: PAGE_TEXT }],
      },
    ],
    goldenFacts: [
      {
        factId: "GF-CLOSING",
        field: "closing_datetime",
        description: "closing 2026-05-01",
        expected: { kind: "date", value: "2026-05-01" },
        critical: true,
        evidence: [
          { documentId: "d1", pageNumbers: [1], sourceQuote: "Bid closing: 2026-05-01" },
        ],
        matchAnchors: [["closing"]],
      },
      {
        factId: "GF-DELIVERY",
        field: "delivery",
        description: "30 days",
        expected: { kind: "duration", days: 30 },
        critical: true,
        evidence: [
          { documentId: "d1", pageNumbers: [1], sourceQuote: "Delivery within 30 days" },
        ],
        matchAnchors: [["delivery"]],
      },
      {
        factId: "GF-MISSING",
        field: "bond",
        description: "never extracted",
        expected: { kind: "text", value: "bond" },
        critical: false,
        evidence: [],
        matchAnchors: [["bond"]],
      },
    ],
    goldenRequirements: [
      {
        goldenId: "GR-WARRANTY",
        text: "The bidder must provide a performance warranty of 2 years",
        category: "warranty",
        mandatory: true,
        evidence: [
          {
            documentId: "d1",
            pageNumbers: [1],
            sourceQuote: "must provide a performance warranty of 2 years",
          },
        ],
        importance: "CRITICAL",
        matchAnchors: [["warranty"]],
      },
      {
        goldenId: "GR-MISSED",
        text: "Bidder must supply installation drawings",
        category: "technical",
        mandatory: true,
        evidence: [],
        importance: "HIGH",
        matchAnchors: [["drawings"]],
      },
    ],
    knownAmbiguities: [],
    goldenRisks: [
      {
        riskId: "GRISK-DELIVERY",
        severity: "CRITICAL",
        description: "30 天交付压力",
        evidence: [],
        matchAnchors: [["30 days"]],
      },
      {
        riskId: "GRISK-MISSED",
        severity: "CRITICAL",
        description: "无人提到的风险",
        evidence: [],
        matchAnchors: [["nonexistent topic"]],
      },
    ],
    goldenClarifications: [
      {
        clarId: "GC-NEC",
        topic: "数量",
        necessity: "NECESSARY",
        answeredInDocument: false,
        evidence: [],
        matchAnchors: [["数量"]],
      },
      {
        clarId: "GC-ANSWERED",
        topic: "质保（文档已答 2 年）",
        necessity: "USEFUL",
        answeredInDocument: true,
        evidence: [],
        matchAnchors: [["warranty"], ["质保"]],
      },
    ],
    expectedUnknowns: [
      {
        field: "budget",
        description: "无预算",
        forbiddenClaimAnchors: [["budget"]],
      },
    ],
    hallucinationProbes: [["backpack"]],
    notes: "",
  };
}

function fact(
  factKey: string,
  contentZh: string,
  page: number | null,
  snippet: string,
  statementKind: FactCandidate["statementKind"] = "CONFIRMED_FACT",
): FactCandidate {
  return {
    factKey,
    statementKind,
    contentZh,
    contentOriginal: contentZh,
    confidence: "CONFIRMED",
    sourceRefs:
      page === null
        ? []
        : [
            {
              documentId: "d1",
              pageNumber: page,
              originalTextSnippet: snippet,
              sectionLabel: null,
              extractionMethod: "test",
              confidence: "CONFIRMED",
            },
          ],
  };
}

function req(code: string, body: string, mandatory = true): RequirementCandidate {
  return {
    requirementCode: code,
    category: "mandatory_general",
    originalRequirement: body,
    chineseTranslation: body,
    mandatory,
    evidenceRequired: false,
    complianceStatus: "NOT_ASSESSED",
    reviewStatus: "AI_EXTRACTED",
    sourcePage: 1,
    sourceRefs: [
      {
        documentId: "d1",
        pageNumber: 1,
        originalTextSnippet: body.slice(0, 60),
        sectionLabel: null,
        extractionMethod: "test",
        confidence: "HIGH_CONFIDENCE",
      },
    ],
  };
}

function clar(question: string, reason: string): ClarificationCandidate {
  return { question, reason, priority: "HIGH", enquiryDeadline: null, sourceRefs: [] };
}

ok("端到端：值对证据对=CORRECT；值对证据错=CORRECT_VALUE_BAD_EVIDENCE；缺失=NOT_EXTRACTED", () => {
  const c = miniCase();
  const result = evaluateCase(c, {
    facts: [
      fact("closing", "截标 2026-05-01", 1, "Bid closing: 2026-05-01"),
      // 值对但 snippet 不在页上 → 证据错
      fact("delivery", "交付 30 days", 1, "this snippet is not on the page"),
      // budget 幻觉声称 → expectedUnknown 违规
      fact("budget_claim", "budget is $1M", 1, "Delivery within 30 days"),
    ],
    requirements: [
      req("GEN-001", "must provide a performance warranty of 2 years"),
      req("GEN-002", "the bidder must provide warranty coverage"), // 同 golden → DUPLICATE
      req("GEN-003", "bidder must paint the office"), // 无 golden → FALSE_POSITIVE
    ],
    clarifications: [
      clar("请确认项目数量与分批安排？", "缺数量"),
      clar("质保 warranty 年限是多少？", "想确认"), // 文档已答 → ALREADY_ANSWERED
      clar("backpack 的面料是什么？", "无关"), // 幻觉探针
      clar("场地移交时间？", "未涉及"), // LOW_VALUE
    ],
    riskLines: ["交付 30 days 周期紧", "backpack 供应链风险"],
  });

  const byId = new Map(result.facts.map((f) => [f.factId, f]));
  assert.equal(byId.get("GF-CLOSING")!.verdict, "CORRECT");
  assert.equal(byId.get("GF-DELIVERY")!.verdict, "CORRECT_VALUE_BAD_EVIDENCE");
  assert.equal(byId.get("GF-MISSING")!.verdict, "NOT_EXTRACTED");
  // critical = GF-CLOSING + GF-DELIVERY；只有前者 CORRECT
  assert.equal(result.metrics.criticalFactAccuracy, 0.5);
  assert.equal(result.metrics.factsCorrectValueBadEvidence, 1);

  const reqById = new Map(result.requirements.perGolden.map((g) => [g.goldenId, g]));
  assert.equal(reqById.get("GR-WARRANTY")!.verdict, "MATCHED");
  assert.equal(reqById.get("GR-MISSED")!.verdict, "MISSED");
  const attrib = new Map(
    result.requirements.perExtracted.map((x) => [x.requirementCode, x.verdict]),
  );
  assert.equal(attrib.get("GEN-002"), "DUPLICATE");
  assert.equal(attrib.get("GEN-003"), "FALSE_POSITIVE");
  assert.equal(result.metrics.requirementRecallStrict, 0.5);
  assert.equal(result.metrics.mandatoryRecallStrict, 0.5);

  const riskById = new Map(result.risks.perGolden.map((r) => [r.riskId, r]));
  assert.equal(riskById.get("GRISK-DELIVERY")!.verdict, "DETECTED");
  assert.equal(riskById.get("GRISK-MISSED")!.verdict, "MISSED");
  assert.equal(result.metrics.criticalRiskMissed, 1);
  assert.equal(result.risks.hallucinatedLines.length, 1);

  const verdicts = result.clarifications.perQuestion.map((q) => q.verdict);
  assert.deepEqual(verdicts, [
    "NECESSARY",
    "ALREADY_ANSWERED",
    "HALLUCINATED",
    "LOW_VALUE",
  ]);
  assert.equal(result.metrics.usefulClarificationRate, 0.25);
  assert.equal(result.metrics.alreadyAnsweredRate, 0.25);
  assert.equal(result.metrics.necessaryClarificationCoverage, 1);

  assert.equal(result.unknownViolations.length, 1);
  assert.equal(result.unknownViolations[0]!.field, "budget");

  // 跨域泄漏统一指标：本用例中 backpack 探针命中 1 条风险行 + 1 条幻觉澄清
  assert.equal(result.metrics.crossDomainLeakFacts, 0);
  assert.equal(result.metrics.crossDomainLeakRequirements, 0);
  assert.equal(result.metrics.crossDomainLeakTotal, 2);
});

ok("跨域泄漏指标：fact / requirement 命中探针分别计数并进 total", () => {
  const c = miniCase();
  const result = evaluateCase(c, {
    facts: [
      fact("leak_fact", "backpack 面料参数", 1, "Bid closing: 2026-05-01"),
    ],
    requirements: [req("GEN-009", "the bidder must supply backpack samples")],
    clarifications: [],
    riskLines: [],
  });
  assert.equal(result.metrics.crossDomainLeakFacts, 1);
  assert.equal(result.metrics.crossDomainLeakRequirements, 1);
  assert.equal(result.metrics.crossDomainLeakTotal, 2);
  assert.equal(result.crossDomainLeaks.length, 2);
});

ok("幻觉风险行不给 golden 记 DETECTED", () => {
  const c = miniCase();
  const result = evaluateCase(c, {
    facts: [],
    requirements: [],
    clarifications: [],
    // 唯一提到 30 days 的行同时命中幻觉探针 backpack → 不得记 DETECTED
    riskLines: ["backpack 交付 30 days 风险"],
  });
  const riskById = new Map(result.risks.perGolden.map((r) => [r.riskId, r]));
  assert.equal(riskById.get("GRISK-DELIVERY")!.verdict, "MISSED");
  assert.equal(result.risks.hallucinatedLines.length, 1);
});

ok("澄清主题匹配只看问题文本（reason 附带词不误触）", () => {
  const c = miniCase();
  const result = evaluateCase(c, {
    facts: [],
    requirements: [],
    clarifications: [clar("场地移交时间？", "warranty 顺带一提")],
    riskLines: [],
  });
  assert.equal(result.clarifications.perQuestion[0]!.verdict, "LOW_VALUE");
});

ok("分母为 0 的比率输出 null（N/A）而非 0", () => {
  const c = miniCase();
  c.goldenRequirements = [];
  c.goldenRisks = [];
  const result = evaluateCase(c, {
    facts: [],
    requirements: [],
    clarifications: [],
    riskLines: [],
  });
  assert.equal(result.metrics.requirementRecallStrict, null);
  assert.equal(result.metrics.riskRecall, null);
  assert.equal(result.metrics.evidenceCoverage, null);
});

console.log(`\ntender-eval harness self-test: ${passed} 组断言全部通过`);
