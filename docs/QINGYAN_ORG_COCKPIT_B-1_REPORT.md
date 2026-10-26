# B-1 完成报告：审批动作自动产反馈事件 + 草稿结构化 diff（openspec change `fde-feedback-loop`）

任务书：`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` §B-1
分支：`claude/fde-feedback-loop`（叠在 A-4 `claude/org-cockpit-workload` 之上；PR base = A-4 分支，依次合并后改回 `main`）
OpenSpec change：`openspec/changes/fde-feedback-loop/`（proposal / `specs/revenue-spine/fde-draft-feedback/spec.md` / design / tasks，`openspec validate --strict` 通过）

---

## 1. 做了什么

| 文件 | 内容 |
|---|---|
| `src/lib/revenue-spine/fde/draft-diff.ts`（新） | 纯函数：<br>- 正文归一，与执行器一致：trim + 截断 10k；<br>- 段落分类：问候 / 事实段 / 追问段 / 签名；<br>- 行级 diff：改动段落类型、改动占比；<br>- 事实段新增行里带单位的数值捕获，不含货币与百分比；<br>- `maskBuyerPii`：买家联系人名、公司名、电话、非收件人邮箱换成占位符 |
| `src/lib/revenue-spine/fde/draft-feedback.ts`（新） | 草稿快照的构造与写入；终态映射（复用 `cockpit/workload.ts` 的同一张结局规则表）；记录器（依赖可注入，锁内先查后写）；尽力而为包装；补漏扫描 |
| `src/lib/employee-ai/feedback-service.ts`（改） | 新增两个可选参数：`systemRecorded`（系统记录的驳回可以无原因）、`diffSummary`（直接写入给定的结构化 diff）。缺省行为不变 |
| `src/lib/revenue-spine/fde/inbound-sales.ts`、`no-reply-followup.ts`（改） | 询盘回复审批新建成功（首封非复用 / 跟进）后写脱敏快照，尽力而为 |
| `src/lib/approval/port.ts`（改） | 记录器在三处调用，非询盘回复类型不加载模块：<br>- 批准：执行前后状态确实变化时；<br>- 驳回：生效时；<br>- 过期：本轮赢家，放在 workforce run 收敛之后 |
| `src/app/api/cron/approval-timeout/route.ts`（改） | 过期之后跑补漏扫描，尽力而为，结果写进任务返回 |
| 测试（新，均已注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`） | `draft-diff.test.ts` 53 条、`draft-feedback.test.ts` 72 条 |

### 事件长什么样

`HumanFeedbackEvent` 各字段取值：
- `taskType = "fde_email_reply"`，`skillSlug = "inbound_sales_fde"`，`workerType = "fde"`，`feedbackScope = "team_candidate"`，`pendingActionId` 为该审批；
- `humanDecision`：approved_as_is → accepted，approved_edited → edited，rejected → rejected，expired → deferred；
- `aiOutputRef = { type: "pending_action", id, terminal, feedbackType, opportunityId, followUpStep, agentRunId }`；
- `diffSummary`：结构化 diff，只有结构信息与带单位的数字；
- `reasonText`：驳回备注原样带入，买家信息与所有邮箱换成占位；没有备注时为空；
- 不存正文、主题、`aiOutputSnapshot`、`humanEditedOutput`；
- 不传 `agentRunId` 列，所以不会触发 autopilot 观察。

快照审计：`action = "revenue_spine.inquiry_reply.draft_snapshot"`，`targetType = "pending_action"`。内容包括：
- 主题、正文：买家信息已替换，只保留收件人邮箱；
- `bodyHash`：替换前归一正文的哈希；
- 护栏结果、引用事实、待内部确认项、是否模板、第几次跟进。

## 2. 怎么验的

| # | 验证 | 结果 |
|---|---|---|
| 1 | 两个新测试单独运行 | draft-diff 53/53、draft-feedback 72/72；`employee-ai` 既有 3 个测试 18 / 4 / 4 全过 |
| 2 | 任务书验收 2：StructuredDiff 单测 | 全文照发 → 未改过；改签名 → 只有签名；加一句 MOQ → 只有事实段并捕获 `500 pcs per color` |
| 3 | 任务书验收 1：同一审批同一终态只产一条 | 先查后写 + 锁；两路同时到达的模拟只产一条；补漏跳过已有事件的 |
| 4 | 任务书验收 3：不含买家邮箱以外的个人信息 | 快照与四类事件序列化后不含联系人、公司、电话、正文句子；事件连收件人邮箱也不含 |
| 5 | 任务书验收 4：手工入口不变 | 不带系统记录标记、驳回无原因仍报原错误；`/api/agent-feedback` 不传新参数 |
| 6 | 接入点静态断言 | 端口：恰好一处、在重复 / 已终态分支之后、带状态变化 / 生效条件、包在异常保护里；两处创建点非复用分支写快照；定时任务在过期之后补漏；`vercel.json` 仍 23 条 cron |
| 7 | 局部 `tsc`（`revenue-spine/fde/**`、`employee-ai/**`、`approval/**`、定时任务路由） | 0 错误 |
| 8 | `npm run typecheck`（全量） | 退出 0 |
| 9 | `npm run lint:baseline` | PASS（无新增 error）；改动文件 0 问题 |
| 10 | `npm test` 对比 `origin/main` 基线 | 基线 411/425 → 本分支 424/438：新增 13 项即 A-1 ~ A-4（11）+ B-1（2）的测试，全 PASS；`Employee AI` 既有 5 项仍 PASS；14 项失败清单与基线逐条一致 |
| 11 | `npm run test:ci` | `CI unit subset PASS`，含两个 B-1 测试 |
| 12 | `git diff --stat origin/main -- prisma/ vercel.json` | 空 |
| 13 | `openspec validate fde-feedback-loop --strict`；`/opsx:verify` | valid；`/opsx:verify`：tasks 6/6，8 条 requirement / 20 个 scenario 均有测试断言，design D1–D7 与实现一致，无 CRITICAL / WARNING |

## 3. 与任务书的偏差（请 GATE 逐条确认，详见 proposal）

1. **【GATE 决策项，阻塞 B-2】"改过再批"在现有代码里不会发生**：
   - 询盘回复审批的载荷创建后不可改：`payloadVersion` 恒为 1，审批中心校验 `payloadHash`；
   - 批准接口只收"批准 / 驳回 + 备注"，执行器发送的就是载荷正文；
   - 所以 `approved_edited` 目前不会出现。diff 已就绪，接入改稿来源后自动生效。
   - B-2 以 `approved_edited` 为触发，需要先决定改稿来源：
     - (a) 审批时允许改稿（改审批接口与执行器，任务书 B-1 写了不改）；
     - (b) 对"人工回复作废草稿"（`SUPERSEDED_BY_MANUAL_REPLY`，证据里有 Trade 消息 / 外发互动 id）做草稿 vs 人工回复的 diff（任务书 B-1 写了不做）；
     - (c) B-2 暂缓。
2. **终态映射到既有字段**：
   - `humanDecision` 只有 5 个取值，过期映射为 `deferred`；
   - 任务书的四种 feedbackType 写在 `aiOutputRef`；
   - `employeeKey` 写入 `skillSlug`；
   - `scope = team` 对应 `team_candidate`。
3. **过期事件的 userId**：表上必填，过期没有决策人，取审批人，再取创建人。人工取消、系统作废不在任务书的四种终态里，不产事件。
4. **驳回原因**：原样取审批备注，只替换买家信息；不猜原因代码。
5. **补漏挂在既有 `approval-timeout` 定时任务里**，不新增 cron；同一终态只产一条靠"写入时机基本不重叠 + 锁内先查后写"。
6. **入驻测试询盘不产学习事件**：与 SLA 指标、工作量面板同一判定。
7. **【GATE 注意项】下游读者口径会变**：
   - `metrics.ts` 的团队采纳率（岗位视图"运维与知识"KPI）开始包含 FDE 草稿结局；
   - `preference-learner` 只读每人最近 40 条事件，审批人的系统事件会占据这个窗口。
   - 本 change 不改读者。建议后续在读者侧按 `humanDecision` / `skillSlug` 过滤。

## 4. 交叉审查（独立审查代理，只给代码与规格）

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| B1 | 阻塞 | `AuditLog.afterData` 是 `String?`，审计写入时 `JSON.stringify`，快照读回时按对象解析永远失败，所有批准都会记成"无快照"。测试注入的是对象，所以没测出来 | 读回时解析 JSON 字符串；加往返测试 |
| S1 | 应修 | 入驻测试询盘的草稿（执行器拒发、带决策人）会被记成照发批准，驳回 / 过期也会记 | 记录器取买家信息时按 SLA 指标同一判定跳过 |
| S2 | 应修 | `taskType = "inquiry_reply"` 对不上 practice-miner / preference-learner 的邮件类规则（F5 仍不通）；系统事件会挤占学习器窗口、改变采纳率口径 | 改为 `fde_email_reply`，测试对照两个学习器的正则；读者口径变化列为 GATE 注意项（偏差 7） |
| S3 | 应修 | 钩子在"不是 B2 重复"时就触发：无权 / 隔离 / 跨组织错误也会调；批准时才发现过期与定时任务过期可能各记一次；定时任务重叠可能双写 | 批准只在状态确实变化时记、驳回只在生效时记；记录器在按审批的 `pg_advisory_xact_lock` 事务锁内先查后写（仓库既有用法）；测试模拟两路同时到达只写一条 |
| S4 | 应修 | 补漏按最新取 200 条且不排除不会产事件的终态，更早的漏记永远轮不到 | 查询里排除取消 / 作废 / 批量失败 / 关联任务取消；按 `(updatedAt, id)` 升序翻页（每页 200、最多 10 页、每轮最多处理 100 条）；测试覆盖"前两页都已有事件也会翻到后面" |
| S5 | 应修 | 买家信息替换误伤与漏网：<br>- 误伤：数量区间 500-1000 pcs、USD 12000.50、日期被当电话；联系人 "Will An" 把 "we will ship an order" 替换掉；<br>- 漏网：非 ASCII 名 "José Smith" 拆不开；<br>- 收件人邮箱被名字替换拆坏 | 电话要求电话结构；单个名字只认原样与全大写、≥ 3 字母、排除称谓与常见词；Unicode 词边界；邮箱先整体保护最后还原；审查列出的反例全部入测 |
| S6 | 应修 | `requestApproval` 幂等命中复用旧审批时没有复用标记，并发重放可能写第二份快照，读最新一份会误判"改过" | 取正文哈希与执行正文一致的快照，否则取最早一份 |
| — | 小 | 中文签名块以 "Co., Ltd." 结尾被当正文；"10.5 cm" 被当编号追问；design D2 文案与实现不符 | 全部修正 |
| — | 记录 | 过期事件记在审批人名下，审批人可以在自己的反馈列表里修改它；diff 测试用的是手写正文而不是模板实际输出 | 前者写入已知限制；后者手写正文严格按两个模板的结构，模板实际输出留到 staging 核对 |

审查同时独立确认了以下几点：
- 端口动态导入，无循环依赖；非询盘回复类型零额外查询；已终态 / B2 重复分支不调用；返回值不受影响。
- `humanDecision` 取值合法，userId 回退顺序正确，无备注驳回时原因为空。
- 不传 `agentRunId`，所以 observe-human / reconcile-human 不会对这些事件产生副作用。
- 事件只含 id 与结构化 diff。
- "审批前不能改稿"的结论成立。
- 数值捕获排除货币与百分比。
- 正则在 10k 正文上没有回溯灾难。
- 测试已注册，`schema` / `vercel.json` 无改动。

## 5. staging 待验项（GATE-B1）

- 各终态的事件：批准一封、驳回两封（有备注 / 无备注）、放过期一封 FDE 询盘回复，确认各产一条团队范围反馈事件，`humanDecision` 与 userId 符合映射；
- 隐私：事件与快照不含买家个人信息，快照只保留收件人邮箱；
- 补漏：两小时后的补漏扫描不重复写；
- 查询性能：补漏查询（`type` + `status` + `updatedAt`）跑 `EXPLAIN ANALYZE`；
- 模板核对：用 `buildReplyDraft` / 跟进模板的真实输出核对段落分类。

## 6. 已知限制

- `approved_edited` 要等改稿来源（偏差 1）。
- 段落分类针对 FDE 模板生成的正文，人工改写成完全不同的结构时会按"事实段"计。
- 过期事件记在审批人名下，审批人可以在自己的反馈列表里修改它。
- 补漏只看近 7 天，不回填更早的历史。
