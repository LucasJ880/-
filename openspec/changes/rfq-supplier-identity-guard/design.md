# Design：询价不再带出招标身份（CHAIN-4b）

## Context

动机见 proposal「Why」。以下是 main `15bb79c` 上与本次有关的现状（只读代码核对）。

**发给供应商的出口一共四处**（`sendGmail` 全部调用点与 `generateProjectDocument` 全部分支逐一看过）：

| 出口 | 现在带出什么 | 位置 |
|---|---|---|
| 询价邮件 `tender.send_rfq` | 标题 `询价：{项目名}`；正文「为项目「{项目名}」采购」；目的地 = 分析地点事实原文（常是精确地址） | `tender-rfq/build.ts:242`、`:290`、`:294` |
| 催单 / 追问 `tender.send_chase` | 标题 = `Re: {原询价标题}`；正文是固定模板，不含项目信息 | `tender-rfq/chase-pure.ts:141-158` |
| 「供应商询价与符合性确认表」（有分析综合结果） | 抬头 h1 项目名，另一行「项目编号 / 采购方 / 投标截止」 | `projects/generate/tender-doc-html.ts:76-84`、`generate-docs.ts:244-258` |
| 「国内供应商询价 PDF」（无综合结果的旧路径）与「供应商技术确认表 PDF」 | `Project: {项目名}`、项目描述，以及项目 AI 上下文的前 1800 / 2000 字——其中有 `客户：`、`标号：`、`预估金额：`、`我方报价：`、`中标价：`（`project-ai-context.ts:130-145`）；`sanitizeSupplierFacing` 只换掉「预算 / 利润 / 毛利 / 内部成本 / 竞争对手 / 竞品 / 客户电话 / 客户邮箱」，这几项原样留下 | `generate-docs.ts:280-358`、`:407`；`pdf-common.ts:25` |
| 「国内供应商简报（China Brief）」 | `Procuring agency (public): {采购方}`；`Delivery timing: {截标日}`（截标日被当成交期）；`Source documents: {文件名}`（文件名常含编号）；自动挑选的情报事实 | `bid-workflow/china-supplier-brief.ts:76-88` |

另两处供应商相关的旧接口（询价明细的「生成邮件 / 单封直发」）已返回 410，不在出口之列；项目「问题」的发送是发给采购方的，也不在此列。

**询价生成流程**：网页送审、Muse `rfq`、自动起草都进 `prepareRfqRound`（`service.ts:105`）→ `buildRfqDocument`（纯函数）→ 每家 `renderRfqEmail` → 载荷 `items[].subject/body` 与 `rfqDocHash` → 审批卡。询价入口（`web-entry.ts:175`）用同一个 `buildRfqDocument` 在内存里预构建，判定「能不能发」；自动起草的判定读入口状态（`auto-draft-service.ts:109`），建轮次失败时除 `ROUND_LOCKED` 外一律记 `DRAFT_FAILED`（`:132`）。执行器 `execTenderSendRfq` 只比对哈希，不看内容（`execute.ts:31-33`）。审批卡 72 小时过期（`service.ts` `ttlHours: 72`）。

**身份信息在哪**：`Project.solicitationNumber / clientOrganization / name / closeDate`；分析 `summaryJson.criticalFacts` 的槽位（`buyer`、`tender_number`、`project_title`、`closing_datetime`、`location`…，`tender-understanding/contract.ts:90-114`），槽位是文本或指向 `TenderAnalysisFact` 的 id（`round-pure.ts:151-163`），事实行的 `contentOriginal` 是模型给出的原值（`rawValue ?? claim`，`v2-map.ts:204`）。**关键事实里没有采购方联系人槽位**（任务书「不确定处」要求核对的一项）。

**依赖不变的格式**：回信解析从已发正文里取 `- 数量：` 行与 `【强制】{编号}`（`inbound-contract.ts:102-110`）；催单模板指纹用固定样例 `询价：示例项目` 渲染（`chase-pure.ts:165-195`），与真实标题无关。

**要求原文不能编辑**：审核只有确认 / 驳回（`tender-auto-analysis/review.ts:392-417`），询价抽屉也不能按轮挑要求。

## Goals / Non-Goals

**Goals**
- 四个供应商侧出口全部经同一套禁出清单与格式检查；询价邮件在送审时与发送前各查一次。
- 对供应商的称呼与目的地由构造保证不带身份（模板里根本不写项目名与精确地址），扫描是第二道。
- 合并即对所有组织生效，含上线时已在待批的旧卡。

**Non-Goals**（具体到文件）
- `src/lib/tender-rfq/chase-pure.ts`（模板、样例、指纹）、`chase-execute.ts`、`chase-service.ts`：不改。
- `src/lib/google-email.ts`、附件（CHAIN-4a）：不改。
- `src/lib/bid-workflow/china-supplier-brief.ts` 的 `SENSITIVE_PATTERNS`、`assertNoForbiddenLeak`，`src/lib/projects/generate/pdf-common.ts` 的 `sanitizeSupplierFacing`：内容不改（任务书：既有敏感词表不改）。
- `src/lib/projects/project-ai-context.ts`：不改（它服务 AI 对话，问题出在把它拼进供应商文件）。
- `src/lib/muse-bridge/**`、`src/lib/pending-actions/**`、`src/lib/approval/**`、`prisma/schema.prisma`、`vercel.json`、`openspec/config.yaml`：不改。
- 内部文件的生成（`tender-doc-html.ts` 的 `buildInternalDecisionMemoHtml`、`tender-analyst-memo/**`、`rfi-export.ts`、`tender-bid-draft/**`）：不改。
- 询价抽屉界面（`src/components/inquiry/**`）：不改；新原因的文案经既有的入口状态字段显示。

## Decisions

### D1 禁出清单 = 纯函数 + 一个只读加载器，四个出口共用

- `src/lib/bid-workflow/project-identity-deny.ts`（纯函数）：`buildProjectIdentityDenyList(sources)` 产出 `{ category, normalized, cjk }[]`；`scanIdentity(denyList, segments, opts)`，`segments` 为 `{ where: string; text: string; authored: boolean }[]`，返回命中 `{ category, where }[]`（不带原文）；另含 `rfqReference(...)`、`cityLevelDestination(...)`、`scanOutboundRfqEmail(...)`（标题 + 正文的复查，D7 用）。不读环境变量、不访问数据库。
- `src/lib/bid-workflow/project-identity-sources.ts`（只读）：一次读项目（名称、编号、采购方、截标、创建时间、组织代码与设置）与当前可用分析的五个关键事实槽（`factId` 槽批量查 `TenderAnalysisFact`），产出 `sources`、询价编号与我方允许出现的邮箱（`readTenderRfqSettings` 的 `fromEmail` / `mailboxEmail`）。
- 调用方：`prepareRfqRound` 与 `web-entry` 预构建（把清单传进 `buildRfqDocument`）、`execTenderSendRfq`、`generateProjectDocument` 的供应商侧分支。
- 否决「每个出口各写一套」：四处规则一旦不同步，就会有一处漏；否决「放进既有敏感词表」：那张表是全局固定词，本清单是每个项目不同，且任务书要求不改既有表。

### D2 `buildRfqDocument` 的身份入参为必填

新增必填入参 `identity: { denyList, allowedEmails, reference }`；`RfqDocument` 去掉 `projectName`、加 `reference`。必填让任何调用方（含将来的）在类型层面跳不过防护；去掉 `projectName` 让渲染函数无从印出项目名。`RfqBuildResult` 新增 `{ ok: false, errorCode: "IDENTITY_LEAK", hits }`；检查顺序：既有出站敏感词在前（spec「命中即整份失败」最后一个场景），身份在后。
- 否决「可选入参、缺省不查」：等于留了一个开关；否决「扫描放在 service 层」：入口预构建与送审就会各自实现一遍。

### D3 比对：同一规整 + 整词序列

规整：NFKC → 小写 → `&` 换 ` and ` → 非字母数字换空格 → 合并空格。词条同样规整；不含中日韩文字的词条在「两端补空格的文本」里找「两端补空格的词条」，含中日韩文字的直接找子串。采购方另加 `normalizeBuyerName` 的结果作第二条（倒装、冠词），复用 `corporate-memory/normalize.ts`，不另写一套。
- 否决「模糊相似度」：误杀不可控，且与 T3「禁止模糊相似度参与身份判定」的既有纪律相反；否决「只比原文字面」：`24062/27/057`、大小写、逗号都会漏。

### D4 格式检查的正则写死在纯函数里

邮箱：常规 `local@domain.tld`，允许名单是本组织询价设置的 `fromEmail` 与 `mailboxEmail`（不分大小写）。电话：北美（`(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}`，两侧不得紧邻数字）、`+` 开头且合计 ≥ 8 位的国际号码、`1[3-9]\d{9}`（两侧不得紧邻数字）。测试里钉住不误判的样例：`CAN/CGSB-4.162-2015`、`ISO 9001:2015`、`1200 x 600 x 25 mm`、`24062-27-057`、`5-2-3` 段式编号。任务书说「签名除外」：现在的签名只有我方抬头文字，没有号码，所以电话没有允许名单。
- 否决「电话也按我方号码放行」：组织设置里没有一个确定的「我方电话」字段，猜一个反而开口子。

### D5 中性询价编号 = 组织代码 + 项目创建年份 + 由项目 id 定的 5 位码

`RFQ-{ORG}-{YYYY}-{CODE}`：`ORG` 取 `Organization.code` 第一段字母数字转大写（如 `sunny-home-deco` → `SUNNY`），最多 8 个字符，空则 `QY`；`YYYY` 取项目创建时间在组织时区（`resolveOrgTimezone`）的年份；`CODE` = `sha256("rfq-ref:" + projectId)` 取 Crockford base32 前 5 位（去 I/L/O/U）。同一项目任何时候、任何出口算出来都一样，执行器与 CHAIN-4a 的附件可以独立重算，不需要存。
- 否决任务书例子里的「组织内年度序号（031）」：零 schema 下没有地方存序号；现算（按创建时间排名）在并发起草时会算出重号，项目被删后之后的排名会整体错位，已发出的编号与重算的对不上。
- 否决「编号后接品类（· 户外睡袋及睡垫）」：任务书说品类取自确认要求的类别，但要求类别是 `PRODUCT / TECHNICAL / DELIVERY…` 这类通用分类，取不出品类；`Project.category` 是 BidToGo 带来的自由文本，可能就是招标的采购类目，不能保证不带身份。货品内容本来就在正文的规格清单里。见 Q1。

### D6 目的地只取城市级或人工填写

`destination = 人工填写 ?? cityLevelDestination(地点事实)`；地点事实的取用沿用现有置信度规则（已人工确认 / HIGH / VERIFIED，`build.ts:140-145`）。城市级取法：在地点原文里找 `城市, 省`，省为加拿大 13 个省 / 地区的两字母代码或英文全称（如 `Ottawa, ON`、`Edmonton, Alberta`），取最后一处；找不到就不写目的地。现在把地点原文原样印出（`build.ts:242`）的做法去掉。人工填写的目的地照样过扫描（照抄精确地址会命中交货地址）。
- 否决「仍印原文，靠清单拦」：地点原文自己就在清单里，等于每个有地址的标都会失败；否决「完全不写目的地」：DDP / DAP 报价需要知道送到哪个城市。见 Q3。

### D7 扫描范围：项目名称只查我方撰写的部分

`segments[].authored` 区分两种文本：我方撰写（询价编号所在的标题与介绍句、固定模板、人工填写的栏目、生成文件抬头与固定文字、China Brief 编辑备注）与招标文本（要求原文与译文、交付要求事实、China Brief 自动挑选的事实）。项目名称类词条只查 `authored: true`；其余四类与格式检查全查。送审时在 `buildRfqDocument` 里按字段逐段扫描（位置可以精确到要求编号）；渲染完每一家的邮件后再用 `scanOutboundRfqEmail` 复查一次（四类 + 格式检查查标题与正文，项目名称只查标题），兜住模板将来被改坏的情况。
- 否决「项目名称也查要求原文」：招标标题经常就是货品名（`Sleeping Bags and Mats`），要求原文必然出现同样的词，几乎每个这类标都会整单失败；而这几个词本身不指向某一个招标。见 Q2。

### D8 命中时的出路与文案

| 出口 | 错误码 / 原因 | 文案 | 出路 |
|---|---|---|---|
| 询价入口 | `identity_leak`（优先级在 `sensitive_leak` 之后） | 询价内容含招标身份信息（命中：{类别}·{位置}），本轮整单不发。 | 去「需求」检查 |
| 网页送审 | `IDENTITY_LEAK`，422 | 命中在人工栏目时「你填的{栏目}里含招标身份信息（命中：{类别}）」无出路；否则同入口 | 同入口 |
| 自动起草 | `IDENTITY_LEAK`，`quiet: false`（`auto-draft-service.ts:132` 把送审返回的这个码原样映射，不再记成起草失败） | 同入口 | 同入口 |
| Muse `rfq` | `VALIDATION_FAILED`（`router.ts` 既有映射，不改代码） | 同入口 | — |
| 生成文件 | 抛出专用的身份命中错误；`generate-pdf` 路由认出它返回 422 + `errorCode: "IDENTITY_LEAK"`（其它错误仍按既有处理返回 500） | 「供应商侧文件含招标身份信息（命中：{类别}·{位置}），未生成。」 | — |

多处命中时按出现顺序列出，最多列 3 处，再多写「等 N 处」。不复述命中原文：入口与送审的说明会经 Muse 回给人，也会进审计，原文没有必要再多走一遍。

### D9 发送前复核：防护标记 + 重扫

`TenderSendRfqPayload` 加 `identityGuard: 1`（新建卡才有；不进 `rfqDocHash`，哈希保护的是邮件内容本身）。`execTenderSendRfq` 在哈希比对之后、发第一封之前：没有标记 → `RFQ_IDENTITY_UNGUARDED`；有标记 → 用 D1 的加载器按执行时的资料重建清单，逐家 `scanOutboundRfqEmail`，任一家命中 → `RFQ_IDENTITY_LEAK`。两种都整张卡拒发、零发信、询价项状态不动。催单卡不复核：它们回在供应商已有的线程里，标题沿用已发出的原标题，复核只会把上线前的轮次的催单全部卡死，而不会少泄露任何东西。
- 否决「只靠 72 小时过期」：上线那一刻待批的卡批了就会照旧发出；否决「旧卡也按内容重扫」：旧卡的标题与正文必然含项目名，结论只会是拒发，不如直接按标记判，说明也更清楚。见 Q6。

### D10 供应商侧生成文件

- `tender-doc-html.ts`：`TenderDocHeader` 加 `audience: "internal" | "supplier"` 与 `reference`；`headerBlock` 在 `supplier` 时只出文件名称、询价编号与生成日期。`buildSupplierRfqHtml` 用 `supplier`，内部备忘录不变。
- `generate-docs.ts`：`supplier_rfq` 两条路径与 `tech_confirm` 不再读 `ctx`、`project.name`、`project.description`；旧路径的正文只剩固定模板（改为以询价编号开头），末尾拼的 `Project: {项目名}` 只对内部文件保留。生成前把 HTML 去标签后整份交给 `scanIdentity`（模板与抬头 `authored: true`，综合结果里的要求文字 `authored: false`）。China Brief 的预览与生成同一个函数，所以预览就能看到失败原因。
- `china-supplier-brief.ts`：`ChinaBriefInput` 去掉 `clientOrganization`、`closeDate`、`documentTitles`，加 `identity`；第 1 行改为询价编号；事实挑选在既有过滤之后再加一条「命中身份或格式检查的整行不收」；编辑备注命中即抛错。`SENSITIVE_PATTERNS` 与最终的 `assertNoForbiddenLeak` 原样保留，身份检查排在它们之后。
- 否决「旧路径没有综合结果就拒绝生成」：会让一个能用的空白模板直接消失；固定模板 + 询价编号仍可用。否决「China Brief 自动挑选的事实命中就整份失败」：事实是系统挑的，不是人写的，整份失败会让多数项目生成不了；它现有的做法就是按行过滤敏感事实，这里沿用。见 Q4、Q5。

## 与八条硬纪律的关系

1. 零 schema：遵守。只多一个载荷键 `identityGuard`（`PendingAction.payload` 既有 JSON 位）；询价编号现算不存。
2. 出站先审批：遵守且更严——送审时多一道拦截，执行时多一道复核；不新增任何发送路径。
3. 不新增队列 / cron：不涉及。全部是同步检查。
4. 脱敏：触碰。本次正是加强对供应商侧的脱敏，并顺带堵住旧路径把预估金额、我方报价、中标价带给供应商的口子；Muse 通道的脱敏规则不变（Muse 回给人的失败说明不复述命中原文）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。发件仍走 `resolveSender`；允许出现在正文里的邮箱取组织设置的 `fromEmail` / `mailboxEmail`，不从载荷取。
7. 确定性优先：遵守。全部是查表与正则，零新增模型调用（`project-identity-deny.test.ts` 源码断言防护模块不引用任何模型客户端）。
8. 测试注册：遵守。两个新测试注册进 `scripts/test-all.sh`（纯函数测试同时进 `scripts/test-ci-unit.sh`）；`china-supplier-brief.test.ts` 本次改动，顺带注册并从 `ci/test-registry-baseline.txt` 删掉（基线只减）。

## 验证方式

- 纯函数：`npx tsx src/lib/bid-workflow/__tests__/project-identity-deny.test.ts`（清单、派生、比对、格式检查与不误判样例、询价编号稳定且不同项目不同、城市级目的地、源码断言：不读环境变量、不引用模型客户端）。
- 询价单：`npx tsx src/lib/tender-rfq/__tests__/build.test.ts`（原有用例按新标题改写；新增要求含采购方 / 地址 / 邮箱 / 电话、项目名称只查我方撰写部分、目的地两种情形、敏感词优先）。
- 文案：`web-entry-pure.test.ts`（八种原因优先级、`IDENTITY_LEAK` 转人话）、`auto-draft-pure.test.ts`（新原因）。
- 生成文件：`tender-doc-html.test.ts`（对外抬头、内部备忘录照旧、改前抬头夹具被拦、旧路径源码断言）、`china-supplier-brief.test.ts`（三行去掉、事实整行不收、编辑备注失败）。
- 隔离库：`npx tsx src/lib/tender-rfq/__tests__/supplier-identity-guard-db.isolated.test.ts`（联邦标夹具经网页送审：标题与正文不含编号 / 采购方 / 项目名 / 截标日；要求含采购方 → 422、零轮次零卡；两轮同编号；执行无标记的卡与资料变化后的卡 → 拒发、假发信函数 0 次）；`stage-auto-db`、`followup-auto-db` 补标记后照旧通过。
- 全量：`npm test`、`npm run typecheck`、`npm run lint:baseline`、`scripts/check-test-registry.sh`、`openspec validate rfq-supplier-identity-guard --strict`；`git diff --stat main -- prisma/schema.prisma vercel.json` 为空。

## Risks / Trade-offs

- [交付类要求原文常写着采购方名称或交货地址，整单失败的频率可能不低；要求原文不能编辑，询价抽屉也不能按轮挑要求] → 失败说明精确到要求编号；出路是驳回那一条（它就不进询价单）或手工发询价。报告里用联邦与 Alberta 各一个真实标包实测命中率；高的话另立「本轮不带这几条」的小 change（Q7）。
- [清单只认项目与分析里写明的值：缩写（TBS）、另一种语言（SCT、中文译名）、部分名称（只写 Treasury Board）查不出] → 模板由构造保证不带这些；剩下的只可能出现在要求原文里，属于已知限制，写进报告。分析没跑出采购方 / 编号事实、项目字段也空着时，清单是空的，只剩格式检查。
- [电话正则误判型号或编号] → 正则要求北美号码的固定分段与两侧非数字，测试钉住常见标准号与尺寸；误判时说明写明「电话号码·要求 R-xx」，人能一眼看出。
- [项目名称只查我方撰写的部分，招标要求里若整段抄着招标标题会被发出去] → 招标标题本身不带编号与机构名；带编号的由招标编号类兜住。这是刻意的取舍（D7、Q2）。
- [上线时已在待批的询价卡全部拒发] → 卡上说明直接写「请驳回后重新起草」；自动起草开关现在默认关，待批的只有人在网页上起草的卡，影响面小。
- [China Brief 少了采购方一行，工厂端少一点背景] → 这一行正是任务书要堵的东西；产品与技术事实照旧在。

## Migration Plan

- 合并即生效，无开关、无迁移、无数据回填。
- 上线后：CHAIN-0 第 7 项的三个询价开关可以开（任务书「上线顺序」第 2 步）。
- 回滚：回退本 PR 即恢复原行为；本次新增的载荷键 `identityGuard` 对旧代码无影响（执行器不读它），回滚后用新卡也能照旧发。

## 审核关注点（偏离或补充任务书之处，请拍板）

| # | 问题 | 推荐 |
|---|---|---|
| Q1 | 判断点 6 的编号落成 `RFQ-SUNNY-2026-7KQ4M`（项目 id 定的 5 位码），不是任务书例子里的年度序号 `031`，也不接品类（D5：序号零 schema 下会重号、会错位；要求类别取不出品类） | 按 D5 |
| Q2 | 项目名称 / 招标标题只在我方撰写的部分比对，不在招标要求原文里比对（D7）。任务书把项目名称列进清单但没说范围；全查会让货品名式的标题几乎每次整单失败 | 按 D7 |
| Q3 | 目的地改为「城市, 省」或人工填写，分析里的精确地址不再印进询价（D6）。任务书把「询价单的 destination」列为交货地址词条，照字面做会和目的地自己冲突 | 按 D6 |
| Q4 | 纳入任务书没列的两个供应商侧文件：「供应商技术确认表」与 China Brief；并且「国内供应商询价」旧路径与技术确认表**不再拼接项目 AI 上下文**——这是核对时发现的现存泄露，会把预估金额、我方报价、中标价印给供应商（Context 表第 4 行） | 纳入 |
| Q5 | China Brief 自动挑选的事实命中时整行不收（沿用它按行过滤敏感事实的现有做法），编辑备注命中才整份失败；任务书的「命中即失败」照字面会让多数项目生成不了 | 按 D10 |
| Q6 | 执行器复核：上线前起草的卡一律拒发，新卡发前按当时资料重扫（D9）。任务书没写，不做的话上线时已在待批的卡批了照旧带项目名发出 | 做 |
| Q7 | 命中只能整单失败、要求原文改不了，出路是驳回那条要求或手工发；「本轮不带这几条」不在本次，先看实测命中率 | 接受，报告里实测 |
