# Design

## Context

动机见 proposal.md「Why」，对外行为见 `specs/revenue-spine/score-calibration/spec.md`。这里只列决定做法的现状：

1. **评估记录**：`SalesOpportunityAssessment`。
   - 唯一写入方是 `fde/inbound-sales.ts`，询盘分诊时写，同一商机可多条。
   - 六维只在 `dimensionsJson` 里：`[{key,label,score,max,reason}]`。
   - `max` 是打分当时的 policy 权重。`policyVersion` 恒为 `revenue-spine-policy/v1`，不能用来区分权重版本。
   - `grade` 存的是 HOT / HIGH / MEDIUM / LOW。
   - 有 `(opportunityId, createdAt)` 索引。
2. **结局**：
   - `/revenue`（`revenue-spine/cockpit.ts`）全部按 `SalesOpportunity.stage` 计数。
   - 阶段只经 `transition.ts` 写入；进入 `quoted` 时同时写一条 `BusinessOutcome(QUOTE_SENT)`。这条记录的 `sourceId` 带时间戳，重复进入会重复写。
   - 丢单可转 `nurture`，不合格可转 `nurture`。
3. **入驻测试**：
   - `sla-metrics.ts` 的 `isOnboardingTestInquiry` 看三样：UTM（首个 FDE 询盘行动的 `inputContext.meta.utm`）、客户标签、关闭原因；
   - `/revenue` 阶段分布只排除关闭原因（`EXCLUDE_ONBOARDING_TEST_OPPORTUNITIES`），前者是后者的超集。
4. **policy**：
   - 在 `OrgBusinessRule(revenue_spine.policy)`，由 `loadRevenueSpinePolicy` 读出；
   - 发布只能走 `PUT /api/revenue/policy`（boss / admin），没有设置页面；
   - `mergeRevenueSpinePolicy` 对 `scoring.weights` 逐键合并。
5. **页面与接口惯例**：
   - `/revenue` 是单个客户端页 `src/app/(main)/revenue/page.tsx`；
   - `/api/revenue/*` 统一用 `resolveRevenueAccess` + `force-dynamic`；
   - A-4 的工作量面板已有"点开才请求"的容器 + 无 hook 视图写法，可照搬。

## Goals / Non-Goals

**Goals:**
- 统计全部放在纯函数里，读模型只负责查数和拼行，便于用固定样本锁定每个数字。
- 接口与区块对现有 `/revenue` 首屏零影响（不加首屏请求、不改已有区块）。
- 结局口径直接引用 `opportunity-stage.ts` 的阶段常量，不另抄一份阶段表。

**Non-Goals:**
- 不改以下文件：
  - `src/lib/revenue-spine/scoring.ts`、`policy.ts`、`transition.ts`、`outcomes.ts`、`cockpit.ts`、`fde/inbound-sales.ts`；
  - `src/app/api/revenue/policy/route.ts`、`src/app/api/revenue/cockpit/route.ts`；
  - `src/app/(main)/revenue/[id]/page.tsx`、`src/app/(main)/revenue/today/page.tsx`。
- 不新建 policy 设置页面，不新增定时任务，不缓存报告（每次请求现算）。
- 不做显著性检验、置信区间、回归或任何训练。

## Decisions

### D1 样本 = 首次评估落在窗口内的商机
- 取每个商机最早的一条评估，以它的 `createdAt` 判断是否落在窗口内。
- 最早评估在窗口前的商机整体不进样本，用第二个查询找出"窗口前已有评估"的商机后剔除。
- 理由：校准的对象是"分诊时的预测"。后续评估是跟进后重算的，会混入买家回信之后才知道的信息，拿它对结局会高估预测力。
- **否决**：
  - 取最新一条评估（与商机详情页一致）：会把事后信息带进来。
  - 按商机 `createdAt` 开窗：手工录入或其它渠道建的商机没有评估，且评估时刻才是预测时刻。
  - 按 `version = 1` 筛：`version` 是 `count + 1`，并发下不可靠。

### D2 结局取当前阶段，报价用阶段 + QUOTE_SENT 去重
- 赢 = `won`，输 = `lost`，其余未定。
- 曾报价 = 阶段在 `OPEN_STAGES` 中 `PRE_QUOTE_STAGES` 之后的部分，或为 `won`，或有 QUOTE_SENT 结果（按 `entityId` 去重）。
- 报价已见分晓 = 曾报价，或阶段不在 `PRE_QUOTE_STAGES`。
- 理由：
  - 与 `/revenue` 同口径；
  - `lost` 的商机只能靠 QUOTE_SENT 知道它丢单前报没报过价；
  - QUOTE_SENT 会重复写，所以只当布尔证据用。
- **否决**：
  - 以 `BusinessOutcome` 为真值（任务书原文）：
    - 没有 disqualified 类型；
    - DEAL_WON / DEAL_LOST 会重复；
    - 赢后又被人工改阶段时与 `/revenue` 不一致。
  - 用 `wonAt` / `lostAt` 判定：`lost → nurture` 后 `lostAt` 仍在，会与 `/revenue` 的阶段计数不一致。

### D3 不合格与入驻测试排除，入驻测试优先
- 判定顺序：
  1. 先按 `isOnboardingTestInquiry`（UTM + 标签 + 关闭原因）判测试；
  2. 再看阶段是否 `disqualified`。
- 两类各自计数，都不进比率。
- 理由：
  - 测试单通常也是 disqualified，先判测试才能让两个计数各自有意义；
  - disqualified 由 `score.qualification` 决定，用它校准评分是循环论证。
- **否决**：
  - 把 disqualified 当"输"：评分低 → 判不合格 → 计为输，会人为抬高每一维的区分度。
  - 只用 `/revenue` 的关闭原因规则：会漏掉带 UTM 或标签、但还没关闭的测试单。

### D4 归一与"看好"阈值
- r = clamp(score / max, 0, 1)；max ≤ 0、score 非数字或缺维度时，该维这一行不计。
- 分桶 [0, .4) / [.4, .7) / [.7, 1]，比较时加 1e-9 容差，让 0.7 这类浮点边界稳定归入高桶。
- "看好" = r ≥ 0.5。命中率与区分度都基于同一个阈值。
- 理由：
  - 权重变过时，绝对分不可比，归一后可比；
  - 0.5 是"拿到一半以上分"的直观含义，与分桶独立，避免空桶导致区分度无法计算。
- **否决**：
  - 按中位数切两半：分数离散，大量并列落在中位数上，两半样本数不稳定，且换一批数据阈值就变，不好解释。
  - 用高桶 − 低桶赢单率当区分度：中桶样本被浪费，且任一端空桶就无法评估。

### D5 建议权重：下限 + 区分度正部按比例分配，最大余数法取整
- 计算步骤：
  1. 总额 T = round(Σ max(0, 现有权重))。
  2. 无法评估的维度保留 round(max(0, 现有权重))。
  3. 可评估维度先各得下限：productFit 3，其余 1。
  4. 剩余 B = T − Σ保留 − Σ下限，按 max(0, 区分度) 在可评估维度间按比例分配。
  5. 先取 floor，差额按小数部分从大到小补 1，并列时按固定维度顺序。
- 样本门槛为已定 30 个。无信号分三种原因：
  - `no_evaluable`：没有可评估维度；
  - `no_positive_lift`：区分度正部之和为 0；
  - `budget`：B < 0。
- 下限（交叉审查阻塞项）：
  - `scoring.ts` 在 productFit 得 0 时判不合格；"未识别到产品"一档得 round(权重 × 0.2)。productFit 权重为 0 时，所有询盘都判不合格；权重 1–2 时，这一档也判不合格。权重 ≥ 3 时这一档得 1 分，粘贴建议不改变不合格判定。测试用四类询盘对比默认 policy 锁定。
  - 任一维为 0 后，该维以后的评估满分为 0、永远无法评估，校准形成吸收态。因此每个可评估维度至少为 1。
- 理由：
  - 确定性，可手算复核；
  - 和恒等于现有总额，粘贴后不改变总分量纲；
  - 不可评估的维度没有证据，不该被清零；
  - 区分度为负的维度只降到下限，不会因为一次小样本噪声把评分逻辑改掉。
- **否决**：
  - 按高桶赢单率归一（任务书举例）：基础赢单率高的组织每一维都高，分不出哪一维有用。
  - 与现有权重做 50/50 平滑：多一个需要解释的超参数，且建议列与现有权重并排展示，人能看出差距自行折中。
  - 门槛按每维样本数：口径复杂，任务书明确是"样本 < 30"。
  - 不设下限、只在区块上警告 0 值：一旦粘贴，所有新询盘都被判不合格并自动关闭，代价远大于下限带来的偏差。

### D6 读模型：五个只读查询，依赖可注入
- 依赖注入：`deps` 注入 `findAssessments` / `findEarlierAssessmentOpportunities` / `findOpportunities` / `findFirstInquiries` / `findQuoteSentOpportunities` / `loadPolicy`；生产实现用 `db.*.findMany` 与 `loadRevenueSpinePolicy`。
- where 条件全部由导出的纯函数构造（同 A-4），测试直接断言 `orgId`、窗口与 IN 列表。
- 评估最多取 5000 行（按 `createdAt, id` 升序），超出时标记截断。IN 查询每 1000 个 id 分一批。
- 行拼装（取最早、剔除窗口前、合并阶段 / 测试 / 报价）是导出的纯函数，只把统计需要的字段（等级、维度分、阶段、是否测试、是否报价）交给统计函数。
- 理由：
  - 统计函数从结构上拿不到客户名、金额、理由文本，"不输出个人信息"由类型保证，测试再序列化兜底。
- **否决**：
  - 一条 SQL 用窗口函数取首评：要写原生 SQL，跨组织条件只能靠字符串拼接审查，测试也要连库。
  - 在客户端拉原始评估自己算：会把评估理由与客户信息下发到浏览器。

### D7 区块：容器 + 无 hook 视图，点开才请求
- 区块拆为两层：
  - `ScoreCalibrationSection` 管展开与加载状态（idle / loading / error / ready），收起后保留数据；
  - `ScoreCalibrationView` 无 hook，`renderToStaticMarkup` 直接测。
- 复制按钮调用 `navigator.clipboard.writeText`。片段同时显示在只读 `<pre>` 里，剪贴板不可用时可以手选。
- 表格外包 `overflow-x-auto`，手机宽度不撑破页面。
- 理由：
  - 与 A-4 一致；
  - `/revenue` 首屏请求不变。
- **否决**：
  - 首屏自动加载：每次打开 `/revenue` 多一组五个查询，而校准是月度级别才看一次的东西。
  - 单独新页面：任务书要求面板放在 `/revenue`。

## 与八条硬纪律的关系

1. **零 schema**：只读 `SalesOpportunityAssessment` / `SalesOpportunity` / `SalesCustomer.tags` / `SalesAction.inputContext` / `BusinessOutcome` / `OrgBusinessRule`。不加 model、字段与 migration，也不写任何 JSON 位。
2. **出站先审批**：不涉及（无任何外发；复制片段只进本机剪贴板）。
3. **禁止第三套队列**：不新增 cron、队列或 worker，接口按请求现算。
4. **脱敏**：不输出任何金额（预估金额、成交额、毛利、估值、我方报价），只输出计数、比率与权重。spec 有专条 SHALL NOT，读模型测试序列化断言。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及（不读不写邮箱设置；客户邮箱不被查询）。
7. **确定性优先**：
   - 全部是确定性统计与取整，同输入同输出，有测试断言；
   - 不调用 LLM；
   - 不读写偏好记忆；
   - 不自动改 policy。
8. **测试注册**：两个 `src/lib/revenue-spine/__tests__/*.test.ts` 与一个组件测试都注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，`scripts/check-test-registry.sh` 通过；不改 `ci/test-registry-baseline.txt`。

## Risks / Trade-offs

- **[样本小、噪声大]**：30 个已定商机分到两组后每组只有十几个，区分度波动大。
  → 门槛 + 每格都带样本数 + 区块文案写明"仅供参考，需人工判断后发布"；建议列与现有权重并排。
- **[近期商机未定]**：90 天窗口里大部分商机可能仍在推进，已定数偏少。
  → 显示未定数；`days` 可放宽到 180。
- **[命中率受类别不平衡影响]**：输单远多于赢单时，"全不看好"的维度命中率也高。
  → 同时给区分度；区块脚注说明命中率要和区分度一起看。
- **[阶段被改回]**：`lost → nurture` 会让商机从"输"变"未定"。
  → 与 `/revenue` 同口径，是有意选择（D2）。
- **[下限偏差]**：区分度为负的维度仍拿下限（productFit 3、其余 1），建议不是纯比例。
  → 下限之和只有 8，影响有限；区块写明下限与理由。
- **[已有 0 权重]**：现有 policy 若已把某维设为 0，该维无法评估，建议保留 0。
  → 这是人工配置，本 change 不改；报告列为已知限制。
- **[截断]**：窗口内评估超过 5000 行时只统计最早的 5000 行。
  → 响应带截断标记，区块显示提示。梦馨规模远低于此。
- **[查询量]**：一次请求五个查询，IN 列表分批。
  → 只在用户点开时发生，无首屏开销。

## 验证方式

| 验证项 | 命令或做法 | 期望结果 |
|---|---|---|
| 纯函数 | `npx tsx src/lib/revenue-spine/__tests__/score-calibration.test.ts` | 断言全部通过（见下） |
| 读模型与接口 | `npx tsx src/lib/revenue-spine/__tests__/score-calibration-read-model.test.ts` | 断言全部通过（见下） |
| 区块 | `npx tsx src/components/revenue/__tests__/score-calibration-panel.test.tsx` | 收起态、加载中、错误重试、样本不足、无信号、正常态、截断提示、"—"空值渲染均正确 |
| 门禁 | `npm test`（与基线比较，新增失败为 0）、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh` | 前四项通过；注册校验除 base 已有的 2 个 trade 欠账外无新增 |
| 改动范围 | `git diff --stat` | 无 `prisma/` 与 `vercel.json` 改动 |
| 视觉 | scratchpad 的 Playwright 截图（375 / 768 / 1280 宽） | 无横向滚动，表格可横向滑动 |

纯函数测试的断言：
- 固定 32 个商机样本，逐个核对分桶、命中率、区分度、等级表与建议权重；
- 样本不足（29）与无信号三种原因；
- 下限：productFit 区分度不为正时建议为 3，合并后四类询盘的不合格判定与默认 policy 一致；随机 2000 组输入的和、非负、下限不变式；
- 片段经 `mergeRevenueSpinePolicy` 合并后权重相等；
- 阶段常量与 `opportunity-stage.ts` 一致；
- `transition.ts` 的 quoted → QUOTE_SENT 源码断言。

读模型与接口测试的断言：
- where 条件限定组织与窗口，生产查询的 where 全部来自构造函数（源码断言，变异验证）；
- 首评选取与窗口前剔除；
- 测试 / 不合格计数；
- 序列化结果不含客户名、邮箱、金额、理由文本与商机 id；
- 窗口参数 7 / 365 / abc / 缺省分别为 30 / 180 / 90 / 90；
- 源码静态断言不调用 policy 发布与任何写方法；
- 路由使用 `resolveRevenueAccess` 与 `force-dynamic`。

## Migration Plan

无数据迁移。部署即生效：区块默认收起，不点开就不产生任何查询。回滚：撤销本 PR，没有遗留数据。
