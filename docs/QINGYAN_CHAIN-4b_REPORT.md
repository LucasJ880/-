# CHAIN-4b 报告 — 询价不再带出招标身份（`rfq-supplier-identity-guard`）

| 项 | 值 |
|---|---|
| TASKFLOW | CHAIN-4b（Phase F（续）— 情报串联） |
| 任务书 | `docs/QINGYAN_CHAIN_TENDER_INTEL_CHAIN_TASKBRIEF.md` |
| OpenSpec change | `openspec/changes/rfq-supplier-identity-guard/`（新能力 `tender/supplier-identity-guard`，改 `tender/rfq-web-entry` 两条） |
| 基线 | main `15bb79c`（2026-11-16） |
| 拍板 | 四件套「审核关注点」Q1–Q7 全部按推荐（Lucas 2026-11-19「按照你推荐的做」） |
| 开关 | 没有。合并即对所有组织生效 |

## 1. 做了什么

| 出口 | 以前 | 现在 |
|---|---|---|
| 询价邮件（`tender.send_rfq`）标题 | `询价：{项目名}（第 N 轮）— 请于 … 前回复` | `询价 RFQ-SUNNY-2026-7KQ4M（第 N 轮） — 请于 … 前回复` |
| 询价邮件正文介绍 | `{我方抬头} 正在为项目「{项目名}」采购，请按以下清单报价。` | `{我方抬头} 现就询价 {询价编号} 邀请贵司报价，请按以下清单逐项回复。` |
| 目的地 | 分析地点事实原文（常是门牌 + 街道 + 邮编） | 人工填写的；没填时取地点里的「城市, 省」；都没有就不写 |
| 送审（网页 / Muse / 自动起草） | 只拦内部敏感词 | 敏感词之后再查本项目禁出清单 + 邮箱 / 电话格式；命中即不建轮次、不建卡，说明写类别·位置 |
| 询价入口 | 7 种不可发原因 | 8 种：`sensitive_leak` 之后加 `identity_leak` |
| 自动起草 | 送审失败一律记「起草失败」 | 身份命中记 `IDENTITY_LEAK`，说明与入口同一句 |
| 执行发询价卡 | 只比哈希 | 发第一封之前复核：没有防护标记的旧卡拒发（`RFQ_IDENTITY_UNGUARDED`）；有标记的按当时资料重扫，命中整张拒发（`RFQ_IDENTITY_LEAK`）；两种都零发信 |
| 「供应商询价与符合性确认表」 | 抬头 h1 项目名 + 「项目编号 / 采购方 / 投标截止」 | 抬头只有文件名、询价编号、生成日期；生成前逐段查 |
| 「国内供应商询价 PDF」（无综合结果的旧路径）、「供应商技术确认表 PDF」 | `Project: {项目名}`、项目描述、项目 AI 上下文前 1800 / 2000 字（含标号、客户、**预估金额、我方报价、中标价**） | 只有固定模板 + 询价编号 |
| 「国内供应商简报（China Brief）」 | 印采购方、截标日期（标成交期）、源文件名 | 三行去掉；第 1 行改询价编号；自动挑选的事实命中整行不收；编辑备注命中整份不生成 |
| 生成接口 `POST …/generate-pdf` | 任何错误 500 | 身份命中 422 + `errorCode: "IDENTITY_LEAK"` |
| 内部决策备忘录、分析师备忘录、RFI、投标文件起草、同事任务单 | — | 不变 |

禁出清单五类：招标编号（含编号片段）、采购方名称（含倒装 / 冠词规整）、截标日期（组织时区，六种写法）、交货地址（加拿大邮编两种写法、门牌号开头的街道段、含其一时的整段原文）、项目名称 / 招标标题。来源是项目字段 + 当前可用分析的五个已知关键事实。规整后不足 4 个字符的不收。项目名称只在我方撰写与人工填写的部分查，招标原文不查（Q2）。

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/bid-workflow/project-identity-deny.ts`（新） | 禁出清单、规整与整词比对、邮箱 / 电话格式检查、分段扫描、询价编号、城市级目的地、发出邮件复查、`SupplierIdentityLeakError`。不读环境变量、不访问数据库 |
| `src/lib/bid-workflow/project-identity-messages.ts`（新） | 类别名称、命中类型、四种说明文字。不依赖 Node（询价入口与自动起草的纯函数会被浏览器端组件引用） |
| `src/lib/bid-workflow/project-identity-sources.ts`（新） | 只读加载器：项目字段、组织代码与时区、询价设置的两个邮箱、分析的五个关键事实槽 |
| `src/lib/tender-rfq/build.ts` | 必填 `identity` 入参；`RfqDocument` 去掉 `projectName`、加 `reference`；标题与介绍句；目的地；`IDENTITY_LEAK` |
| `src/lib/tender-rfq/service.ts`、`types.ts` | 读来源、传清单、渲染后逐家复查（建轮次之前）、载荷 `identityGuard: 1`、`IDENTITY_LEAK` |
| `src/lib/tender-rfq/execute.ts` | 发送前复核 |
| `src/lib/tender-rfq/web-entry.ts`、`web-entry-pure.ts` | 入口预构建用同一加载器；`identity_leak` 原因；`IDENTITY_LEAK` 转人话（人工栏目说「你填的…」） |
| `src/lib/tender-rfq/auto-draft-pure.ts`、`auto-draft-service.ts` | `IDENTITY_LEAK` 原因（第 11 个）；送审返回的这个码原样映射 |
| `src/app/api/projects/[id]/tender-rfq/rounds/route.ts` | `IDENTITY_LEAK` → 422，带命中位置 |
| `src/lib/projects/generate/tender-doc-html.ts` | `SupplierDocHeader`（只有询价编号与生成日期）、对外抬头、`supplierRfqScanSegments`、`htmlToText` |
| `src/lib/projects/generate/generate-docs.ts` | 供应商侧三类不读 `ctx` / 项目名 / 描述；生成前查；内部文件不变 |
| `src/lib/bid-workflow/china-supplier-brief.ts` | 输入改为询价编号 + 禁出清单；去三行；事实整行不收；编辑备注命中抛错。`SENSITIVE_PATTERNS`、`assertNoForbiddenLeak` 未改 |
| `src/app/api/projects/[id]/generate-pdf/route.ts` | 身份命中 422 |
| 测试 | 新 `project-identity-deny.test.ts`、`supplier-identity-guard-db.isolated.test.ts`、夹具 `projects/generate/__tests__/fixtures/supplier-rfq-before-chain-4b.html`（在改前代码上生成）；改 `build.test.ts`、`web-entry-pure.test.ts`、`auto-draft-pure.test.ts`、`tender-doc-html.test.ts`、`china-supplier-brief.test.ts`、`stage-auto-db.isolated.test.ts`（5 个载荷补标记）、`supplier-groups-db.isolated.test.ts`（见 §3） |
| `scripts/test-all.sh`、`scripts/test-ci-unit.sh`、`ci/test-registry-baseline.txt` | 注册 3 个测试；`china-supplier-brief.test.ts` 从历史欠账基线删除（67 → 66） |

## 3. 实施中与四件套的出入（都已同步到 design / spec / tasks）

1. **说明文字拆成单独文件**。`web-entry-pure.ts` 与 `auto-draft-pure.ts` 被询价抽屉、分析面板等浏览器端组件引用，而禁出清单要用 `node:crypto` 算询价编号。说明文字放进不依赖 Node 的 `project-identity-messages.ts`，由禁出清单模块原样再导出（design D1）。
2. **供应商询价表的抬头用单独的类型**，不是给 `TenderDocHeader` 加可选的 `audience`：可选字段挡不住将来有人把项目名传进来（design D10）。
3. **分段标记是三种**（`authored` / `human` / `tender`），不是布尔值：人工栏目命中时说明要换成「你填的…」（design D1、D7）。
4. **spec 里命中说明的写法统一为「类别·位置」**。原稿两个场景写成「采购方名称（要求 R-02）」，与入口说明「（命中：…）」嵌套括号；改为「命中：采购方名称·要求 R-02」。
5. **`followup-auto-db.isolated.test.ts` 没有改**：它不执行发询价卡，用不到防护标记（tasks 3.1 原写要补）。
6. **自审后补的两处**：生成文件抬头的生成日期不参与比对（截标当天生成会误拦）；北美电话要求区号与局号首位为 2–9（`100-123-4567` 这类编号不再误判）。spec 两条同步改写，「供应商侧生成文件」拆出一条「供应商侧文件命中时不生成」（strict 校验的长度限制）。
7. **`/opsx:verify` 时补的两处**：spec 说项目名称也要在「正文里由模板写的句子」里查，送审时原来只查了标题与我方填入的变量——补上「招标原文留空再渲染一遍，模板句子按我方撰写查」；生成接口 422 与「写文件之前抛出」补了源码断言（`tender-doc-html.test.ts` 21 → 23）。
8. **开 PR 后的交叉审查**（`/code-review high`，按 diff 独立看一遍，7 条）：
   - 已修 3 条：编号事实里日期样的片段不再当招标编号；问候语「{供应商名} 您好：」不参与复查（某家供应商名里含采购方全名时不再误拦）；旧路径「国内供应商询价」里给内部看的「Hide: customer budget, our margin…」一行删掉（这一行原样印给工厂，是既有问题）。`project-identity-deny.test.ts` 66 → 69。
   - 不改 4 条：重放已发出的卡时复核排在「此前已发」之前（两种结果都不发信）；回复截止恰等于截标日（既有规则，见 §7）；模板句子检查没有单独测试（变量部分都已在 build 测试覆盖）；很短的中文项目标题可能撞上模板里的固定中文（改「不足 4 字不收」会偏离任务书，记为 §7 限制）。
9. **`supplier-groups-db.isolated.test.ts` 一条断言调整**：它比较两个同名项目的邮件「逐字相同」，以前标题都是项目名所以相同；现在每个项目有自己的询价编号（这正是 spec 要求的）。改为先把各自的编号换成同一占位再比，原意（按分组起草与手动勾选的内容一样）不变。

## 4. 测试（开工前 → 结束）

| 测试 | 开工前 | 结束 |
|---|---|---|
| `bid-workflow/__tests__/project-identity-deny.test.ts`（新） | — | 69 |
| `tender-rfq/__tests__/build.test.ts` | 31 | 46（新增身份用例先在 main 的 `build.ts` 上跑：在第一条新断言处失败；换回新代码全部通过） |
| `tender-rfq/__tests__/web-entry-pure.test.ts` | 151 | 158 |
| `tender-rfq/__tests__/auto-draft-pure.test.ts` | 63 | 66 |
| `projects/generate/__tests__/tender-doc-html.test.ts` | 10 | 23 |
| `bid-workflow/__tests__/china-supplier-brief.test.ts` | PASS（断言式，未注册） | PASS（新增 1 组），已注册 |
| `tender-intel/__tests__/analyst-memo-v1.test.ts` | 18 | 18（AM-16c 改为不认编号，见 §5） |
| `pdf/__tests__/cjk-pdf.test.ts` | 11 | 11 |
| `muse-bridge/__tests__/muse-bridge-pure.test.ts` | 75 | 75（未改断言） |
| `tender-rfq/__tests__/round-pure.test.ts` | 34 | 34 |
| 隔离库 `supplier-identity-guard-db`（新） | — | 21 |
| 隔离库 `stage-auto-db` | 48 | 48（补标记后） |
| 隔离库 `followup-auto-db` | 28 | 28 |
| 隔离库 `supplier-groups-db` | 53 | 53 |
| 隔离库 `auto-draft-db` | 75 / 76 | 75 / 76（同一条，见下） |
| 隔离库 `tracker-db` / `analysis-update-note-db` / `rfq-timing-settings-db` / `settings-form-db` | — | 46 / 15 / 36 / 24，全过 |

**`auto-draft-db` 那 1 条在改之前的 main 上就失败**（「关闭之前已批准的那一轮：间隔到了照常自动发第 2 次催单」，`autoSent: 0`）。它在 RFQ-AUTO-3 的催单扫描路径上，本次没有碰催单代码；改前改后都是同一条、同样的输出。没有在这里修，记为既有问题。

隔离库在本机：Postgres 16 + pgvector，`prisma migrate deploy` 全部迁移；`JWT_SECRET` 用测试值。

## 5. 门禁

| 项 | 结果 |
|---|---|
| `npm test`（含隔离库） | 690 / 701，11 项失败：1 项本次引起已修，9 项 main 上同样失败，1 项与顺序有关（见下） |
| `npm run test:ci` | `CI unit subset PASS` |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（error 53 → 38，无新增指纹）；改动的 25 个 TS 文件直接跑 ESLint 无输出 |
| `bash scripts/check-test-registry.sh` | 通过：已注册 668 个，历史欠账 66 条 |
| 运行时架构守卫（`scripts/test-runtime-architecture.sh`，在 `npm test` 里） | 全过 |
| `openspec validate rfq-supplier-identity-guard --strict` | 通过 |
| `git diff main -- prisma/schema.prisma prisma/migrations vercel.json` | 空 |
| `src/lib/muse-bridge/**`、`src/lib/pending-actions/**`、`chase-pure.ts`、`google-email.ts`、`openspec/config.yaml`、`.claude/launch.json` | 无 diff |
| 新增模型调用 | 无（`project-identity-deny.test.ts` 源码断言） |

全量结果（本机，带隔离库，`npm test`）：**`测试结果: 690/701 通过, 11 失败`**。逐项核对：

| 失败的测试 | 结论 |
|---|---|
| 分析师备忘录 v1（`tender-intel/__tests__/analyst-memo-v1.test.ts`，AM-16c） | **本次引起**：它钉住 China Brief 的字面编号 `9b) Compliance evidence`，本次去掉两行后重新编号成 `8)`。改为只认清单本身（不认编号），之后 18 / 18 |
| 来信观察 DB（MAIL-2）、Sunny 工艺单 DB、Phase3A-3 Approvals Smoke、Phase3A-4 Governance Smoke、Phase3A-4 Acceptance、Phase3A-5 Overview Acceptance、T4 授标情报真实 Postgres 矩阵（16 / 2）、Quote Operations 客户报价 PDF 分页布局、招标询价自动起草 DB（75 / 76） | **既有**：在没改过的 main `15bb79c`（单独的 worktree、同一个隔离库）上逐个重跑，失败相同 |
| Autopilot A2-P0 Isolated E2E（`permanent A2 failure reaches outbox DEAD`） | **与顺序有关**：全量里 95 / 96；单独跑在本分支与 main 上都是 96 / 96。它读写自动驾驶的发件箱，与本次无关 |

全量是在 §3 第 6、7 条与 AM-16c 修正之前开跑的；这几处改动涉及的测试（`project-identity-deny`、`build`、`tender-doc-html`、`analyst-memo-v1`、隔离库 `supplier-identity-guard-db` / `supplier-groups-db` / `auto-draft-db` / `stage-auto-db`）改完后都单独重跑过，结果见 §4；`npm run test:ci`（CI 跑的子集，不带数据库）在改完后跑：`CI unit subset PASS`。

## 6. 真实标包实测 —— 没做，需要 staging

tasks 5.1 要求用联邦 TBS 24062-27-057 与一个 Alberta 标包各起草一次询价、生成一次「供应商询价与符合性确认表」，记下有无编号 / 采购方 / 截标日期，以及整单失败的次数与命中类别（Q7 的依据）。这需要真实的分析结果（要求与关键事实），而本会话只有本机隔离库，没有生产 / staging 数据，也跑不了分析（需要模型密钥）。仓库里唯一的真实标书转写（DSBN 窗饰 RFP，约 1,900 字）太短，不能当命中率的依据，没有用。

已经用夹具做了等价的验证（隔离库测试 §2–§4 条）：联邦标形状的项目经真实送审路由，标题与正文不含 `24062-27-057`、`Treasury Board`、项目名称、`2026-12-05`；要求里写了采购方 → 422、零轮次零卡。

**staging 上要补的一步**（合并之后、开 CHAIN-0 第 7 项之前）：

1. 在 staging 选 TBS 24062-27-057 与一个 Alberta 标的项目（已有批准的分析），项目页「问供应商要价」选 1–2 家测试供应商送审。
2. 看审批卡上的标题与正文：没有编号、采购方、项目名称、截标日期；目的地是「城市, 省」。
3. 失败的话记下说明里的「命中：类别·位置」。
4. 「标书与报价」生成「供应商询价与符合性确认表」与「国内供应商简报」，打开核对抬头。
5. 把两个标的结果（成功 / 命中哪几类、几处）补进本报告本节。命中率高时按 Q7 另立「本轮不带这几条要求」。

## 7. 已知限制

- 清单只认项目与分析里写明的值：缩写（TBS）、另一种语言（SCT、中文译名）、部分名称（只写 Treasury Board）在招标原文里查不出。模板由构造保证不带这些。
- 分析没跑出采购方 / 编号事实、项目字段也空着时，清单是空的，只剩格式检查。
- 截标时间只有分析事实原文（如 `December 5, 2026 2:00 PM EST`）而项目没有截标日期时，只按整段原文比，不另派生日期写法。
- ISO 日期时间连写（`2026-12-05T14:00`）规整后是一个词，不会命中日期词条。
- 回复截止被「不早于今天 + 2 天」顶到正好等于截标日（截标恰在 2 天后）时，标题里的回复截止会命中截标日期、整单失败。这种标本来也来不及询价；没有特殊处理。
- 电话格式要求北美号码有分隔符，且区号与局号首位为 2–9；连写的 10 位数字与 `100-123-4567` 这类编号不算电话（避免误判型号）。反过来，要求原文里恰好是「三位 三位 四位」且首位 2–9 的一串数字（如 `600 900 1200`）会被当成电话、整单失败，说明里写「电话号码·要求 R-xx」。
- 项目名称（含分析里的中文标题）只要不少于 4 个字就进清单；很短的中文标题（如「检测报告」「样品提供」）会撞上供应商询价表里的固定中文，导致文件生成不了。
- 生成文件抬头的生成日期不参与比对（实施时补的：否则截标当天生成会撞上截标日期）；询价邮件标题里的回复截止参与比对（见上一条）。
- 上线时已在待批的询价卡执行时会被拒（说明写明请驳回后重新起草）；自动起草开关目前关着，影响的只有人在网页上起草的卡。

## 8. 拍板结果（Lucas 2026-11-19，全部按推荐）

| # | 问题 | 结果 |
|---|---|---|
| Q1 | 询价编号用项目 id 定的 5 位码，不用年度序号、不接品类 | 按推荐 |
| Q2 | 项目名称只在我方撰写与人工填写的部分查 | 按推荐 |
| Q3 | 目的地只写「城市, 省」或人工填写 | 按推荐 |
| Q4 | 纳入技术确认表、China Brief，旧路径不再拼项目 AI 上下文 | 纳入 |
| Q5 | China Brief 自动挑选的事实命中整行不收，编辑备注命中整份失败 | 按推荐 |
| Q6 | 执行器复核：旧卡拒发、新卡重扫 | 做 |
| Q7 | 命中整单失败，「本轮不带这几条」先不做，实测后定 | 接受；实测见 §6（待 staging） |

## 9. 上线后

- 合并即生效。之后可以开 CHAIN-0 第 7 项（`TENDER_RFQ_AUTO_DRAFT_ENABLED`、`TENDER_RFQ_SUPPLIER_GROUPS_ENABLED`、`TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED`），建议先做完 §6 的 staging 实测。
- 回滚：回退本 PR 即恢复原行为；新卡上多出的 `identityGuard` 键对旧代码无影响。
