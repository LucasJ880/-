/**
 * FLOW-H3 询价发出之后招标分析更新过——纯逻辑与接线
 * 运行：npx tsx src/lib/tender-rfq/__tests__/analysis-update-note.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analysisAvailableAt, analysisUpdateNoteZh, analysisUpdateNotes, isRfqAnalysisUpdateNoteEnabledForOrgWithEnv } from "../analysis-update-note";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const TZ = "America/Toronto";
const d = (iso: string) => new Date(iso);

console.log("判断规则");
{
  const rounds = [{ inquiryId: "r1", draftedAt: d("2026-11-10T15:00:00Z") }, { inquiryId: "r2", draftedAt: d("2026-11-13T15:00:00Z") }];
  const notes = analysisUpdateNotes({ rounds, latestAnalysisAt: d("2026-11-12T15:00:00Z"), timeZone: TZ });
  ok("起草之后分析才可用的轮次有提示；分析之后才起草的没有", Object.keys(notes).join() === "r1", notes);
  ok("提示写明起草日期与分析更新日期（按组织时区）、要求可能变了、请核对", notes.r1.noteZh === "这一轮是 2026年11月10日起草的；之后招标分析在 2026年11月12日更新过，这一轮引用的要求可能已经变了，请对照最新的要求核对，需要时另发一轮");
  ok("恰好同一时刻：不算之后", Object.keys(analysisUpdateNotes({ rounds, latestAnalysisAt: d("2026-11-10T15:00:00Z"), timeZone: TZ })).length === 0);
  ok("晚 1 毫秒：算之后", Object.keys(analysisUpdateNotes({ rounds, latestAnalysisAt: d("2026-11-10T15:00:00.001Z"), timeZone: TZ })).join() === "r1");
  ok("没有可用的分析：都没有提示", Object.keys(analysisUpdateNotes({ rounds, latestAnalysisAt: null, timeZone: TZ })).length === 0);
  ok("没有轮次：空", Object.keys(analysisUpdateNotes({ rounds: [], latestAnalysisAt: d("2026-11-12T15:00:00Z"), timeZone: TZ })).length === 0);
  ok("日期按时区：多伦多 11 月 11 日晚上 23 点（UTC 12 日 04 点）记作 11 日", analysisUpdateNoteZh(d("2026-11-12T04:00:00Z"), d("2026-11-13T04:00:00Z"), TZ).startsWith("这一轮是 2026年11月11日起草的；之后招标分析在 2026年11月12日更新过"));
  ok("分析可用的时刻：完成时间；没有完成时间按创建时间", analysisAvailableAt({ completedAt: d("2026-11-12T00:00:00Z"), createdAt: d("2026-11-11T00:00:00Z") }).toISOString() === "2026-11-12T00:00:00.000Z" && analysisAvailableAt({ completedAt: null, createdAt: d("2026-11-11T00:00:00Z") }).toISOString() === "2026-11-11T00:00:00.000Z");
  ok("提示里没有要求编号、没有「哪条变了」的说法", !/R-\d|第 \d+ 条|已变更/.test(notes.r1.noteZh) && notes.r1.noteZh.includes("可能"));
}

console.log("开关");
{
  const on = (env: Record<string, string | undefined>, org: string | null = "org1") => isRfqAnalysisUpdateNoteEnabledForOrgWithEnv(org, env as NodeJS.ProcessEnv);
  ok("默认关；1 / true / on / yes 算开；别的算关；没有组织算关", !on({}) && ["1", "true", "on", "yes"].every((v) => on({ TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ENABLED: v })) && ["0", "false", "", "2"].every((v) => !on({ TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ENABLED: v })) && !on({ TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ENABLED: "1" }, null));
  ok("名单：不填 = 所有组织；填了只认名单里的", on({ TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ENABLED: "1", TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ORG_ALLOWLIST: "a, org1" }) && !on({ TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ENABLED: "1", TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ORG_ALLOWLIST: "a,b" }));
}

console.log("接线");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const pure = read("src/lib/tender-rfq/analysis-update-note.ts").replace(/\/\*[\s\S]*?\*\//g, "");
  ok("规则是纯的：不访问数据库、不发请求、不调模型", !/@\/lib\/db|prisma|fetch\(|createCompletion/i.test(pure));
  const entry = read("src/lib/tender-rfq/web-entry.ts");
  ok("入口接口：开关开着才多这一项", entry.includes("...(isRfqAnalysisUpdateNoteEnabledForOrg(input.orgId) ? { analysisUpdateNotes: await loadAnalysisUpdateNotes(input.orgId, project.id, executed, timeZone) } : {}),"));
  const loader = entry.slice(entry.indexOf("async function loadAnalysisUpdateNotes("));
  ok("取数：只看这个组织、这个项目、等待审核或已批准的分析；轮次取自已执行的发送卡的创建时间；只读", loader.includes('where: { orgId, projectId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },') && loader.includes("return inquiryId ? [{ inquiryId, draftedAt: a.createdAt }] : [];") && !/\.(create|update|upsert|delete)\w*\(/.test(loader) && entry.includes('where: { orgId: input.orgId, projectId: project.id, type: TENDER_SEND_RFQ_TYPE, status: "executed" },'));
  const section = read("src/components/inquiry/project-inquiry-section.tsx");
  ok("询价区：把这一轮的提示交给状态行", section.includes("analysisUpdateNote={ready.analysisUpdateNotes?.[r.id]?.noteZh ?? null}"));
  const line = read("src/components/inquiry/rfq-round-status-line.tsx");
  ok("状态行：有提示才显示", line.includes('{analysisUpdateNote ? (') && line.includes('data-testid="rfq-analysis-update-note"'));
}

console.log(`\n✓ analysis-update-note: ${passed} 项断言全部通过`);
