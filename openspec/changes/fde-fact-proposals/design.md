# Design

## Context

动机见 proposal.md「Why」，对外行为见两个 spec 增量。决定做法的现状：

1. **人工回复作废**：
   - 外贸侧真实外发后，`trade/outbound-sync.ts` 先经 `logRevenueInteraction` 写一条外发互动（`CustomerInteraction.content` 是人工回复正文）；
   - 再经 `supersedePendingAction` 把同商机所有待审批的询盘回复草稿作废：`status = failed`，`failureReason` 形如 `SUPERSEDED_BY_MANUAL_REPLY tradeMessageId=… outboundInteractionId=… triggeredBy=<userId> terminationMode=system_superseded`。
   - 调用方有收件箱回复（发送 / 标记已发）、线索手工外发、通道消息、开发信（发送 / 标记）；开发信是模板外发，不是对询盘的回复。
2. **B-1 记录器**（`fde/draft-feedback.ts`）：
   - 终态经 `cockpit/workload.ts` 的 `pendingActionOutcome` 判定，系统作废目前不产事件；
   - 快照取自草稿创建时的审计（已替换买家信息）；
   - 记录在按审批的 advisory lock 内先查后写；
   - 补漏扫描挂在 `approval-timeout`。
3. **diff**：`draft-diff.ts` 已按段落分类（问候 / 事实 / 追问 / 签名）做行级多重集差，并有数值捕获 `captureNumbers`（只认数量 / 时长 / 规格单位，排除币种前缀），但没有导出"新增行"。
4. **商务事实**：
   - 存在 `OrgBusinessRule(revenue_spine.business_profile)`，`loadRevenueSpinePolicy` 合并后在 `policy.businessProfile.commercialFacts`；
   - `mergeBusinessProfile` → `mergeCommercialFacts` 按字段覆盖并校验形状（数量须为正整数、区间须 max ≥ min 等，不合法的丢弃）；
   - `PUT /api/revenue/policy` 用 `publishRevenueSpineRule` 发布新版本；
   - `factory-knowledge.ts` 的 `getMOQ` / `getLeadTime` 等读它，未配置时草稿写"需内部确认"。
5. **审批**：
   - `requestApproval` 建 `PendingAction`（`approverUserId`、`ttlHours`、`idempotencyKey`）；
   - 执行器 `executePendingAction` 先 `canDecideTeamApproval`（超管 / 指定审批人 / 组织所有者 / org_admin / 项目负责人），再 CAS 认领并按类型分派；
   - `requiredRole` 只记录不执行；
   - 新类型须进 `PendingActionType` 联合，`WECHAT_CONFIRM_POLICY` 是 `Record<PendingActionType, …>`，tsc 会强制给出分类。
6. **岗位视图**：`cockpit/posts.ts` 每个岗位声明认领的审批类型（A-1）。

## Goals / Non-Goals

**Goals:**
- 抽取、起卡判定、执行器合并都是纯函数，可表驱动测。
- B-1 记录器只多一个终态分支与一个"记录后"回调，原有四种终态行为逐字段不变。
- 外贸外发同步的返回值不变；作废成功后多一步同步记录事件与起卡（几次查询 + 建审批），回复接口略慢。记录走尽力而为，失败吞掉。

**Non-Goals:**
- 不改以下文件：
  - `reply-draft.ts`、`factory-knowledge.ts`、`scoring.ts`；
  - 审批中心与收件箱界面；
  - `supersede.ts`、`approval/request.ts`；
  - Prisma schema、`vercel.json`。
- 不改 A-4 工作量面板的改稿计数。
- 不从买家来信抽事实，不抽价格条款。

## Decisions

### D1 人工回复作废走 B-1 记录器，新增一个终态
- `feedbackTerminal` 在判定之前先看：`status = failed` 且 `failureReason` 以 `SUPERSEDED_BY_MANUAL_REPLY` 开头 → `manual_reply`。
  - 对应 `feedbackType = replaced_by_manual_reply`，`humanDecision = edited`。
- `failureReason` 解析出 `outboundInteractionId` 与 `triggeredBy`：
  - 新依赖 `loadManualReply(orgId, interactionId)` 读 `CustomerInteraction.content`（按组织、方向 outbound）。
  - 有快照与正文时 diff 为 `buildDraftDiff(快照, maskBuyerPii(正文))`；缺一则空 diff 并注明。
  - userId 取 `triggeredBy`（存在时）。
- 接入：
  - `outbound-sync.ts` 作废之后，对成功作废的 id 逐个 `recordInquiryReplyFeedbackSafe`（动态导入，异常吞掉）；
  - 补漏条件 `feedbackSweepWhere` 增加一支 `status = failed AND failureReason startsWith SUPERSEDED_BY_MANUAL_REPLY`。
- 理由：
  - 复用同一把锁、同一幂等键（审批 id + 终态）、同一补漏；
  - 用户选的 (b) 本质就是"另一种终态"。
- **否决**：
  - 在 `outbound-sync.ts` 里直接写事件：绕开锁与幂等，补漏也要另写一套。
  - 把人工回复正文存进 `failureReason`：会把正文写进审批表，且长度不可控。

### D2 起卡挂在"记录之后"，只对改稿类事件
- `FeedbackDeps` 新增可选 `afterRecorded(ctx)`，在锁外、`createFeedback` 成功之后调用；仅当 `feedbackType ∈ { approved_edited, replaced_by_manual_reply }` 且有外发正文时调用。
- 默认实现动态导入 `fact-proposals.ts` 的 `proposeCommercialFactsSafe`。
- 传入：
  - 组织、商机、来源审批 id；
  - 快照正文（可空）、已替换买家信息的外发正文；
  - 买家信息（用于排除买家域名与再次替换证据句）。
- 理由：
  - 事件写入与起卡解耦，起卡失败不影响事件；
  - 补漏扫描补上漏记的事件时，起卡也一并补上。
- **否决**：
  - 起卡放进锁内：起卡要多次查询并建审批，拉长锁时间。
  - 单独的定时任务：违反硬纪律 3。

### D3 抽取：先截引用，再取新增的事实段 / 签名段行，逐字段规则
- **截引用** `stripQuotedReply`：遇到以下任一行即截断其后全部内容：
  - 以 `>` 开头；
  - `On … wrote:`；
  - `-----Original Message-----`；
  - `From:` / `发件人：` / `发件人:` 开头的邮件头；
  - `在 … 写道：`。
- **新增行**：`draft-diff.ts` 导出 `addedLines(original, sent)`（复用多重集差），返回带段落类型的行。没有快照时取外发正文的全部行。
- **价格过滤** `isPriceLine`：命中以下任一即整句跳过：
  - 币种符号或代码（`$ US$ USD ¥ RMB CNY EUR € £ GBP`）；
  - 价格类词（`price / pricing / quote(d) price / unit price / cost / discount / rebate / commission / payment / T/T / L/C / 报价 / 价格 / 单价 / 折扣 / 返点 / 佣金 / 付款 / 账期`）；
  - 百分号。
- **逐字段规则**（只看非价格行）：

| 字段 | 触发词 | 取值规则 |
|---|---|---|
| `moq` | `MOQ / minimum order (quantity) / 起订量 / 最小起订` | 用 `captureNumbers` 取第一个件数类单位的数，per 取 color / style / design / size 或 每色 / 每款 |
| `sampleLeadTime` | `sample / 样品 / 打样` + 天数或区间 | 句中有 `stock / ready / existing / 现货` → 现货天数；否则 → 定制样区间 |
| `productionLeadTime` | `production / lead time / bulk / mass production / delivery / 大货 / 生产周期 / 交期` + 天数区间，周换算 ×7 | 起算点识别 `PP sample / pre-production sample / 产前样 / 大货样`、`deposit / 定金`、`order confirmation / 确认订单`，否则用默认起算点 |
| `loadingPorts` | `port / loading port / ship from / FOB / 装运港 / 港口` | 匹配固定中国主要港口词表（中英） |
| `catalogUrl` | `catalog / catalogue / brochure / 目录 / 产品册` | 同句的 URL |
| `signature` | 只看签名段 | `WhatsApp` 号码、网站 URL、职位行（`manager / director / executive / representative / specialist / coordinator / 经理 / 总监 / 主管 / 专员`，无数字、≤ 60 字） |

- 买家排除：网址与 WhatsApp 不取买家邮箱同域或与买家邮箱 / 电话相同的值。
- 理由：
  - 确定性、可表驱动测；
  - 只看新增行，人工回复里照抄草稿的已配置事实不会重复起卡；
  - 截引用防止把买家的网址 / 电话当成我方事实。
- **否决**：
  - 用 LLM 抽取：违反硬纪律 7 与任务书。
  - 只看事实段：落款信息只在签名段。

### D4 起卡判定是纯函数，依赖可注入
- `planFactProposals({ extracted, current, pendingFields, recentFields, rejectedKeys })` → 待起卡列表。规则：
  - 每字段取第一个抽取值；
  - 规范键 `valueKey` 用于比较与驳回去重；
  - 回复里没写的部分先用当前值补齐再比较（`proposedValueFor`）：起订量的"按什么计"、大货起算点、样品的现货 / 定制两组各自合并；
  - 列表字段算并集，无新增不起；
  - 签名只补当前为空的子字段：落款全组织共用，每个销售的 WhatsApp 不同，已配置的不来回改；
  - 提议值过不了 `mergeCommercialFacts`（如非 https 目录链接、数量 0）不起卡，记 `invalid`。
- `proposeCommercialFacts(input, deps)` 的依赖：
  - `loadCurrentFacts`；
  - `pendingFields`（待审批且未过期的同类型卡）；
  - `recentFields`（24 小时内建过的）；
  - `rejectedKeys`（驳回过的字段 + 规范键）；
  - `approverCandidates`（所有者与在职成员及其平台角色）→ `pickFactApprover`：所有者能批时给所有者，否则在职 boss，再否则在职 admin，同类按入职先后；没有合格的人不起卡（`no_approver`）；
  - `createApproval`（`requestApproval` 封装）。
- 卡片：
  - `risk = { vocabulary: "agent-core.tool-risk", value: "l2_soft", requiresApproval: true }`；
  - `ttlHours = 168`；
  - `idempotencyKey = revenue-spine:fact:{field}:{valueKey}:{来源审批 id}`；
  - 审批人按上面的规则挑选，`requiredRole = "boss"` 照记；
  - 载荷同时存抽取原值（`extractedValue`）与起卡时的提议值（卡片展示）；
  - 证据句再经 `maskBuyerPii`（不保留收件人邮箱），截 300 字；落款的证据句取第一个抽到子字段的那一行。
- **否决**：
  - 按天写死"自然日"：时区不一，滚动 24 小时更简单。
  - 每次抽到都起卡、靠审批人去重：卡片会刷屏。

### D5 新审批类型与认领前角色门
- 注册：
  - `PendingActionType` 加 `revenue_spine.propose_commercial_fact`；
  - `WECHAT_CONFIRM_POLICY` 给 `web_only_review`；
  - `cockpit/posts.ts` 的 `inbound_sales` 岗位认领该类型。
- 角色门：执行器在 `canDecideTeamApproval` 之后、CAS 认领之前，对 `requiresPlatformApproverRole(type)` 的类型按 `ctx.userId` 读 `User.role`，再判 `approverRoleDenial(type, platformRole)`。该类型要求 `isAdmin(role) || role === "boss"`，否则返回 `{ ok: false, error: "仅企业负责人或管理员可批准商务事实提案" }`，不改状态。
- 不用 `ctx.role`：审批中心传进执行器的是组织成员角色（`org_owner` / `org_admin` / `org_member`），助手收件箱传的是平台角色，口径不统一。
- 理由：
  - 认领后才失败会把卡变成 `failed`，等于替人驳回；
  - 规则与 `PUT /api/revenue/policy` 一致，同一类人能改 policy、能批提案。
- **否决**：
  - 让 `requiredRole` 全局生效：影响所有既有类型，超出本 change。
  - 只在界面隐藏按钮：Muse / 收件箱 / 微信仍可批准。

### D6 执行器：合并、校验、发布、审计
- 执行步骤：
  1. 校验组织、平台角色（按 userId 读）与成员身份（同其它执行器）；
  2. 读 `loadRevenueSpinePolicy`，在**批准时的最新**商务事实上用 `proposedValueFor` 重新合并抽取原值：起卡后老板经 `PUT` 改过的港口 / 落款不会被起卡时算好的值覆盖；已是该值时返回成功、不发布（`business_profile:unchanged`）；
  3. 用 `applyCommercialFact(profile, field, value)` 得到合并后的业务画像，校验 `merged.commercialFacts[field]` 与该值规范键一致，不一致视为被合并规则丢弃，返回失败；
  4. 经 `publishRevenueSpineRule(business_profile)` 发布新版本；
  5. 写审计 `revenue_spine.commercial_fact.applied`（字段、前后规范键、版本、来源审批 id、商机 id）。
- `resultRef = business_profile:v{版本}`。
- 理由：与 `PUT /api/revenue/policy` 同一写入口，版本可回滚，草稿读取口径不变。
- **否决**：
  - 直接改 `configJson`：绕开版本。
  - 写 `settingsJson`：草稿不读那里。

## 与八条硬纪律的关系

1. **零 schema**：新动作类型是代码里的联合成员，不是 schema。事实写既有 `OrgBusinessRule`，事件写既有 `HumanFeedbackEvent`，审计写既有 `AuditLog`。
2. **出站先审批**：本 change 不产生任何外发。写商务事实本身也先建审批，批准后才写。
3. **禁止第三套队列**：不新增 cron / 队列。补漏复用 `approval-timeout`，起卡在既有调用链里同步完成。
4. **脱敏**：不抽、不存价格与条款。证据句与事件不含买家个人信息与金额；不涉及毛利 / 估值 / 我方报价。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及（只读已镜像的外发互动正文，不碰邮箱设置）。
7. **确定性优先**：抽取与起卡全部是规则，无 LLM；偏好记忆不存金额（事件只含结构化 diff）。
8. **测试注册**：两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；B-1 测试同步扩充。

## Risks / Trade-offs

- **[销售不看草稿、从零写回复]**：diff 会把整封回复都当新增。
  → 事实只在与配置不同时才起卡，审批人看证据句再决定；这正是 (b) 选项的取舍。
- **[规则漏抽 / 误抽]**：
  → 宁漏不误：价格句整句跳过、只认词表内港口、只看新增行；
  → 误抽只会起一张卡，驳回后不再起。
- **[引用格式五花八门]**：截引用规则覆盖常见邮件客户端格式。漏截时，买家同域网址与买家电话仍会被排除。
- **[审批人不是 boss]**：所有者平台角色不是 boss / admin 时，卡片改发在职的 boss / admin；组织里一个都没有时不起卡。
- **[外发正文不全是手写]**：外贸收件箱的回复正文常是收件箱 LLM 草稿被采用后发出；已由销售确认并外发，起卡仍需老板批准。线索页手工留痕不抽（常记买家的数字）。
- **[并发]**：两封人工回复几乎同时到，可能为同一字段各起一张卡；两张卡同时批准时读取与发布不在同一事务，后批的可能撞版本号唯一约束而失败。频率低，不加锁，报告列为已知限制。
- **[补漏窗口]**：沿用 B-1 的 7 天窗口，上线后第一次扫描会处理上线前 7 天内的人工回复作废。
- **[archive 顺序]**：修改 B-1 的能力，须先归档 `fde-feedback-loop`。

## 验证方式

| 验证项 | 命令或做法 | 期望结果 |
|---|---|---|
| 抽取 | `npx tsx src/lib/revenue-spine/__tests__/fact-extract.test.ts` | ≥ 20 例表驱动，覆盖每个字段、中英混排、价格与付款句、引用截断、买家域名排除 |
| 起卡与执行 | `npx tsx src/lib/revenue-spine/__tests__/fact-proposals.test.ts` | 断言全部通过（见下） |
| B-1 回归与扩充 | `npx tsx src/lib/revenue-spine/fde/__tests__/draft-feedback.test.ts` | 原有断言全过，新增人工回复终态 / userId / diff / 补漏条件 / 外发同步接入点 / 记录后起卡 |
| 门禁 | `npm test`（与基线比较）、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate fde-fact-proposals --strict` | 全部通过（注册校验除 base 既有的 2 个 trade 欠账） |
| 改动范围 | `git diff --stat` | 无 `prisma/`、`vercel.json` |

`fact-proposals.test.ts` 覆盖的断言：
- 起卡规则：空 / 冲突 / 相同、列表并集、签名合并、驳回去重、待审批与 24 小时限流、每字段一张；
- 卡片内容与脱敏；
- 角色门：sales 被拒、状态不变；
- 微信白名单不含该类型；
- 执行器合并、非法值失败；
- `getMOQ` 先 unavailable → 批准合并 → available；
- 岗位认领。

## Migration Plan

部署即生效，无数据迁移。只有上线后被人工回复作废的草稿会产事件与起卡。

回滚：撤销 PR。已发布的商务事实版本可经 `PUT /api/revenue/policy` 改回；遗留的待审批卡可驳回或等过期（7 天）。
