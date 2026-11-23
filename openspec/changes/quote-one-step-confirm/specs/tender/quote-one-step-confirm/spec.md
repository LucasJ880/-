## ADDED Requirements

### Requirement: 主按钮按状态与权限
新页面上逐行报价与总价报价的编辑器标题旁边 SHALL 有一个主按钮或一句状态，按报价状态与看的人的权限决定（批准权限 = `project:cost:review` 或项目负责人等报价引擎认的特权；编辑权限 = `project:cost:write` 或同样的特权）：

| 状态 | 有批准权限 | 只有编辑权限 | 都没有 |
|---|---|---|---|
| 草稿 | 「定为我方报价」 | 「提交给负责人」 | 不显示按钮 |
| 待批准 | 「批准并定为我方报价」与「退回」 | 「已提交，等负责人批准」 | 「已提交，等负责人批准」 |
| 已批准、是我方报价 | 「已定为我方报价」 | 同左 | 同左 |
| 已批准、不是我方报价 | 「定为我方报价」 | 「已批准，还没定为我方报价」 | 同左 |
| 已中标 / 已被新版替代 / 已作废 | 只写状态名 | 同左 | 同左 |

编辑器 SHALL NOT 再写「提交、批准在专业模式里做」。

#### Scenario: 按钮矩阵
- **WHEN** 分别用有批准权限、只有编辑权限、都没有的视图渲染草稿、待批准、已批准是我方报价、已批准不是我方报价、已中标的逐行报价与总价报价
- **THEN** 主按钮与状态句与上表一致，任何一种里都没有「提交、批准在专业模式里做」（`npx tsx src/components/bid-page-v2/__tests__/quote-actions.test.tsx`）

### Requirement: 编辑器里的另起新版
已批准的报价、看的人有编辑权限时，编辑器的主按钮旁边 SHALL 另有「另起新版」。只有新页面能在页内打开的逐行报价与总价报价有主按钮与「另起新版」；专业模式做的报价照旧在专业模式里提交、批准、另起新版。

#### Scenario: 另起新版按钮
- **WHEN** 渲染已批准的逐行报价：看的人有编辑权限 / 没有
- **THEN** 有 / 没有「另起新版」（`npx tsx src/components/bid-page-v2/__tests__/quote-actions.test.tsx`）

### Requirement: 主按钮不可点的情况
有修改还没保存、引擎算不出、有计入但没填数的行时，「定为我方报价」「批准并定为我方报价」「提交给负责人」SHALL 不可点，并在按钮旁写明原因：
- 「有修改还没保存：先保存或放弃修改」；
- 「报价算不出，先按上面的提示改好」；
- 「还有计入但没填数的行，填完才能提交、批准」。

服务端 SHALL 照样再判：算不出、有计入但没填数的行时返回 409 并写明原因，库里不变。

#### Scenario: 有没保存的修改
- **WHEN** 草稿里改了一个数还没保存
- **THEN** 主按钮不可点，旁边写「有修改还没保存：先保存或放弃修改」（`npx tsx src/components/bid-page-v2/__tests__/quote-actions.test.tsx`）

#### Scenario: 有计入但没填数的行
- **WHEN** 草稿里有一行计入但没填供应商报价，直接调一次定价接口
- **THEN** 409，说明写着有几行计入但没填数；报价仍是草稿，审计与台账都没有新增（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`）

### Requirement: 定为我方报价一次完成提交、批准、选定
有批准权限的人点「定为我方报价」（草稿或已批准没选上的）或「批准并定为我方报价」（待批准）并确认后，系统 SHALL 在一次操作里把报价送到已批准、并把它选为项目的我方报价：
- 草稿走草稿 → 待批准 → 已批准；
- 待批准走待批准 → 已批准；
- 已批准只做选定。

这些 SHALL 在同一个数据库事务里完成，任何一步失败 SHALL 整笔不留：不停在待批准，不出现已批准但没选上。批准时 SHALL 照报价引擎既有的规则同步我方报价指针；同步后指针不是这一份时（项目里已有另一份我方报价，或有几份已批准、没有自动选中），SHALL 在同一事务里改选这一份。改选后原来的我方报价 SHALL 保持已批准、仍可再选。项目的我方报价金额与币种 SHALL 等于这一份的税前报价与币种。对已经是我方报价的已批准报价再调一次 SHALL 返回 200、什么都不改、不写审计。

#### Scenario: 项目里还没有已批准的报价
- **WHEN** 项目里只有这一份草稿，有批准权限的人定为我方报价
- **THEN** 报价是已批准，是我方报价，项目的我方报价金额等于它的税前报价（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`）

#### Scenario: 项目里已有另一份我方报价
- **WHEN** 项目里第 1 份报价已批准并是我方报价，再把第 2 份草稿定为我方报价
- **THEN** 第 2 份是已批准、是我方报价，项目金额换成第 2 份的；第 1 份仍是已批准、在候选里（同一测试）

#### Scenario: 已批准两份、都没选
- **WHEN** 项目里有两份已批准、没有我方报价，对其中一份点「定为我方报价」
- **THEN** 只做选定：这一份成为我方报价，两份的状态都不变（同一测试）

#### Scenario: 我方报价另起新版后定新版
- **WHEN** 我方报价第 1 版另起新版，第 2 版草稿定为我方报价
- **THEN** 第 2 版是我方报价，第 1 版是已被新版替代（同一测试）

### Requirement: 现在的我方报价已中标时不改选
现在的我方报价已中标、且不是这一份时，一次定价 SHALL 返回 409「现在的我方报价第 M 版已中标，这里不改选；要改请在专业模式里做」，SHALL NOT 改任何报价的状态与项目的我方报价；新页面在这种情况下 SHALL NOT 显示「定为我方报价」，改写这句说明。

#### Scenario: 已中标
- **WHEN** 第 1 份已中标并是我方报价，对第 2 份草稿调一次定价接口
- **THEN** 409 与那句说明，第 2 份仍是草稿，指针与金额不变，审计与台账没有新增（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`）

### Requirement: 每一步各留一条记录
一次定价里，每一步状态迁移 SHALL 照报价引擎既有的做法各写一条审计（送审：提交待批准；批准：已批准）和一条项目台账事件；选定 SHALL 写一条「选为我方报价」审计（同步自动选中时由同步写，否则由本次操作写，两者不重复）。从草稿定为我方报价后，审计里这份报价 SHALL 恰好各有一条提交、批准、选定。台账事件 SHALL 与状态迁移在同一事务里写，台账写失败时整笔回滚。审计 SHALL 写明是在标书与报价页做的。改选时，同步的中间结果（清空、跟随到别的报价、刷新原来那一份）随即被改选覆盖，SHALL NOT 另写审计；选定审计里的「之前」SHALL 是操作前的我方报价。审计在事务提交后写，写审计失败不撤回操作（与报价引擎既有做法相同）。

#### Scenario: 审计各一条
- **WHEN** 分别在项目里 0 份、1 份已批准（是我方报价）、2 份已批准没选时，把一份草稿定为我方报价
- **THEN** 三种情况下这份报价都恰好有一条提交、一条批准、一条选为我方报价审计，台账有送审、批准两条事件（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`）

### Requirement: 定之前确认一次
点「定为我方报价」或「批准并定为我方报价」后，页面 SHALL 先显示确认，写明：
- 「{报价合计 / 税前报价} X，定了以后内容锁定，要改需另起新版。」逐行报价写「报价合计」，总价报价写「税前报价」，X 是页面上这份报价现在显示的数。
- 要改选时再写「现在的我方报价是第 M 版（Y），定了以后改成这一份。」

只有点了确认才发请求；点取消 SHALL 什么都不做。

#### Scenario: 确认框的字
- **WHEN** 逐行报价合计 1,200,000.00 加元的草稿点「定为我方报价」；项目里已有第 1 版 1,100,000.00 加元的我方报价
- **THEN** 确认里写「报价合计 1,200,000.00 加元，定了以后内容锁定，要改需另起新版。」与「现在的我方报价是第 1 版（1,100,000.00 加元），定了以后改成这一份。」；点取消没有请求（`npx tsx src/components/bid-page-v2/__tests__/quote-actions.test.tsx`）

### Requirement: 批准的就是看到的那一份
一次定价、提交、退回 SHALL 带读取时的修改时间。一次定价另带确认框里的报价合计，服务端 SHALL 先锁住这份报价，再核对：
- 修改时间不同、状态已变 → 409「这份报价刚被别人改过或处理过，这次没有定」；
- 按库里现在的内容算出的报价合计与带来的数相差超过 0.005 → 409，说法同上。

两种情况都 SHALL NOT 写任何东西。两人通过本页的接口同时对同一份报价操作时 SHALL 只有一个成功；同一项目里两份不同的报价同时一次定价时 SHALL 都成功（后一个改选），SHALL NOT 因互锁返回 500。

#### Scenario: 别人刚改过
- **WHEN** 读视图之后，另一人保存了这份报价，再用旧的修改时间调一次定价接口
- **THEN** 409，报价仍是草稿，审计与台账没有新增（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`）

#### Scenario: 报价合计对不上
- **WHEN** 修改时间对得上，但带来的报价合计比库里算出的多 1 元
- **THEN** 409，库里不变（同一测试）

#### Scenario: 同时点两次
- **WHEN** 同一份草稿并发调两次一次定价
- **THEN** 一个 200、一个 409；审计里提交、批准、选定各一条（同一测试）

#### Scenario: 两份报价同时定
- **WHEN** 同一项目里两份不同的草稿并发各调一次一次定价（连做 4 组）
- **THEN** 都是 200，两份都是已批准，我方报价是其中一份，各自的提交、批准、选定审计各一条（同一测试）

### Requirement: 同步失败时整笔回滚
同步我方报价或改选时写指针、镜像失败，系统 SHALL 回滚整笔操作（状态、台账、指针都不变），写一条同步失败的审计，并返回 500 与中文说明「没有定成：同步我方报价时出错，已经全部撤回，请稍后再试」。

#### Scenario: 同步失败
- **WHEN** 注入同步失败后对草稿调一次定价
- **THEN** 500 与那句说明；报价仍是草稿，台账与指针不变，有一条同步失败审计（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`）

### Requirement: 提交给负责人
只有编辑权限的人点「提交给负责人」，系统 SHALL：
1. 把草稿送到待批准（与报价引擎既有的送审同样检查、同样写一条审计与一条台账事件）；
2. 再给项目负责人发一条站内通知；
3. 页面写明通知结果。

只能从草稿提交；不是草稿 SHALL 返回 409 并写出状态名。提交成功但通知没写成时，SHALL NOT 撤回提交。

#### Scenario: 提交
- **WHEN** 项目操作员（有编辑权限、没有批准权限、有财务查看权）提交一份草稿
- **THEN** 报价是待批准，有一条提交审计和一条送审台账事件，负责人有一条未读通知；页面写「已提交，已通知负责人 {负责人姓名}」（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`）

### Requirement: 给负责人的站内通知
提交时的通知 SHALL：
- 只发给项目负责人，只写一条站内通知；这次操作 SHALL NOT 发邮件或任何对外消息（这条站内通知和其它通知一样，会计入负责人自己的每日未读汇总邮件，那是站内通知的补位）；
- 过收件人的通知设置（关了站内通知或「项目与配置变更」这类通知的不发）；
- 负责人不是这个项目所属组织的在职成员时不发；
- 同一份报价同一次提交只发一条，重试不重复；再次提交（退回后）另发一条。

通知内容：
- 标题：「报价等你批准：{项目名}」；
- 摘要：「{提交人} 提交了「{报价名}」第 N 版，请到「标书与报价」② 批准并定为我方报价，或退回。」
- 点开 SHALL 回到这个项目的「标书与报价」页签，展开 ② 并打开这份报价。

页面 SHALL 按结果写明：
- 已通知负责人 {姓名}；
- 负责人关掉了站内通知或这类通知，没有收到，请直接告诉负责人；
- 项目负责人不是本组织的在职成员，没有人收到通知，请直接联系有批准权限的同事；
- 你就是项目负责人，没有发通知；
- 通知没发出去，请直接告诉负责人。

#### Scenario: 负责人不是在职成员
- **WHEN** 项目负责人是不在本组织成员里的账号，操作员提交
- **THEN** 报价是待批准，没有任何新通知；返回的通知结果是「没有人收到」，页面写明请直接联系有批准权限的同事（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`）

#### Scenario: 负责人关了这类通知
- **WHEN** 负责人在通知设置里关掉了「项目与配置变更」，操作员提交
- **THEN** 没有新通知，返回的结果是「负责人关掉了站内通知或这类通知」（同一测试）

#### Scenario: 点开通知
- **WHEN** 取这条通知的跳转地址
- **THEN** 是 `/projects/{项目 id}?tab=bid#bid-quote-{报价 id}`；新页面打开这个地址时展开 ②（`npx tsx src/lib/bid-page-v2/__tests__/quote-confirm.test.ts`）

### Requirement: 通知与审计不带金额与成本
提交时的站内通知（标题、摘要、附加信息）SHALL NOT 含任何金额、成本、毛利、毛利率、供应商名称或供应商报价。一次定价、提交、退回写的审计 SHALL NOT 含成本、毛利、毛利率与供应商报价；选定审计里 SHALL 只带与既有手动选定相同的我方报价指针、版本、状态、税前报价与币种。另起新版写的审计沿用报价引擎既有的修订审计（不在本能力内改）。

#### Scenario: 通知里没有数
- **WHEN** 税前报价 1,234,567.89 加元的草稿被提交
- **THEN** 这条通知的标题、摘要、附加信息里搜不到 `1234567`、`1,234,567`、`加元` 与供应商名称（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`）

#### Scenario: 审计里没有成本
- **WHEN** 一次定价后读这份报价本次新写的审计
- **THEN** 审计内容里没有成本合计、利润、毛利率的值与键（同一测试）

### Requirement: 退回
有批准权限的人对待批准的报价点「退回」，SHALL 可以写一句原因（最多 500 字，去掉控制字符），确认后报价回到草稿。退回 SHALL 照报价引擎既有的做法写一条审计（带原因）和一条台账事件。只能从待批准退回；不是待批准 SHALL 返回 409 并写出状态名。退回 SHALL NOT 发通知。

#### Scenario: 退回
- **WHEN** 负责人对待批准的报价写「海运费要重新问」并退回
- **THEN** 报价是草稿，审计里有一条带这句原因的记录，没有新通知（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`）

### Requirement: 我方报价一行
新页面 ② 的最上面 SHALL 有一行「我方报价」：
- **已定**：写「我方报价：第 N 版，X 加元，{谁} {何时} 定的」，旁边有「另起新版」（报价是已批准、看的人有编辑权限时）。
  - 谁、何时：这一份最近一次被选为我方报价或跟随新版的人和时间。
  - 没有这条记录时：批准人与批准时间。
  - 都没有时：只写版本与金额。
- **新版待定**：写「我方报价第 N 版已另起新版，新版第 M 版是{草稿 / 待批准}，定了以后才是我方报价」。
- **还没有**：写「还没有我方报价」；有已批准、没选上的时加「已批准 K 份，还没定为我方报价」。

金额 SHALL 与「下一步」汇总用同一个来源（按报价现在的内容用报价引擎算的税前报价）。我方报价是专业模式做的报价时 SHALL NOT 给「另起新版」（在专业模式里做）。

新页面 SHALL NOT 再挂改版前的我方报价卡；改版前的页面与工作台 SHALL 照旧挂它。这一行只给看得到金额的人。

#### Scenario: 已定
- **WHEN** 第 2 版（1,284,000.00 加元）由「张三」于 2026-11-23 10:05（多伦多时间）定为我方报价，渲染 ②
- **THEN** 最上面一行写「我方报价：第 2 版，1,284,000.00 加元，张三 2026-11-23 10:05 定的」与「另起新版」（`npx tsx src/components/bid-page-v2/__tests__/quote-actions.test.tsx`）

#### Scenario: 谁定的取选定记录
- **WHEN** 第 1 份由甲批准，后来由乙在专业模式里手动选为我方报价
- **THEN** 列表接口的我方报价一行写乙和乙选定的时间（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`）

### Requirement: 报价列表带我方报价一行
新页面的报价列表接口（`GET /api/projects/{id}/bid-page/quotes`）SHALL 另返回我方报价一行要的数：状态（已定 / 新版待定 / 还没有）；已定时报价 id、版本、报价状态、税前报价、币种、谁定的、何时定的、做法；新版待定时原来那一份的 id 与版本、新版的 id、版本与状态；还没有时已批准的份数。这些数 SHALL 只经列表接口的金额门（能看内部成本且有财务查看权）返回。

#### Scenario: 列表里的我方报价
- **WHEN** 一次定价后项目负责人读报价列表
- **THEN** 我方报价一行是已定、第 1 版、税前报价 1,200,000、谁定的、何时、做法是只报总价（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`）

### Requirement: 锁定的报价怎么写
新页面上锁定（已批准、已中标、已被新版替代、已作废）的报价，编辑器里的说明与逐行保存、总价保存返回 409 时的说明 SHALL 按状态写：
- 已批准：「这份报价「已批准」，内容锁定；要改请点「另起新版」」；
- 已中标：「这份报价「已中标」，内容锁定；中标以后的事在专业模式里做」；
- 已被新版替代、已作废：「这份报价「{状态}」，内容锁定」。

SHALL NOT 再写「要改请在专业模式里另起新版」。

#### Scenario: 锁定的写法
- **WHEN** 取已批准、已中标、已被新版替代的锁定说明
- **THEN** 与上面逐字一致，都没有「要改请在专业模式里另起新版」（`npx tsx src/lib/bid-page-v2/__tests__/quote-confirm.test.ts`）

### Requirement: 另起新版
已批准报价的「另起新版」SHALL 要求填原因（1–2000 字），确认后把这份报价复制成新一版草稿（与专业模式的修订相同：版本加一、成本行与做法照抄、原来那份若是已批准改成已被新版替代、我方报价进入新版待定）。新草稿是逐行或总价报价时 SHALL 在页内打开，否则打开专业模式。不是已批准的报价 SHALL 返回 409 并写出状态名。

#### Scenario: 另起新版
- **WHEN** 已定的逐行报价第 1 版填原因「招标方要求降价」后另起新版
- **THEN** 有第 2 版草稿，做法仍是逐行报价、成本行相同；第 1 版是已被新版替代；我方报价一行写新版待定（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`）

#### Scenario: 草稿不能另起新版
- **WHEN** 对一份草稿调另起新版接口
- **THEN** 409 并写着「草稿」（同一测试）

### Requirement: 四个接口的守卫与门
四个接口都在 `/api/projects/{id}/bid-page/quotes/{quoteId}/` 下：
- `POST …/confirm`：一次定价，要批准权限；
- `POST …/submit`：提交给负责人，要编辑权限；
- `POST …/return`：退回，要批准权限；
- `POST …/revise`：另起新版，要编辑权限。

每个接口 SHALL 按以下顺序判，判不过就停：
1. 先判报价引擎开关（没开 → 404）、登录（没登录 → 401）与报价权限，级别固定、不看请求体；不够 → 403。
2. 再判新页面开关与招投标项目；不满足 → 404，不读请求体、不碰库。
3. 再判能看内部成本且有财务查看权；没有 → 403。
4. 再校验请求体；格式不对 → 400。

报价不存在或不属于这个项目 SHALL 返回 404。

#### Scenario: 开关关着
- **WHEN** 新页面开关关着，项目负责人对四个接口各调一次
- **THEN** 都是 404，请求体没有被读，库里没有任何变化（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`）

#### Scenario: 没有批准权限的人调一次定价
- **WHEN** 只有编辑权限的操作员调 `confirm` 与 `return`
- **THEN** 403，库里不变；他调 `submit` 是 200（同一测试）

#### Scenario: 没有财务查看权
- **WHEN** 有编辑权限、没有财务查看权的人调 `submit`
- **THEN** 403（同一测试）

#### Scenario: 守卫写法
- **WHEN** 扫描四个处理函数
- **THEN** 第一步都是报价权限守卫，级别分别是批准、编辑、批准、编辑（`npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts`；`npx tsx src/lib/bid-page-v2/__tests__/quote-confirm.test.ts`）

### Requirement: 四个接口只处理新页面的报价
四个接口 SHALL 只处理新页面能在页内打开的逐行报价与总价报价；专业模式做的报价 SHALL 返回 409「这份报价是在专业模式里做的：提交、批准、定为我方报价、另起新版请在专业模式里做」，库里不变。成功 SHALL 返回 200 与新的状态：一次定价还带是不是我方报价、改选了哪一份、本来是不是就是我方报价；提交还带通知结果与说明；另起新版带新草稿的 id、版本与做法。

#### Scenario: 专业模式做的报价
- **WHEN** 对一份专业模式新建的报价调一次定价、提交、另起新版
- **THEN** 都是 409 并写明去专业模式，库里不变（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`）

### Requirement: 新页面不放中标与建项目预算
新页面 SHALL NOT 出现「已中标」「建项目预算」等中标动作的按钮或接口调用；它们 SHALL 留在专业模式。

#### Scenario: 没有中标动作
- **WHEN** 扫描新页面的组件源码
- **THEN** 没有调用中标接口，也没有「已中标」「建项目预算」按钮（`npx tsx src/lib/bid-page-v2/__tests__/quote-confirm.test.ts`）

### Requirement: 开关关着时零变化
开关关着时，改版前的页面、专业模式页面、既有的状态迁移 / 选为我方报价 / 修订 / 我方报价接口 SHALL 与改版前行为相同。专业模式里的提交、批准、退回 SHALL 照旧逐步写同样的审计 action、台账事件与指针同步结果。

#### Scenario: 专业模式的状态迁移
- **WHEN** 用既有状态接口把报价依次送审、批准，再另起新版
- **THEN** 状态、台账事件类型与去重键、审计 action、我方报价指针与改动前的期望逐项相同（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-confirm-db.isolated.test.ts`；`npx tsx src/lib/quote-engine/__tests__/quote-ops-contract.test.ts`；`npx tsx src/lib/quote-engine/__tests__/b3-ledger-producer.test.ts`）

#### Scenario: 改版前的页面
- **WHEN** 开关关着渲染项目的「标书与报价」页签
- **THEN** 与改版前逐字节相同，我方报价卡照旧在（`npx tsx src/components/bid-page-v2/__tests__/bid-page-v2.test.tsx`）
