# Proposal: fde-fact-proposals

**TASKFLOW：** B-2（人工修改 → 商务事实沉淀）。状态列在 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase B 表。本分支叠在 B-5（PR #250）之上；B-2 依赖 B-1。
**受影响的 Muse 意图：** `approve` / `reject` 自然覆盖新动作类型；`status` 的待审批计数会包含它（符合任务书预期）。
**已决定（不重开）：**
- D-3：动作类型命名 `revenue_spine.propose_commercial_fact`，审批角色 admin / boss。
- 改稿来源（用户，2026-10-26，选项 b）：对"人工回复作废草稿"（`SUPERSEDED_BY_MANUAL_REPLY`）做草稿 vs 人工回复的 diff。

## Why

F4：草稿最大的质量拖累是"需内部确认"占位。销售每次在外贸收件箱手工回复时，会把 MOQ、周期、港口写进去，这些知识随即丢失。

B-1 之后，审批前不能改稿（`approved_edited` 永远不会出现），所以真正的"人工修改"只发生在：销售看了 FDE 草稿，没有批准，而是自己在外贸收件箱回复了买家。这时草稿被系统作废（`SUPERSEDED_BY_MANUAL_REPLY`），人工回复正文已经落在 Revenue Spine 的外发互动里。

B-2 把这一刻接住：
- 记一条"改稿"反馈事件（补上 B-1 的学习信号）；
- 从人工回复相对草稿新增的内容里规则化抽取商务事实；
- 与企业已配置的值不同（或未配置）时，起一张审批卡，由老板确认后写进商务事实；
- 下一封草稿直接引用。

## What Changes

- **人工回复作废也产反馈事件**（修改 B-1 的反馈能力）：
  - 询盘回复审批被"人工已回复"作废时，产生一条 `replaced_by_manual_reply` 事件：`humanDecision = edited`，用户为发出人工回复的人；
  - diff 为"草稿快照 vs 人工外发正文"，两边都已替换买家信息；
  - 接入点：外贸外发同步作废草稿之后立即记录；`approval-timeout` 的补漏扫描也覆盖这类审批；
  - 其它系统作废（新来信、入驻测试、报价变化）仍不产事件。
- **规则化抽取**（纯函数，不用 LLM）：
  - 输入：人工回复里新增的事实段与签名段行（先去掉引用的历史邮件）；
  - 目标字段只限 `commercialFacts` 既有的 6 个键：`moq`、`sampleLeadTime`、`productionLeadTime`、`loadingPorts`、`signature`、`catalogUrl`；
  - 含价格、币种、折扣、佣金、付款条款或百分比的句子整句跳过，永不起卡；
  - 网址与 WhatsApp 不取买家邮箱同域的值。
- **起卡规则**：对每个抽到的字段，当前值为空或与抽取值不同才起卡（列表字段：有新港口才起卡，提议值为"现有 ∪ 新增"）。以下情况不起卡：
  - 同一字段已有待审批卡；
  - 同一字段 24 小时内已起过卡；
  - 同一（字段，提议值）被驳回过。
- **新审批类型 `revenue_spine.propose_commercial_fact`**：
  - 审批人为组织所有者，有效期 7 天；
  - 载荷含字段、提议值、当前值、证据句（已替换买家信息）、商机 id、来源草稿 id；
  - 只有平台 admin 或 boss 角色能批准，判定在认领之前；无权时审批保持待审批，不会被消耗；
  - 批准 → 执行器把该字段合并进 `revenue_spine.business_profile` 的商务事实，发布新版本，记审计；
  - 驳回 → 同一（字段，提议值）不再起卡。
  - 微信"回数字确认"不处理该类型（只能网页审批）。
- **下一封草稿引用**：
  - 草稿的商务事实读取口径（`factory-knowledge.ts`）不变：批准后 policy 里有了这个值，草稿自然从"需内部确认"变成引用；
  - 端到端测试锁定"先 unavailable → 批准提案 → available"。
- **新增测试**：
  - 抽取表驱动 ≥ 20 例；
  - 起卡规则与限流；
  - 执行器合并与角色门；
  - B-1 记录器的人工回复路径；
  - 接入点静态断言。
  - 全部注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
- 写 `docs/QINGYAN_ORG_COCKPIT_B-2_REPORT.md` 并更新状态列。

**与任务书的偏差（GATE 审核时请逐条确认）：**
1. **触发点**：任务书写"在 B-1 的 `approved_edited` 事件上触发"。现有代码审批前不能改稿，按用户选的 (b) 改为"人工回复作废草稿"事件触发。`approved_edited` 将来出现时走同一路径（实现已兼容）。
2. **写入位置**：任务书写 `Organization.settingsJson.revenue_spine.business_profile.commercialFacts`。实际商务事实存在 `OrgBusinessRule(revenue_spine.business_profile)`，由 `loadRevenueSpinePolicy` 读出，`PUT /api/revenue/policy` 也写这里。执行器走同一个发布函数（新版本、旧版本 superseded、可回滚）。
3. **"复用 approval 的角色门"**：既有 `requiredRole` 列只记录、不执行（R0 发现）。本 change 在执行器的认领前加按类型的角色门，规则与 `PUT /api/revenue/policy` 相同（平台 admin / super_admin / boss）。审批人仍为组织所有者。
4. **限流"一天"**：取滚动 24 小时。
5. **证据**：只存触发该字段的那一句，替换买家信息后存，不存整封回复。
6. **引用历史邮件**：人工回复常带"On … wrote:"引用的买家原信。抽取前先截掉引用部分，避免把买家的网址 / 电话当成我方事实。
7. **archive 顺序**：本 change 修改 B-1 新增的能力 `revenue-spine/fde-draft-feedback`，必须先归档 `fde-feedback-loop`，再归档本 change。

## Capabilities

### New Capabilities
- `revenue-spine/commercial-fact-proposals`：从人工回复中规则化抽取商务事实、起卡规则与限流、审批类型与角色门、批准后写入与草稿引用、不抽价格条款。

### Modified Capabilities
- `revenue-spine/fde-draft-feedback`（B-1 新增，随 `fde-feedback-loop` 归档）：
  - 终态映射增加"人工已回复"；
  - 写入时机与接入点增加外贸外发同步与补漏扫描。

## Impact

- 新文件：
  - `src/lib/revenue-spine/fact-extract.ts`（纯函数抽取）；
  - `src/lib/revenue-spine/fact-proposals.ts`（起卡规则、依赖可注入的起卡器、执行器的合并函数与角色门）；
  - 2 个测试；
  - `docs/QINGYAN_ORG_COCKPIT_B-2_REPORT.md`。
- 改动：
  - `src/lib/revenue-spine/fde/draft-feedback.ts`：人工回复终态、读取外发正文、补漏条件、记录后触发起卡；
  - `src/lib/revenue-spine/fde/draft-diff.ts`：导出"新增行"；
  - `src/lib/trade/outbound-sync.ts`：作废成功后记录反馈；
  - `src/lib/pending-actions/types.ts`、`executor.ts`：新类型、执行器、认领前角色门；
  - `src/lib/ai-grader/actions/wechat-confirm-policy.ts`：新类型只能网页审批；
  - `src/lib/cockpit/posts.ts`：新类型归"询盘销售"岗位；
  - 两个测试脚本。
- 不改：
  - Prisma schema、`vercel.json`；
  - 草稿生成（`reply-draft.ts`、`factory-knowledge.ts`）；
  - 审批中心界面；
  - 外贸外发本身的行为与返回值。
- 不加 LLM 调用。

## Out of scope

- 不抽价格、折扣、佣金、付款条款；不改 `reply-draft.ts` 的"价格永远需内部确认"约束。
- 不做审批时改稿（选项 a）。
- 不从买家来信里抽事实（只看我方人工外发）。
- 不回填历史：只处理本 change 上线后被人工回复作废、且有草稿快照或外发正文的审批。
- 不改 A-4 工作量面板的"改稿"计数口径（它目前标"暂未接入"，另开 change）。
