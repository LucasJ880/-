/**
 * FLOW-H3 询价发出之后招标分析更新过——纯逻辑与接线
 * 运行：npx tsx src/lib/tender-rfq/__tests__/analysis-update-note.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RfqRoundStatusLine } from "@/components/inquiry/rfq-round-status-line";
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
  const rounds = [{ inquiryId: "r1", draftedAt: d("2026-11-10T15:00:00Z") }, { inquiryId: "r2", draftedAt: d("2026-11-11T15:00:00Z") }];
  const notes = analysisUpdateNotes({ rounds, latestAnalysisAt: d("2026-11-12T15:00:00Z"), timeZone: TZ });
  ok("两轮都在分析更新之前起草：两轮都有提示", Object.keys(notes).sort().join() === "r1,r2", notes);
  ok("提示写明起草日期与分析更新日期（按组织时区）、要求可能变了、请核对", notes.r1.noteZh === "这一轮是 2026年11月10日起草的；之后招标分析在 2026年11月12日有了更新（新的一份完成或批准），这一轮引用的要求可能已经变了，请对照最新的要求核对，需要时另发一轮");
  const followed = analysisUpdateNotes({ rounds: [...rounds, { inquiryId: "r3", draftedAt: d("2026-11-13T15:00:00Z") }], latestAnalysisAt: d("2026-11-12T15:00:00Z"), timeZone: TZ });
  ok("分析更新之后已经又起草过一轮：之前的轮次不再提示，新的一轮也没有", Object.keys(followed).length === 0, followed);
  const one = [{ inquiryId: "r1", draftedAt: d("2026-11-10T15:00:00Z") }];
  ok("恰好同一时刻：不算之后", Object.keys(analysisUpdateNotes({ rounds: one, latestAnalysisAt: d("2026-11-10T15:00:00Z"), timeZone: TZ })).length === 0);
  ok("晚 1 毫秒：算之后", Object.keys(analysisUpdateNotes({ rounds: one, latestAnalysisAt: d("2026-11-10T15:00:00.001Z"), timeZone: TZ })).join() === "r1");
  ok("没有可用的分析：都没有提示", Object.keys(analysisUpdateNotes({ rounds, latestAnalysisAt: null, timeZone: TZ })).length === 0);
  ok("没有轮次：空", Object.keys(analysisUpdateNotes({ rounds: [], latestAnalysisAt: d("2026-11-12T15:00:00Z"), timeZone: TZ })).length === 0);
  ok("日期按时区：多伦多 11 月 11 日晚上 23 点（UTC 12 日 04 点）记作 11 日", analysisUpdateNoteZh(d("2026-11-12T04:00:00Z"), d("2026-11-13T04:00:00Z"), TZ).startsWith("这一轮是 2026年11月11日起草的；之后招标分析在 2026年11月12日有了更新"));
  ok("分析更新的时刻：完成时间；没有完成时间按创建时间", analysisAvailableAt({ completedAt: d("2026-11-12T00:00:00Z"), createdAt: d("2026-11-11T00:00:00Z") }).toISOString() === "2026-11-12T00:00:00.000Z" && analysisAvailableAt({ completedAt: null, createdAt: d("2026-11-11T00:00:00Z") }).toISOString() === "2026-11-11T00:00:00.000Z");
  ok("之后又被批准：按批准时间（批准时可能一并确认了更多要求）；批准在完成之前（不会发生）或没批准：按完成时间", analysisAvailableAt({ completedAt: d("2026-11-12T00:00:00Z"), createdAt: d("2026-11-11T00:00:00Z"), approvedAt: d("2026-11-14T00:00:00Z") }).toISOString() === "2026-11-14T00:00:00.000Z" && analysisAvailableAt({ completedAt: d("2026-11-12T00:00:00Z"), createdAt: d("2026-11-11T00:00:00Z"), approvedAt: d("2026-11-11T12:00:00Z") }).toISOString() === "2026-11-12T00:00:00.000Z" && analysisAvailableAt({ completedAt: d("2026-11-12T00:00:00Z"), createdAt: d("2026-11-11T00:00:00Z"), approvedAt: null }).toISOString() === "2026-11-12T00:00:00.000Z");
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
  ok("取数：与询价单取要求时同一份（最新创建的可用分析）、只看这个组织这个项目；轮次取自已执行的发送卡的创建时间（不是发出时间）；只读", loader.includes('where: { orgId, projectId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },') && loader.includes('orderBy: { createdAt: "desc" },') && loader.includes("select: { completedAt: true, createdAt: true, approvedAt: true },") && read("src/lib/tender-rfq/service.ts").includes('where: { projectId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },\n    orderBy: { createdAt: "desc" },') && loader.includes("return inquiryId ? [{ inquiryId, draftedAt: a.createdAt }] : [];") && !/\.(create|update|upsert|delete)\w*\(/.test(loader) && entry.includes('where: { orgId: input.orgId, projectId: project.id, type: TENDER_SEND_RFQ_TYPE, status: "executed" },'));
  const section = read("src/components/inquiry/project-inquiry-section.tsx");
  ok("询价区：把这一轮的提示交给状态行", section.includes("analysisUpdateNote={ready.analysisUpdateNotes?.[r.id]?.noteZh ?? null}"));
  const line = read("src/components/inquiry/rfq-round-status-line.tsx");
  ok("状态行：有提示才显示", line.includes('{analysisUpdateNote ? (') && line.includes('data-testid="rfq-analysis-update-note"'));
}

console.log("状态行的呈现");
{
  const html = (props: Partial<React.ComponentProps<typeof RfqRoundStatusLine>>) => renderToStaticMarkup(<RfqRoundStatusLine items={[{ status: "quoted" }]} dueDate={null} timeZone={TZ} elapsed={null} autoIngest={{ message: "自动进表" }} {...props} />);
  const withNote = html({ analysisUpdateNote: "这一轮是 2026年11月10日起草的；之后招标分析在 2026年11月12日有了更新" });
  ok("给了提示：显示出来（不论这一轮还在不在等回复）、没有藏起来", withNote.includes('data-testid="rfq-analysis-update-note"') && withNote.includes("2026年11月12日有了更新") && !/data-testid="rfq-analysis-update-note"[^>]*hidden|class="[^"]*hidden[^"]*"[^>]*data-testid="rfq-analysis-update-note"/.test(withNote));
  ok("等待回复时也显示（与自动进表说明并存）", html({ items: [{ status: "sent" }], analysisUpdateNote: "x 提示" }).includes("x 提示") && html({ items: [{ status: "sent" }], analysisUpdateNote: "x 提示" }).includes("自动进表"));
  ok("没有提示（null / 不传）：不渲染", !html({ analysisUpdateNote: null }).includes("rfq-analysis-update-note") && !html({}).includes("rfq-analysis-update-note"));
}

console.log(`\n✓ analysis-update-note: ${passed} 项断言全部通过`);
