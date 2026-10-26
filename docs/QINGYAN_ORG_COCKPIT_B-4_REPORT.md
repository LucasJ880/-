# B-4 完成报告：评分校准报表，只报不改（openspec change `fde-score-calibration`）

任务书：`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` §B-4
分支：`claude/fde-score-calibration`（叠在 B-1 `claude/fde-feedback-loop` 之上；PR base = B-1 分支，依次合并后改回 `main`。B-4 本身只依赖 A-4）
OpenSpec change：`openspec/changes/fde-score-calibration/`（proposal / `specs/revenue-spine/score-calibration/spec.md` / design / tasks，`openspec validate --strict` 通过）

---

## 1. 做了什么

| 文件 | 内容 |
|---|---|
| `src/lib/revenue-spine/score-calibration.ts`（新） | 纯函数：<br>- 结局口径：赢 = `won`、输 = `lost`、其余未定；曾报价 = 报价及之后阶段或有 QUOTE_SENT；<br>- 维度归一（得分 ÷ 打分当时满分）与三档分桶；<br>- 命中率、区分度、等级表；<br>- 建议权重（下限 + 区分度正部比例 + 最大余数法）、样本门槛 30、无信号原因、policy 片段 |
| `src/lib/revenue-spine/score-calibration-read-model.ts`（新） | 只读查询，依赖可注入：<br>- 窗口内评估取每个商机最早一条，剔除窗口前已评估的；<br>- 合并商机阶段、入驻测试判定（与 SLA 指标同一函数）、QUOTE_SENT；<br>- where 全由导出的纯函数构造；评估 5000 行上限并标记截断，IN 每批 1000 |
| `src/app/api/revenue/score-calibration/route.ts`（新） | `GET ?days=`（30–180，缺省 90）：`resolveRevenueAccess` + `force-dynamic`，只读 |
| `src/components/revenue/score-calibration-panel.tsx`（新） | "评分校准（只报不改）"区块：<br>- 默认收起、点开才请求，收起后数据保留；<br>- 样本计数、六维表（分桶各带分母）、等级表、状态说明；<br>- 状态正常时显示建议列、只读片段与"复制为 policy 片段"按钮（只写剪贴板） |
| `src/app/(main)/revenue/page.tsx`（改） | 队列网格之后挂载区块，共 3 行 |
| 测试（新，均已注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`） | `score-calibration.test.ts` 36 条、`score-calibration-read-model.test.ts` 21 条、`score-calibration-panel.test.tsx` 43 条 |

### 报告长什么样（固定样本，32 个已定 + 3 个未定 + 3 个排除）

- 样本：首次评分 35 个，已定 32 个（赢 12 / 输 20），赢单率 37.5%，报价率 23 / 34。排除入驻测试 2 个、不合格 1 个。
- Product Fit：
  - 看好组 15 个赢 10 个，不看好组 17 个赢 2 个；
  - 命中率 25 / 32，区分度 +54.9 个百分点；
  - 高桶赢单率 66.7%（已定 15）/ 报价 94.1%（17）· 共 18。
- Completeness：已定商机全部看好，无法评估，建议保留现有 10。
- 建议权重：Product Fit 23、Commercial Potential 20、Buyer Quality 26、Intent 20、Completeness 10、Strategic Value 1，和为 100。Strategic Value 区分度为负，只拿下限 1。
- 片段 `{"scoring":{"weights":{…}}}` 经 `mergeRevenueSpinePolicy` 合并后，六维权重等于建议，其余 policy 字段不变。

## 2. 怎么验的

| # | 验证 | 结果 |
|---|---|---|
| 1 | 三个新测试单独运行 | 36 / 21 / 43 全过 |
| 2 | 任务书验收"纯函数 + 固定样本测试" | 32 个已定商机的样本，逐项手算核对分桶、命中率、区分度、等级表、建议权重；打乱顺序结果不变 |
| 3 | 任务书验收"样本不足路径有测试" | 已定 29 → 样本不足、无建议与片段、各维统计照常；区块显示"样本不足"与"已定 29 / 30"、无复制按钮 |
| 4 | 任务书验收"与 /revenue 既有数字口径一致" | 阶段集合直接引用 `opportunity-stage.ts`；源码断言 `cockpit.ts` 按 `stage: "won"` 计成交、`transition.ts` 进入 quoted 才写 QUOTE_SENT；入驻测试与 SLA 指标同一判定（超集覆盖 `/revenue` 的关闭原因排除） |
| 5 | 只读 | 源码断言：读模型 / 接口 / 区块无写方法、无原生 SQL、无事务、无 policy 发布 / 审计 / 结果写入、无写请求、不请求 `/api/revenue/policy` |
| 6 | 脱敏 | 假依赖返回带客户名、邮箱、金额、标题、理由的行，序列化后不出现这些值，也没有商机 id；生产查询源码不选这些列 |
| 7 | 跨组织 | 所有依赖调用都用服务端组织；生产查询的 5 个 where 全部来自构造函数（源码断言；把窗口前查询的组织限定去掉后测试变红，变异已验证）；别的组织的商机被丢弃 |
| 8 | 首屏不变 | `/revenue` 页本身不引用校准接口；区块无 `useEffect`，`load` 只由展开与重试触发 |
| 9 | 视觉 | Playwright 静态渲染，375 / 768 / 1280 宽 × 浅色与玻璃深色主题：页面无横向滚动（docScrollWidth < 视口），宽表在自身容器内横向滑动，按钮高度 ≥ 44px |
| 10 | 局部 `tsc`（B-4 全部文件） | 0 错误 |
| 11 | `npm run typecheck`（全量） | 退出 0 |
| 12 | `npm run lint:baseline` | PASS（无新增 error）；改动文件 0 问题 |
| 13 | `npm test` 对比基线 | 本分支 427/441（B-1 分支 424/438 + B-4 的 3 项，全 PASS）；14 项失败与基线逐条一致（排序后 diff 为空） |
| 14 | `npm run test:ci` | `CI unit subset PASS`，含三个 B-4 测试 |
| 15 | `bash scripts/check-test-registry.sh` | B-4 的测试全部注册。仍有 2 个未注册的 `src/lib/trade/__tests__/*`，`main` 上已有（PR #242 带入），不是本 change 引入；另一会话的 `register-acquisition-hub-tests` change 在处理（见 HANDOFF「已知的既有问题」） |
| 16 | `git diff --stat claude/fde-feedback-loop -- prisma/ vercel.json` | 空 |
| 17 | `openspec validate fde-score-calibration --strict`；`/opsx:verify` | valid。verify 结果：<br>- tasks 5/5；<br>- 11 条 requirement / 23 个 scenario 均有测试断言；<br>- design D1–D7 与实现一致；<br>- 无 CRITICAL / WARNING |

## 3. 与任务书的偏差（请 GATE 逐条确认，详见 proposal）

1. **结果取商机阶段，不取 `BusinessOutcome`**：
   - `/revenue` 全部按 `SalesOpportunity.stage` 计数，校准与之同口径；
   - QUOTE_SENT 会重复写，只当"报过价"的布尔证据，按商机去重；
   - `BusinessOutcome` 没有 disqualified 类型。
2. **不合格（disqualified）不进样本**：这个阶段由评分本身决定，拿它校准评分是循环论证。只计数展示。
3. **取首次评估、按当时满分归一**：后续评估混入跟进后的信息；`policyVersion` 恒为 v1，权重变化只能靠 `max` 识别。
4. **"口径一致"的含义**：`/revenue` 没有胜率、转化率、等级分布，无从逐数对账。改为同一套阶段定义与同一测试排除规则，由测试锁定。
5. **policy 片段的落点**：policy 在 `OrgBusinessRule`，不在 `settingsJson`。今天**没有 policy 设置页面**，只有 `PUT /api/revenue/policy`（boss / admin）。片段可直接作为它的 `policy` 值，本 change 不调用它、不新建页面。
6. **按需加载**：区块默认收起，与 A-4 一致，`/revenue` 首屏请求不变。
7. **【GATE 决策项】建议权重有下限**（任务书未提，来自交叉审查阻塞项）：
   - 规则：可评估维度不低于下限，productFit 3、其余 1；区分度为负的维度只拿下限。
   - productFit 的理由：
     - 评分在 productFit 得 0 时判不合格，并经 FDE 转入 disqualified、不起草、自动关闭；
     - 权重为 0 时所有询盘都会被判不合格，权重 1–2 时"未识别到产品"的询盘也会被判不合格；
     - 权重 ≥ 3 时这一档仍得 1 分。测试用四类询盘对比默认 policy，锁定"粘贴建议不改变不合格判定"。
   - 其余维度的理由：任一维为 0 后，以后的评估满分为 0、永远无法评估，校准会卡死在 0。
   - 代价：建议不是纯按区分度归一。下限合计只有 8，区块写明了下限和理由。
8. **样本门槛按"已定商机"计**：赢输已定少于 30 个时不给建议。未定商机进样本数与报价率，不进赢单率与建议。

## 4. 交叉审查（独立审查代理，只给代码与规格）

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| 1 | 阻塞 | 建议权重可能把 productFit 设为 0（区分度 ≤ 0 时很常见）。粘贴发布后，所有新询盘都会被判不合格并自动关闭；任何维度一旦为 0 也再也校准不回来。审查给了可复现脚本 | 加下限（偏差 7）：productFit 3、其余 1；spec 拆出「建议权重的下限」requirement；审查的复现用例入测，断言四类询盘的不合格判定与默认 policy 一致 |
| 2 | 应修 | 分桶格显示的样本数是含未定的总数，不是旁边比率的分母，未定多时会误读（"100% · 40 个"实际只有 1 个已定） | 每格显示"赢单率（已定 n）/ 报价率（已见分晓 n）· 共 n"，脚注同步 |
| 3 | 应修 | 测试没锁住生产查询确实用了 where 构造函数；假依赖忽略 `since`。把组织限定去掉或把 since 传错，测试照样全绿 | 源码断言 5 个 `findMany` 的 where 恰为 5 个构造函数调用、评估查询带 `take`；假依赖记录 since 并断言；变异验证（去掉组织限定 → 测试变红） |
| 4 | 可选 | "无信号"文案固定为"区分度都不为正"，没有可评估维度、小数权重导致总额不够时不准 | 报告带 `noSignalReason`（`no_evaluable` / `no_positive_lift` / `budget`），区块按原因显示 |
| 5 | 可选 | 现有权重为负时，建议会保留负数，违反"非负整数" | 总额与保留值都按 `max(0, …)` 计；加测试与 2000 组固定种子随机不变式测试 |
| 6 | 可选 | spec 写"不接受请求里的组织"，与 `resolveTradeOrgId` 实际行为（请求 orgId 用于校验 / 平台管理员显式选择）不符；路由测试那条断言什么都没测 | spec 改为"同 `/api/revenue/*` 规则"；断言改为路由不自己读组织参数 |
| 7 | 可选 | 注册校验在本分支不通过，原因是 base 已有的 2 个 trade 测试未注册 | 如实记录（第 2 节第 15 项）；另一会话的 change 在修 |
| 8 | 可选 | 复制成功提示在收起再展开后仍然显示 | 开合时复位 |

审查同时独立确认了以下几点：
- 读模型的组织限定、首评选取、截断不会选错首评（按 createdAt 升序留最早 5000 条）；
- Prisma `distinct` + `orderBy` 在内存去重并保留第一条，语义正确；
- 脱敏与只读成立；
- 20 万组随机输入下"和恰等于总额、非负整数"从未被打破；
- 八条硬纪律无违反。

## 5. staging 待验项（GATE-B3 的 B-4 部分）

- 在 sunny-home-deco 种子数据上打开 `/revenue` → 点开区块，确认可渲染。种子数据没有 FDE 评估记录时，预期显示"样本不足：已定 0 / 30"与空表，这也是一次有效渲染。
- 在有真实询盘的组织上核对：已定数与 `/revenue` 阶段分布里 won + lost 的差，应恰为窗口外 / 无评估 / 测试单的数量。
- 查询性能：评估查询走 `(orgId, grade)` / `(opportunityId, createdAt)` 索引，窗口过滤需要 `createdAt`。在大组织上跑一次 `EXPLAIN ANALYZE`，必要时另提索引 change（本 change 零 schema）。

## 6. 已知限制

- 小样本：30 个已定商机分两组后，每组只有十几个，区分度波动大。区块写明"仅供参考"，每格带分母。
- 现有 policy 若已把某维设为 0，该维无法评估，建议保留 0（人工配置，本 change 不改）。
- 近期商机多为未定，90 天窗口的已定数可能偏少；`days` 可放宽到 180（区块固定 90 天，接口支持参数）。
- 命中率在输单远多于赢单时天然偏高，区块脚注提示与区分度一起看。
- 结局取当前阶段：丢单后转培育会从"输"变"未定"，与 `/revenue` 同口径。
