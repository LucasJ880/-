# B-2 完成报告：人工修改 → 商务事实沉淀（openspec change `fde-fact-proposals`）

任务书：`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` §B-2；已决定 D-3；改稿来源按用户 2026-10-26 选的 (b)。
分支：`claude/fde-fact-proposals`。叠在 B-5 `claude/fde-internal-autonomy` 之上，PR base = B-5 分支，依次合并后改回 `main`。B-2 本身只依赖 B-1。
OpenSpec change：`openspec/changes/fde-fact-proposals/`（proposal / `specs/revenue-spine/commercial-fact-proposals/spec.md`（新）/ `specs/revenue-spine/fde-draft-feedback/spec.md`（修改 B-1 的 3 条）/ design / tasks，`openspec validate --strict` 通过）。

---

## 1. 做了什么

审批前不能改稿，所以 B-1 的 `approved_edited` 永远不会出现。真正的"人工修改"只发生在一种情况：销售看了 FDE 草稿没批，自己在外贸收件箱回了买家，草稿随即被系统作废（`SUPERSEDED_BY_MANUAL_REPLY`）。B-2 在这一刻接手：

1. **记一条改稿事件**（补上 B-1 的学习信号）：`replaced_by_manual_reply`，`humanDecision = edited`，diff = 草稿快照 vs 人工外发正文。
2. **规则化抽取**：只看人工回复相对草稿新增的行，抽 6 个 `commercialFacts` 键，价格类句子整句跳过。
3. **起卡**：与企业当前值不同或未配置时，起一张 `revenue_spine.propose_commercial_fact` 审批卡。
4. **批准 → 写入**：经 `publishRevenueSpineRule(business_profile)` 发布新版本，下一封草稿按既有口径引用。

| 文件 | 内容 |
|---|---|
| `src/lib/revenue-spine/fact-extract.ts`（新） | 纯函数抽取：截引用、价格句过滤、6 个字段的规则、规范键、中文展示 |
| `src/lib/revenue-spine/fact-proposals.ts`（新） | 新增行与证据对齐、起卡判定（含子字段补齐与合并规则预校验）、审批人挑选、依赖可注入的起卡器、执行器（批准时在最新配置上重新合并） |
| `src/lib/pending-actions/approver-roles.ts`（新） | 按类型的批准角色门：按批准人 `User.role` 判 admin / super_admin / boss |
| `src/lib/pending-actions/types.ts` / `executor.ts`（改） | 新类型与载荷；认领前角色门；执行分支 |
| `src/lib/ai-grader/actions/wechat-confirm-policy.ts`（改） | 新类型 `web_only_review` |
| `src/lib/cockpit/posts.ts`（改） | 新类型归"询盘销售"岗位 |
| `src/lib/revenue-spine/fde/draft-feedback.ts`（改） | 人工回复终态、读外发正文、userId、补漏条件、记录后起卡（排除开发信与线索页手工留痕）、买家电话只交给提案 |
| `src/lib/revenue-spine/fde/draft-diff.ts`（改） | 导出带段落类型的行与新增行下标 |
| `src/lib/trade/outbound-sync.ts`（改） | 作废成功后尽力而为地记录 |
| 测试 | `fact-extract.test.ts`（新，61 条，其中表驱动 51 例）、`fact-proposals.test.ts`（新，37 条）、`draft-feedback.test.ts`（扩充到 95 条）；新测试已注册进两个测试脚本 |


### 起卡与写入的规则

1. **来源**：外贸收件箱回复与"标记已发"。开发信（模板外发）与线索页手工留痕（常记着买家说的数字）只记事件、不抽。入驻测试询盘不产事件、不起卡。
2. **抽取**（纯函数，无 LLM）：
   - 先截引用的历史邮件，再只取相对草稿快照新增的行；没有快照时整封都算新增；
   - 价格类句子（币种、金额单位、价格 / 费用 / 免费样品、折扣、佣金、付款与账期、百分比）整句跳过，宁可多跳；
   - 起订量取关键词之后最近的数字，"低于起订量"句式不取买家的数；运输时间、产前样时效不当大货周期；目的港不当装运港；
   - 有没有结束语按整封回复判：有结束语时签名里的口号不当事实；没有结束语的短回复，最后一段也按事实段抽；
   - 网址与 WhatsApp 不取买家邮箱同域或买家电话的值。
3. **起卡判定**：
   - 回复里没写的子字段先用当前值补齐（起订量 per、大货起算点、样品两组天数；落款只补空缺；港口取并集），当前也没有时用合并规则默认值并在预览注明；
   - 与当前值相同、同字段有待审批卡、24 小时内起过、同（字段，提议值）被驳回、过不了合并规则、组织里没人能批 → 不起卡。
4. **审批卡**：类型 `revenue_spine.propose_commercial_fact`，`l2_soft`，7 天有效；审批人优先所有者（在职成员且平台角色 admin / boss），否则在职 boss，再否则在职 admin。载荷含抽取原值、提议值、当前值、规范键、证据句（已替换买家信息）、商机与来源草稿 id；不含整封回复、买家邮箱 / 电话、金额。
5. **批准**：
   - 认领前按批准人 `User.role` 判 admin / super_admin / boss，无权时卡保持待审批；
   - 执行器在批准时的最新商务事实上重新合并抽取原值，经 `publishRevenueSpineRule(business_profile)` 发布新版本，写审计 `revenue_spine.commercial_fact.applied`；已是该值时成功但不发布。
6. **驳回**：沿用既有审批权限；同一（字段，提议值）此后不再起卡。

## 2. 怎么验的

| # | 验证 | 结果 |
|---|---|---|
| 1 | 三个测试单独运行 | `fact-extract` 61 / 61、`fact-proposals` 37 / 37、`draft-feedback` 95 / 95；`draft-diff` 53 / 53 |
| 2 | 任务书验收"修改草稿加入 MOQ → 出现事实提案卡 → 批准 → 下一封草稿引用" | 端到端假依赖测试：人工回复作废 → 记录器写改稿事件 → 起 moq / 样品 / 落款卡；执行器合并后 `getMOQ` / `getLeadTime` 从 unavailable 变为 available |
| 3 | 任务书验收"驳回 → 不再起卡" | 驳回过的（字段，规范键）不再起卡，换一个值仍可起 |
| 4 | 任务书验收"价格句永不起卡" | 表驱动覆盖币种紧贴数字、金额单位、费用、免费样品、账期、百分比；含价格的新增行不产任何事实；卡片 JSON 不含 `USD` / `$` |
| 5 | 审批中心可批 | 组织角色 `org_owner`、平台角色 boss → 写入成功；平台角色 sales（无论传入的 ctx.role 是什么）→ 拒绝；源码断言角色门在 `canDecideTeamApproval` 之后、CAS 认领之前，按 `User.role` 判，驳回路径不经过它 |
| 6 | 交叉审查两轮的反例全部入测 | 见第 4 节 |
| 7 | 无外发 / 无新队列 / 无 LLM | 抽取与起卡全是规则；起卡在既有外发同步与 `approval-timeout` 补漏调用链里同步完成 |
| 8 | `npm run typecheck`（全量） | 退出 0 |
| 9 | `npm run lint:baseline` | PASS |
| 10 | `npm test` 对比基线 | 本分支 430/444（B-5 分支 428/442 + B-2 新增 2 项，全 PASS）；14 项失败与基线逐条一致 |
| 11 | `npm run test:ci` | `CI unit subset PASS`，含 B-2 两个新测试 |
| 12 | `bash scripts/check-test-registry.sh` | B-2 新测试已注册；仍有 `main` 上既有的 2 个 trade 测试未注册（不是本 change 引入） |
| 13 | `git diff --stat claude/fde-internal-autonomy -- prisma/ vercel.json` | 空 |
| 14 | `openspec validate fde-fact-proposals --strict`；`/opsx:verify` | valid。verify 结果：<br>- tasks 5 / 5；<br>- 新增 7 条 requirement / 26 个 scenario、修改 B-1 的 3 条 / 10 个 scenario，均有测试断言；<br>- design D1–D6 与实现一致（第二轮审查后 D3 已同步）；<br>- 无 CRITICAL / WARNING。<br>未验证：真实 DB 下的 Prisma 查询与审批中心全链路（容器无 DB），留 staging |

## 3. 与任务书的偏差（请 GATE 逐条确认，详见 proposal）

1. **触发点**：任务书写"在 `approved_edited` 上触发"。审批前不能改稿，按用户选的 (b) 改为"人工回复作废草稿"；`approved_edited` 将来出现时走同一路径。
2. **写入位置**：商务事实存在 `OrgBusinessRule(revenue_spine.business_profile)`，不在 `settingsJson`。执行器走 `PUT /api/revenue/policy` 同一个发布函数（新版本、可回滚）。
3. **角色门**：既有 `requiredRole` 只记录不执行。本 change 加按类型的认领前角色门，规则与 `PUT /api/revenue/policy` 相同；按批准人 `User.role` 判（审批中心传进执行器的是组织成员角色）。审批人按平台角色挑。
4. **限流"一天"** = 滚动 24 小时。
5. **证据**只存触发该字段的那一句（替换买家信息后），不存整封回复。
6. **截引用**：人工回复常带 "On … wrote:" 引用的买家原信，抽取前截掉。
7. **archive 顺序**：本 change 修改 B-1 的能力，必须先归档 `fde-feedback-loop`，再归档本 change。
8. **【GATE 注意项】外发正文不一定是销售逐字手写**：外贸收件箱的回复正文常是收件箱 LLM 草稿被采用后发出。已由销售确认并外发，起卡仍需老板批准；卡片写"发给买家的外发正文原句"。
9. **【GATE 注意项】落款只补空缺**：落款全组织共用，每个销售的 WhatsApp 不同，已配置的子字段不再起卡改写，要改走 `PUT /api/revenue/policy`。
10. **【GATE 注意项】并发**：两封人工回复几乎同时到，可能为同一字段各起一张卡；两张卡同时批准时，读取与发布不在同一事务，后批的可能撞版本号唯一约束而失败（卡变 failed，可再起）。频率低，不加锁。
11. **外发同步多了一步**：作废成功后同步记录事件与起卡（几次查询 + 建审批），回复接口略慢；尽力而为，失败不影响外发。
12. **补漏窗口**：沿用 B-1 的 7 天，上线后第一次扫描会处理上线前 7 天内的人工回复作废。
13. **Muse**：`status` 计数包含新类型；`approve` 对该类型只回"需在审批中心批准"（`web_only_review`），不能在 Muse 里直接批。

## 4. 交叉审查（独立审查代理两轮，只给代码与规格）

### 第一轮

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| 1 | 阻塞 | 审批中心传给执行器的是组织成员角色（`org_owner` …），角色门拿它判，审批中心里 boss / admin 也批不了 | 角色门与执行器内复核都按 `ctx.userId` 读 `User.role`；测试"org_owner + 平台 boss → 写入" |
| 2 | 阻塞 | 价格句漏拦：`USD4.80`、`RMB25/pc`、`25元/件`、`dollars`、样品费；证据句原样进了卡片 | 币种代码紧贴数字也算，补金额单位、费用、免费样品、账期；每种写法入表驱动测试 |
| 3 | 应修 | 起订量取句中第一个数字（"Your order of 300 pcs is below our MOQ of 500 pcs" 抽成 300） | 取关键词之后最近的数字 |
| 4 | 应修 | 账期、海运时间、产前样被当大货周期 | 账期进价格句；运输时间排除；判大货前先去掉产前样字样 |
| 5 | 应修 | 只抽到部分子字段的提议会冲掉已配置值（样品定制区间、起算点、起订量 per） | 回复里没写的部分记 null，起卡与批准时沿用当前值 |
| 6 | 应修 | 执行器写起卡时算好的值，起卡后老板改过的港口会丢 | 载荷存抽取原值，批准时在最新配置上重新合并 |
| 7 | 应修 | `www.` / `http://` 目录链接过不了合并规则，批准后才失败 | `www.` 补 `https://`、`http://` 不收；起卡前用合并规则预校验，过不了不起卡 |
| 8 | 应修 | 没有结束语的短回复一个事实也抽不到 | 没有结束语时最后一段也按事实段抽 |
| 9 | 应修 | 线索页手工留痕记着买家的数字；预览写"销售手写"不准 | 手工留痕不抽；预览改"外发正文原句"；收件箱 LLM 草稿列为 GATE 注意项 |
| 10 | 应修 | 审批人固定为所有者，所有者不是 boss / admin 时永远批不了 | 按平台角色挑审批人，没人能批不起卡 |
| 11 | 应修 | 买家电话没传进来 | `loadBuyer` 读电话，只交给提案排除 WhatsApp，不进事件 |
| — | 可选 | 目的港、"Ningbo Port" 规范化；P.S. 当职位、WhatsApp/WeChat、LinkedIn、证据行；落款来回改；补漏回看与"不回填"矛盾；并发；Muse 措辞；外发时延 | 前四项改代码并入测；落款只补空缺；后四项改文档并列为偏差 10–13 |

### 第二轮（只审第一轮的修复）

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| 1 | 应修 | 结束语只在新增行里找：照抄草稿的 "Best regards," 不算新增，签名口号（"fast delivery in 15 days"、"Shipping from Ningbo port"）被当事实起卡；结束语词表比 draft-diff 少 | 按整封回复判，复用 draft-diff 的 `isClosing`（一份词表） |
| 2 | 应修 | 价格词放宽后误杀整段："消费者"的"费"、裸"元"（元旦 / 公司名）、"样品 3 块"、"CAD 图纸"、"in charge" | CAD / AUD / HKD 只在紧挨数字时算；"元""块""费"收窄；"in charge" 除外；反例入表 |
| 3 | 应修 | 关键词之后没有数字时退回取前面的数，"300 pcs is below our MOQ" 仍抽 300 | 只取紧挨在关键词前面的数字，"低于"句式不取 |
| 4 | 应修 | design D3 没跟上代码 | 重写 D3（价格词、各字段规则、结束语、默认值口径） |
| — | 可选 | "不猜默认值"与卡片补 style 对不上；非成员所有者被选成审批人后认领才失败；停用账号；大写 `HTTPS://`；港口满 10 个 | 预览注明按默认值补上的部分、spec 改措辞；审批人只取在职成员且账号在职；scheme 转小写；港口满 10 个记为已知限制 |

审查同时独立确认了以下几点：
- 终态映射与 userId 回退顺序；
- 按审批加锁的幂等，只在事件确实写入后才起卡；
- 原文与脱敏文逐行对齐（脱敏只会让行数变少，行数相等就对得上，不相等时退回）；
- 事件与日志不含正文；
- Prisma 查询与 schema 对得上；
- 八条硬纪律无违反。

## 5. staging 待验项（GATE-B2 的 B-2 部分）

- 在外贸收件箱人工回复一封带 MOQ 的询盘（该询盘有待审批 FDE 草稿）。确认：
  - 产生一条 `replaced_by_manual_reply` 事件；
  - 起一张 `moq` 卡，审批人是 boss，预览写明当前 → 提议与证据句；
  - 在审批中心用 boss 账号批准成功，`revenue_spine.business_profile` 出了新版本，有 `revenue_spine.commercial_fact.applied` 审计；
  - 下一封同类询盘的草稿引用该 MOQ（"For reference, our MOQ is typically …"）。
- 用 sales 账号在审批中心批准同类卡：返回无权，卡仍待审批。
- 驳回一张卡后，同样的回复再来一次不再起卡。
- 回复里带价格（"USD4.80 FOB Ningbo"）：不起任何卡。

## 6. 已知限制

- 规则只认词表内的写法，漏抽是预期内的取舍（宁漏不误）；误抽只会起一张卡，驳回后不再起。
- 起卡后老板把装运港补到 10 个，批准时合并规则只留前 10 个，执行会失败（卡变 failed）。
- 两张同字段卡同时批准可能撞版本号唯一约束（偏差 10）。
- 中文草稿的起订量句对 `per = color` 等写成"每color"（既有问题，`reply-draft.ts`，已另列为后续任务）。
