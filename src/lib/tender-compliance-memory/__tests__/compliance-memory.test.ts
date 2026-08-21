/**
 * 合规记忆探针（CM-01..09）
 * 运行：npx tsx src/lib/tender-compliance-memory/__tests__/compliance-memory.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  jaccard,
  matchRequirementsToMemory,
  normalizeRequirementText,
  positionFromClaim,
  requirementFingerprint,
  requirementTokens,
  type CompliancePosition,
} from "@/lib/tender-compliance-memory";
import { MEMORY_CLAIM_TYPES } from "@/lib/corporate-memory/types";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const HRM_A = "Bids will only be received up to and including 2:00 p.m. local time on September 8, 2026 via upload to the Bidding System.";
const HRM_B = "Bids will only be received up to and including 2:00 P.M. local time on September 8, 2026, via upload to the Bidding System!";
const HRM_C = "Bids will only be received up to and including 2:00 p.m. local time on October 3, 2026 via upload to the Bidding System.";
const OTHER = "The successful proponent must maintain commercial general liability insurance of not less than $2,000,000.";

const pos = (id: string, text: string, fit: string, proj = "old"): CompliancePosition => ({
  claimId: id, fingerprint: requirementFingerprint(text), textSample: text, category: null, fit, noteZh: null,
  sourceProjectId: proj, sourceProjectName: `项目 ${proj}`, sourceRequirementCode: "R-1", confirmedAt: "2026-08-01T00:00:00Z",
});

console.log("合规记忆探针");
ok(
  normalizeRequirementText(HRM_A) === normalizeRequirementText(HRM_B) && requirementFingerprint(HRM_A) === requirementFingerprint(HRM_B),
  "CM-01: 归一化忽略大小写/标点/空白（同一条款的排版差异 = 同一指纹）",
);
ok(requirementFingerprint(HRM_A) !== requirementFingerprint(HRM_C), "CM-02: 日期不同 = 不同指纹（数字保留）");
{
  const s = jaccard(requirementTokens(HRM_A), requirementTokens(HRM_C));
  const t = jaccard(requirementTokens(HRM_A), requirementTokens(OTHER));
  ok(s >= 0.75 && t < 0.3, `CM-03: 相似条款 Jaccard ${s.toFixed(2)} ≥ 0.75；无关条款 ${t.toFixed(2)} < 0.3`);
}
{
  const out = matchRequirementsToMemory(
    [{ id: "r1", text: HRM_B }, { id: "r2", text: HRM_C }, { id: "r3", text: OTHER }],
    [pos("c1", HRM_A, "HAVE")],
  );
  ok(
    out.length === 2 && out.find((x) => x.requirementId === "r1")?.kind === "exact" && out.find((x) => x.requirementId === "r2")?.kind === "fuzzy" && !out.some((x) => x.requirementId === "r3"),
    "CM-04: 逐字一致 → exact；改日期 → fuzzy；无关 → 无建议",
    out.map((x) => `${x.requirementId}:${x.kind}:${x.score}`),
  );
}
{
  const out = matchRequirementsToMemory([{ id: "r1", text: HRM_A }], [pos("c1", HRM_A, "HAVE", "same")], { excludeProjectId: "same" });
  ok(out.length === 0, "CM-05（反例守卫）: 本项目自己的确认不作为本项目的「历史」（防回声）");
}
{
  const out = matchRequirementsToMemory([{ id: "r1", text: HRM_A }], [pos("c-old", HRM_A, "HAVE"), pos("c-new", HRM_A, "RFI")]);
  ok(out.length === 1 && out[0]!.fit === "HAVE", "CM-06: 同指纹多条立场取首条（列表按新→旧传入时 = 最新）");
}
ok(
  positionFromClaim({ id: "x", subjectKey: "req:abc", structuredValue: { fit: "HAVE", textSample: "t" } })?.fingerprint === "abc" &&
    positionFromClaim({ id: "x", subjectKey: "req:abc", structuredValue: { textSample: "t" } }) === null &&
    positionFromClaim({ id: "x", subjectKey: "req:abc", structuredValue: "junk" }) === null,
  "CM-07: claim 结构化值还原；缺 fit/坏形 → null 不抛",
);
ok((MEMORY_CLAIM_TYPES as readonly string[]).includes("COMPLIANCE_POSITION"), "CM-08: T3 词表含 COMPLIANCE_POSITION");
{
  const route = code("src/app/api/projects/[id]/bid-fit/route.ts");
  const rec = code("src/lib/tender-compliance-memory/record.ts");
  const card = readFileSync(join(process.cwd(), "src/components/tender-analysis/bid-fit-matrix-card.tsx"), "utf-8");
  ok(
    route.includes("recordCompliancePosition(") && route.includes('action === "apply-memory"') && route.includes('via: "memory"') && route.includes("excludeProjectId: projectId") && /if \(!matrix\[r\.id\]\)|filter\(\(r\) => !matrix\[r\.id\]\)/.test(route),
    "CM-09a: 标注写记忆；apply-memory 只填未标、带 provenance、排除本项目",
  );
  ok(
    rec.includes('actorType: "user"') && rec.includes('verificationStatus: "HUMAN_CONFIRMED"') && rec.includes("supersedeMemoryClaim(") && rec.includes("console.warn"),
    "CM-09b: 记忆写入 actor=user、HUMAN_CONFIRMED、立场变化 supersede、失败不阻塞",
  );
  ok(card.includes('data-testid="bid-fit-memory"') && card.includes('data-testid="bid-fit-apply-memory"') && card.includes('applyMemory("exact")') && card.includes("历史确认"), "CM-09c: 矩阵卡 exact 自动带入 + 相似一键采纳 + 历史确认标签");
}
console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
