# Proposal: org-cockpit-workload

**TASKFLOW：** A-4（工作量 / 无用功面板）。状态列在 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase A 表。依赖 A-2 `org-cockpit-read-model` 的归属规则与 A-3 `org-cockpit-home` 的首页，本分支叠在 A-3（PR #246）之上。
**受影响的 Muse 意图：** 无。

## Why

岗位卡片只说明"在不在干活"，说明不了"干的活有没有用"：AI 跑了多少次、提了多少待审批、几成被驳回或放到过期、花了多少钱，今天没有一处按岗位看得到。A-4 把这些按岗位 × 天汇总成一屏，并用固定规则标出疑似无用功，作为 Phase B 优化 FDE 的度量底座。

## What Changes

- 新增按岗位 × 组织本地日（默认 14 天）的工作量汇总。每格统计：
  - 本组织 AI 运行数，以及平台级自动化运行数（单独标注）；
  - 新提出的待审批动作数；
  - 待审批动作的结局：批准、驳回、过期、取消、被系统作废、系统失败，另记批准后执行失败；
  - 护栏拦截数；
  - AI 用量（token）与成本。
- 新增四条"疑似无用功"规则，基于近 7 天数据，命中时给出一句中文原因：
  - 驳回率超过阈值；
  - 过期率超过阈值；
  - 有 AI 运行但没有提出任何待审批（空转）；
  - 每次批准的成本超过各岗位中位数的若干倍。
  - 阈值默认值写在代码里，组织可在 `Organization.settingsJson.cockpit.workloadThresholds` 覆盖；逐项校验，非法值回退默认。
- 询盘销售的口径与 `src/lib/revenue-spine/sla-metrics.ts` 一致：
  - 入驻测试询盘不计；
  - 展会速记卡单列一行"询盘销售 · 展会"。
- 新增只读接口 `GET /api/cockpit/workload`：管理层可见，与 `/api/cockpit/posts` 同一套组织解析与权限判定；只做读查询，不写任何表。
- 首页在岗位卡片与 company.log 之间新增"工作量"区块：
  - 默认收起，用户点击"查看近 14 天工作量"后才请求，首屏仍只有两个请求；
  - 每个岗位一行：近 7 天各项合计 + 14 天走势小图；
  - 命中规则的行标红并显示原因。
- 新增测试：工作量汇总（纯函数，表驱动 ≥ 15 例）、读模型与接口、区块渲染，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
- 写 `docs/QINGYAN_ORG_COCKPIT_A-4_REPORT.md` 并更新状态列。

**与任务书的偏差（GATE 审核时请逐条确认）：**
1. **`edited`（改过再批）暂无数据**：PendingAction 没有任何编辑痕迹（无改稿字段，审批接口只收 decision + reason）。任务书 B-1 写明"A-4 的 edited / approved 区分从这里取"。本 change 把 `edited` 显示为"未接入（B-1 后可用）"，批准数不拆分。
2. **`auto_executed` 不存在**：代码里所有执行都经过人工批准（报价路由的直接执行也记录批准人），没有自动执行路径。面板不显示这一项，并注明原因。
3. **过期、取消、作废的判定**：
   - 过期 = `status: "failed"` 且 `failureReason: "已过期"`（定时任务 `approval-timeout` 与执行器的懒过期写入），不计入驳回；
   - 取消 = 人工取消，或关联任务被取消；
   - 被系统作废 = 人工已另行回复、或客户又来信，或报价改了使旧审批作废。入驻测试作废的动作属于测试，整条不计；
   - 批准后执行失败计为批准，另记一项"执行失败"；批量准备失败虽带决策人，但从未被批准，计为系统失败。
4. **成本大部分岗位"未入账"**：
   - `AiUsageLedger` 没有 runType，只能经 `runId → AgentRun` 归岗位；产品内容类用量（`sourceType = PRODUCT_CONTENT`）归"内容"岗位。
   - 用量账本只在请求上下文带组织时写入（目前只有对话类接口）。FDE 与各定时任务的 AI 调用目前不入账，对应岗位显示"未入账"；对话用量计入"未归属"。
   - "每次批准成本"规则只在至少 3 个岗位有值时判定，现阶段基本不会触发。
5. **平台级自动化不参与规则**：`AutomationRun.orgId` 恒为空（A-2 已知），只作参考列显示并标"平台级"。空转规则只看本组织 AI 运行，且只判能收到待审批动作的岗位（客服、运维与知识、内容按归属规则收不到，不判）。
6. **规则加最小样本**：驳回率、过期率在近 7 天已决策数 ≥ 4（可配置）时才判定，避免一条驳回就标红。
7. **GATE-A2 对账口径改写**：`/ai-activity` 不显示任何运行计数——它按当前用户分页读审计日志。改为：
   - 面板近 7 天"AI 运行"与岗位卡片上的"7 天 AI x 次"同口径（同一套查询条件，测试断言）；
   - staging 再与 `AgentRun` 直接计数人工对账。
8. **首页按需加载**：任务书只写"页面区块"。为守住 A-3"首屏 ≤ 2 个 API 请求"，区块默认收起、点击才请求。A-3 的 spec 已同步改为"首屏之外由用户点击展开的区块只在点击后请求"（PR #246）。
9. **按组织本地日分桶**：时区取 `settingsJson.timezone`（缺省 America/Toronto，与既有定时任务一致）。14 天 = 含今天在内的 14 个本地日。

## Capabilities

### New Capabilities
- `cockpit/workload`：按岗位 × 天的工作量汇总、疑似无用功规则与阈值覆盖、询盘销售口径、只读接口、首页工作量区块的展示与加载方式。

### Modified Capabilities
（无。A-3 的 `cockpit/home-view` 尚未归档，措辞调整已在 A-3 自己的 change 里完成。）

## Impact

- 新文件：
  - `src/lib/cockpit/workload.ts`：纯函数，分天、结局判定、归属、汇总、规则、阈值解析；
  - `src/lib/cockpit/workload-read-model.ts`：只读查询与装配；
  - `src/app/api/cockpit/workload/route.ts`；
  - `src/components/cockpit/org-cockpit-workload.tsx`：区块，含点击加载；
  - 3 个测试；
  - `docs/QINGYAN_ORG_COCKPIT_A-4_REPORT.md`。
- 改动：
  - `src/components/cockpit/org-cockpit-view.tsx`：在卡片与时间线之间留一个区块插槽；
  - `src/components/cockpit/org-cockpit-home.tsx`：把工作量区块放进插槽；
  - 两个测试脚本各追加 3 条。
- 不改 Prisma schema、不改 `vercel.json`、不新增定时任务、不新增 LLM 调用。

## Out of scope

- 不做成本预测，不补记账（不改 `AiUsageLedger` 的写入方，FDE / 定时任务未入账的问题另开 change）。
- 不自动关停任何自动化或岗位，标红只是信号；不提供任何改变数据的操作入口。
- 不提供阈值的编辑界面（只读 `settingsJson`）。
- 不做 `edited` 的识别（B-1 `fde-feedback-loop`）。
- 不改 A-1 注册表、A-2 两个接口的响应形状、A-3 的岗位卡片。
