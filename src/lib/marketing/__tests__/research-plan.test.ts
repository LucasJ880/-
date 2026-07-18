import assert from "node:assert/strict";
import { buildResearchPlanDraft } from "../research-plan";
import { canDecideTeamApprovalFromSnapshot } from "../team";

const report = `
## 证据与判断
Google 搜索和 CRM 显示 North York 的智能窗帘询盘正在增长。

## 优先机会（最多3个）
1. 建立 North York 智能斑马帘落地页
2. 用安装前后对比内容获取预约
3. 对高意向线索建立 5 分钟响应机制

## 第一个增长实验
### 测试 Google 高意图关键词与两版落地页
以有效线索率为主指标。
`;

const items = buildResearchPlanDraft(report, "验证 North York 智能斑马帘获客");
assert.equal(items.length, 4);
assert.equal(items[0].dayOffset, 3);
assert.match(items[0].title, /North York/);
assert.equal(items[3].category, "experiment");
assert.match(items[3].title, /Google/);
assert.ok(items.every((item) => item.stopCondition && item.successMetric));

const fallback = buildResearchPlanDraft("## 决策结论\n先小规模验证。", "测试新渠道");
assert.equal(fallback.length, 1);
assert.equal(fallback[0].category, "experiment");

const noAccess = {
  isSuperAdmin: false,
  isOrgOwner: false,
  isOrgAdmin: false,
  isProjectOwner: false,
  isProjectAdmin: false,
};
assert.equal(canDecideTeamApprovalFromSnapshot({
  createdById: "member",
  orgId: null,
  projectId: null,
  approverUserId: null,
}, { userId: "member" }, noAccess), true, "旧个人草稿仍可由本人处理");

assert.equal(canDecideTeamApprovalFromSnapshot({
  createdById: "member",
  orgId: "org-a",
  projectId: "project-a",
  approverUserId: "leader",
}, { userId: "member", orgId: "org-a" }, noAccess), false, "组员不能批准自己提交的团队计划");

assert.equal(canDecideTeamApprovalFromSnapshot({
  createdById: "member",
  orgId: "org-a",
  projectId: "project-a",
  approverUserId: "leader",
}, { userId: "leader", orgId: "org-b" }, noAccess), false, "指定 Leader 也不能跨组织批准");

assert.equal(canDecideTeamApprovalFromSnapshot({
  createdById: "member",
  orgId: "org-a",
  projectId: "project-a",
  approverUserId: "leader",
}, { userId: "org-admin", orgId: "org-a" }, { ...noAccess, isOrgAdmin: true }), true, "同组织管理员可以代审批");

console.log("research-plan tests passed");
