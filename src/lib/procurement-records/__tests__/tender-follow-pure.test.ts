/**
 * P2-3a「跟这个标」——能不能跟、项目预填、候选卡片按钮、呈现与接线
 * 运行：npx tsx src/lib/procurement-records/__tests__/tender-follow-pure.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CLOSED_ZH,
  FOLLOWED_LABEL_ZH,
  FOLLOW_LABEL_ZH,
  NOT_SOLICITATION_ZH,
  followButtonState,
  followEligibility,
  projectFieldsFromInstrument,
  type FollowInstrument,
} from "../tender-follow-pure";
import { FollowAction } from "@/components/procurement-records/procurement-monitor";
import { formatActivity } from "@/lib/activity/formatter";
import { AUDIT_ACTION_LABELS } from "@/lib/cockpit/audit-labels";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const NOW = new Date("2026-11-15T15:00:00Z");
const DAY = 86_400_000;
const INST: FollowInstrument = {
  id: "inst1",
  officialNumber: " WS1234567890 ",
  title: "Hospital privacy curtains — supply and install",
  jurisdiction: "CA-FED",
  origin: "SCAN",
  contractingInstitution: "Public Services and Procurement Canada",
  buyingInstitution: "Fixture Health Agency",
  publishedAt: new Date("2026-11-10T12:00:00Z"),
  closingAt: new Date("2026-12-01T19:00:00Z"),
};

console.log("能不能跟");
{
  ok("招标公告、未截标：能跟", followEligibility({ instrumentClass: "SOLICITATION", closingAt: new Date(NOW.getTime() + DAY) }, NOW).ok);
  ok("截标时间未知：能跟", followEligibility({ instrumentClass: "SOLICITATION", closingAt: null }, NOW).ok);
  const closed = followEligibility({ instrumentClass: "SOLICITATION", closingAt: new Date(NOW.getTime() - 1) }, NOW);
  ok("已过截标：409 已截标", !closed.ok && closed.status === 409 && closed.code === "CLOSED" && closed.message === CLOSED_ZH, closed);
  const atClose = followEligibility({ instrumentClass: "SOLICITATION", closingAt: NOW }, NOW);
  ok("正好截标那一刻：不能跟", !atClose.ok && atClose.status === 409);
  for (const cls of ["AWARD_INSTRUMENT", "CALL_UP", "OTHER"]) {
    const r = followEligibility({ instrumentClass: cls, closingAt: null }, NOW);
    ok(`${cls}：400 只有招标公告可以跟`, !r.ok && r.status === 400 && r.code === "NOT_SOLICITATION" && r.message === NOT_SOLICITATION_ZH);
  }
}

console.log("项目预填");
{
  const ev = [
    { sourceType: "TASKBRIEF_SEED", sourceUrl: "https://example.test/seed" },
    { sourceType: "CANADABUYS_TENDER_NOTICES", sourceUrl: " https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/ws1234567890 " },
    { sourceType: "CANADABUYS_TENDER_NOTICES", sourceUrl: "https://canadabuys.canada.ca/old" },
  ];
  const f = projectFieldsFromInstrument(INST, ev);
  ok("名称 = 公告标题", f.name === INST.title);
  ok("招标编号 = 正式编号（去空格）", f.solicitationNumber === "WS1234567890");
  ok("截标日、发布日期照搬", f.closeDate?.getTime() === INST.closingAt!.getTime() && f.publicDate?.getTime() === INST.publishedAt!.getTime());
  ok("采购方 = 购买机构", f.clientOrganization === "Fixture Health Agency");
  ok("来源平台 = CanadaBuys", f.sourcePlatform === "CanadaBuys");
  ok("公告链接 = 最新一条 CanadaBuys 招标公告来源（去空格；不取别的来源）", f.sourceMetadata.noticeUrl === "https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/ws1234567890", f.sourceMetadata);
  ok("来源元数据带公告 id、辖区、来源", f.sourceMetadata.procurementInstrumentId === "inst1" && f.sourceMetadata.jurisdiction === "CA-FED" && f.sourceMetadata.origin === "SCAN");
  const f2 = projectFieldsFromInstrument({ ...INST, title: "  ", buyingInstitution: null }, []);
  ok("没有标题：名称用正式编号", f2.name === "WS1234567890");
  ok("没有购买机构：用采购执行机构", f2.clientOrganization === "Public Services and Procurement Canada");
  ok("没有证据：公告链接为空，来源平台写「采购监控」", f2.sourceMetadata.noticeUrl === null && f2.sourcePlatform === "采购监控");
  const f3 = projectFieldsFromInstrument({ ...INST, origin: "MANUAL" }, [{ sourceType: "MANUAL_LINK", sourceUrl: "https://merx.example/notice/1" }]);
  ok("人工导入：来源平台「人工导入」，链接取那条", f3.sourcePlatform === "人工导入" && f3.sourceMetadata.noticeUrl === "https://merx.example/notice/1");
  ok("人工导入没有证据：也写「人工导入」", projectFieldsFromInstrument({ ...INST, origin: "MANUAL" }, []).sourcePlatform === "人工导入");
  ok("两个机构都没有：采购方为空", projectFieldsFromInstrument({ ...INST, buyingInstitution: " ", contractingInstitution: null }, []).clientOrganization === null);
  ok("名称超长截到 200 字", projectFieldsFromInstrument({ ...INST, title: "x".repeat(300) }, []).name.length === 200);
}

console.log("候选卡片按钮");
{
  const future = new Date(NOW.getTime() + DAY).toISOString();
  ok("招标公告、未截标、没关联：跟这个标", followButtonState({ instrumentClass: "SOLICITATION", closingAt: future, tenderLinks: [] }, NOW).kind === "follow");
  ok("截标未知：跟这个标", followButtonState({ instrumentClass: "SOLICITATION", closingAt: null }, NOW).kind === "follow");
  const fd = followButtonState({ instrumentClass: "SOLICITATION", closingAt: future, tenderLinks: [{ projectId: "p0", relation: "RELATED_HISTORY" }, { projectId: "p9", relation: "CURRENT" }] }, NOW);
  ok("有「本项目」关联：已跟进，指向那个项目", fd.kind === "followed" && fd.projectId === "p9", fd);
  ok("只有历史 / 前序关联：仍可跟", followButtonState({ instrumentClass: "SOLICITATION", closingAt: future, tenderLinks: [{ projectId: "p0", relation: "PREDECESSOR" }] }, NOW).kind === "follow");
  ok("已截标、没关联：不显示", followButtonState({ instrumentClass: "SOLICITATION", closingAt: new Date(NOW.getTime() - DAY).toISOString() }, NOW).kind === "none");
  ok("已截标但跟过：仍显示已跟进", followButtonState({ instrumentClass: "SOLICITATION", closingAt: new Date(NOW.getTime() - DAY).toISOString(), tenderLinks: [{ projectId: "p9", relation: "CURRENT" }] }, NOW).kind === "followed");
  ok("合同：不显示", followButtonState({ instrumentClass: "AWARD_INSTRUMENT", closingAt: null }, NOW).kind === "none");
  ok("截标时间不是日期：当作未知，可跟", followButtonState({ instrumentClass: "SOLICITATION", closingAt: "not-a-date" }, NOW).kind === "follow");
}

console.log("呈现");
{
  const html = (s: Parameters<typeof FollowAction>[0]["state"], busy = false) => renderToStaticMarkup(React.createElement(FollowAction, { state: s, busy, onFollow: () => undefined }));
  const f = html({ kind: "follow" });
  ok("跟这个标：按钮", f.includes(FOLLOW_LABEL_ZH) && f.includes('data-testid="procurement-follow"') && f.includes("<button"));
  const d = html({ kind: "followed", projectId: "proj_9" });
  ok("已跟进：链接到项目", d.includes(FOLLOWED_LABEL_ZH) && d.includes('href="/projects/proj_9"') && !d.includes("<button"));
  ok("不显示：空", html({ kind: "none" }) === "");
  ok("进行中：按钮禁用", /<button[^>]*disabled=""/.test(html({ kind: "follow" }, true)));
}

console.log("接线");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const route = read("src/app/api/procurement/instruments/[id]/follow/route.ts");
  ok("接口：写闸、org_member、按公告行的组织鉴权", route.includes('schemaGate("write")') && route.includes('requireInstrumentAccess(user, id, "org_member")') && route.includes("followTenderNotice({ orgId: a.orgId, user, instrumentId: id })"));
  ok("接口：新建 201、已有 200", route.includes("status: r.created ? 201 : 200"));
  const svc = read("src/lib/procurement-records/tender-follow.ts");
  ok("服务：事务里锁公告行（按组织）", /FOR UPDATE/.test(svc) && svc.includes('WHERE id = ${input.instrumentId} AND "orgId" = ${input.orgId} FOR UPDATE'));
  ok("服务：先查「本项目」关联再建", svc.indexOf('relation: "CURRENT" }') < svc.indexOf("tx.project.create"));
  ok("服务：建项步骤与手工新建相同（成员、两个环境、系统消息、台账闸）", svc.includes('role: "project_admin"') && svc.includes('code: "test"') && svc.includes('code: "prod"') && svc.includes("onProjectCreated(p.id, p.name, user.id, user.name, tx)") && svc.includes("isLedgerProducerActive()"));
  const manual = read("src/app/api/projects/route.ts");
  ok("手工新建也是同样的成员与环境（两处对照）", manual.includes('role: "project_admin"') && manual.includes('code: "test"') && manual.includes('code: "prod"') && manual.includes("onProjectCreated(p.id, p.name, user.id, user.name, tx)"));
  ok("服务：不发外部请求、不调模型", !/fetch\(|createCompletion|openai|anthropic/i.test(svc));
  const view = read("src/lib/procurement-records/tender-follow-pure.ts");
  ok("纯规则文件不引用任何模块（采购监控页在浏览器端引用它）", !/^\s*import\s/m.test(view));
  const ui = read("src/components/procurement-records/procurement-monitor.tsx");
  ok("跟标成功：先重新读取、再给提示（提示不会被重新读取清掉）；失败不重读（保留错误提示）", /if \(!r\.ok\) return;\s*\/\/[^\n]*\n\s*await load\(\);\s*api\.setNote\(\{ tone: "good", text: r\.body\.created \? FOLLOW_CREATED_ZH : FOLLOW_EXISTING_ZH \}\);/.test(ui));
  ok("采购监控候选卡片挂上跟标按钮", ui.includes("<FollowAction state={followButtonState(") && ui.includes("`/api/procurement/instruments/${id}/follow`"));
  const ledger = read("src/lib/project-ledger/__tests__/p1-pure.test.ts");
  ok("台账静态纪律清单包含跟标服务", ledger.includes('"src/lib/procurement-records/tender-follow.ts"'));
}

console.log("活动流文案");
{
  const f = formatActivity({ id: "a1", action: "procurement_instrument.follow_tender", targetType: "procurement_instrument", targetId: "inst1", beforeData: null, afterData: JSON.stringify({ title: "Hospital privacy curtains", projectId: "p1" }), createdAt: new Date(), user: null } as never);
  ok("项目「最近变化」：从采购监控跟进了采购公告「标题」（不露出原始动作名）", f.summary === "从采购监控跟进了采购公告「Hospital privacy curtains」" && !f.summary.includes("procurement_instrument"), f.summary);
  const l = formatActivity({ id: "a2", action: "procurement_instrument.link_tender", targetType: "procurement_instrument", targetId: "inst1", beforeData: null, afterData: JSON.stringify({ relation: "CURRENT" }), createdAt: new Date(), user: null } as never);
  ok("手工关联也有中文", !l.summary.includes("procurement_instrument") && l.summary.startsWith("关联了采购公告"), l.summary);
  ok("驾驶舱动作名", AUDIT_ACTION_LABELS["procurement_instrument.follow_tender"] === "跟进新标");
}

console.log(`\ntender-follow-pure: ${passed} passed`);
