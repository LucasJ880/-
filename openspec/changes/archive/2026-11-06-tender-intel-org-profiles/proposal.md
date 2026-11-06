# Proposal：「竞争对手」「采购机构」两页接真实授标数据 + 收起「周期采购」（P2-0b）

TASKFLOW：P2-0b（接在 P2-0 后面；依赖 P2-0 的"我方排除"口径）。

## Why

- 情报中枢的「竞争对手」「采购机构」「周期采购」三页只有一行"Phase 1 空状态"，用户点进去没有任何东西。
- 数据其实已经有了：组织级授标事实（AwardRecord）已按中标方 / 买家归集；P2-0 合并后，输掉的标也会留下中标方，我方也已排除。
- 「周期采购」要靠跨项目系列识别，目前没有数据来源，继续挂着只会让人以为功能坏了。

## What Changes

- 新增纯函数 `src/lib/tender-intel/org-profiles.ts`：
  - `buildCompetitorProfiles`：按中标方归集（我方排除并计数），分「已确认」与「线索」，列出它中过标的采购机构与每条授标记录；线索记录不给金额。
  - `buildAgencyProfiles`：按采购机构归集授标事实（中标方列表，我方标「我方」；采购周期复用 `deriveBuyerCycle`）与我方在该机构的招标项目（中标 / 未中标 / 未投 / 取消 / 进行中，最近 5 个）。授标与项目的机构名按同一规范化合并。
- 新增只读接口 `GET /api/org/tender-intel-profiles?orgId=`：授标情报开关关闭时对 AwardRecord 零访问、竞争对手为空、机构只按项目建；项目经 `buildProjectVisibilityWhere` 过滤（只统计当前用户可见的项目）；非本组织成员 403。
- 「竞争对手」「采购机构」两页改为显示上述数据（搜索、展开看授标记录与项目）；去掉"尚未启用"提示。
- 「周期采购」从情报中枢页签与侧栏移除；页面文件保留，路径仍可访问。
- `deriveBuyerCycle` 改为导出（逻辑不变）。

## Capabilities

### New Capabilities
- `tender/org-intel-profiles`：组织级竞争对手与采购机构画像。

### Modified Capabilities
- 无（导航没有对应规格；周期采购入口移除只改注册表与测试）。

受影响的 Muse 意图：无。

## Impact

- 新增：`src/lib/tender-intel/org-profiles.ts`、`src/app/api/org/tender-intel-profiles/route.ts`、`src/components/tender-intel/org-profile-parts.tsx`、两个测试、`docs/acceptance/p2-0b/01–03`。
- 修改：两个页面、`intel-hub-shell.tsx`、`navigation/registry.ts`、`position-nav.test.ts`、`award-intelligence.ts`（只加 export）、测试注册脚本。
- 硬纪律：零 schema、零出站、零 LLM、无新队列、只读；项目查询经可见性过滤层。

## Out of scope

- 疑似重复（NEEDS_REVIEW）的人工裁决界面，以及"同一中标方在同一机构再次中标被判疑似重复"的规则调整（另议，见报告 §3）。
- 跨项目周期采购识别（等招标雷达）。
- 竞争对手的合计金额、市场份额、中标概率。
