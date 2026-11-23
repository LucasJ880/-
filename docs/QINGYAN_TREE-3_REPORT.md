# TREE-3 报告 — 三个子代理（`research-branches-awards`）

PR：[LucasJ880/-#584](https://github.com/LucasJ880/-/pull/584)。任务书：`docs/QINGYAN_TREE_RESEARCH_TREE_TASKBRIEF.md`「TREE-3」（Evan 2026-11-22）。四件套：`openspec/changes/research-branches-awards/`（新能力 `tender/research-branches` 14 条 Requirement；改 `tender/research-tree` 10 条、删 1 条）。交接：`docs/QINGYAN_TREE_HANDOFF.md`。

## 1. 做了什么

- **条款员**（① 条款）：不联网，只读本项目与一键分析同一口径的标书页。关键词规则（英法双语：等效品、不接受替代 / 限定品牌 / 限制性招标、加拿大 / 本地含量、等效证明）找段落，按三问轮流取、最多 16 段 / 12 000 字；一条都没命中不请求模型，三问「未写明」并各给一条澄清草稿（固定模板）。有命中时每棵树请求模型一次：答案只能是枚举，引文要段号存在、摘录逐字在段里；存下的是标书原文，页码与文件名由代码填；对不上的改「未写明」；「限定品牌」与「接受等效品」同时成立标出矛盾。请求失败或格式不对 → 「未接通」，不编结果；结论记进游标，续跑原样交回、不再请求。
- **招标要求页的只读卡片**「标书条款（调研树）」与读取接口 `GET /api/projects/[id]/research-tree`（第一步读权限守卫，开关关 404）：在查（每 15 秒重读、最多 10 分钟）/ 查完 / 停下了（Job 结束而条款没有结果）/ 未接通；不写任何数据、不改已确认的要求、不进关键事实槽位。
- **往期同标员**（②）：第一轮模型请求之前确定性地查联邦合同公开数据（最多 2 个检索词，每次算一次搜索、过外发闸、超时管到正文读完）；同一采购方、规格对得上的行转成记录（按合同编号去重，全支最多 5 条），全部行作为不可信资料交给模型；之后照常搜索与读页。
- **同类项目员**（③、第二波甲乙）：交回一组（采购方、年份、数量、合同额、币种、口径）记录。
- **授标记录**：模型交事实时带组名，代码把同一网址同一组的已核对事实组装成记录；单价（合同额 ÷ 数量，BigInt 精确到分，原币不换汇）、口径（四个标签 + 不明，摘录要有提示词）、币种（写明 / 按网站推断 / 数据集 / 不明，冲突为不明）、可比度（四项 是 / 否 / 不明 + 分数）全由纯函数算。
- **分叉规则按记录**：② 没有记录 → 甲跑；③ + 甲能算单价的记录不足 3 条 → 乙跑。交接单加 `records` / `clauses`，短标签「查到 N 条」按记录数、条款「写明了 N 项 / 都未写明」；树干摘要加记录数与条款答案。

## 2. 改了哪些文件

- 新增：`src/lib/tender-research-tree/{awards,clauses,clauses-run,federal,results,view}.ts`、`src/components/tender-analysis/research-clauses-card.tsx`；测试 `src/lib/tender-research-tree/__tests__/{research-branches-pure.test.ts, research-branches-db.isolated.test.ts}`、`src/lib/web-reader/__tests__/tree3-research-branches.test.ts`、`src/components/tender-analysis/__tests__/research-clauses-card.test.tsx`。
- 修改：`src/lib/tender-research-tree/{types,limits,fork-rules,prompt,guards,cursor,deps,branch-run,trunk,graph,start}.ts`、`src/app/api/projects/[id]/research-tree/route.ts`（加 GET）、`src/components/project-detail/tabs/requirements-tab.tsx`（挂卡片）、`scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（只新增注册）。
- 修改的 TREE-2 测试（随行为改动的断言，逐条见 §6）：`research-tree-pure.test.ts`、`tree2-research-branch.test.ts`、`tree2-research-tree-job-db.isolated.test.ts`。
- 没动：`prisma/**`、`vercel.json`、任务运行时源码、`tender-workforce/tools.ts`、`canadabuys.ts`、`job-failure-surfacing.ts`、TREE-1 读页层、`openspec/config.yaml`、`CRITICAL_FACT_TYPES`。

## 3. 测试

| 文件 | 内容 | 条数 |
|---|---|---|
| `research-branches-pure.test.ts` | 验收合成数 23.00 / 25.00 / 21.00、四舍五入与不到半分、金额 / 数量 / 年份写法（法文、倍数、空格分组、区间、认不清的点千分位、减项）、币种（写明 / 推断 / 冲突 / 两种都写 / 页级缺省 / 别的币种 / $ CA）、口径（提示词正反例、一年与交货时间不算）、可比度表与边界、记录组装（两组、页级缺省、组名归一与碰撞、上限）、联邦数据行（去重、不相干合同、采购人名）、联邦数据检索词（数字进不去、敏感词）、条款规则正反例、成段与上限、引文原文 / 段号仿冒 / 降级 / 矛盾、草稿、事实值清洗、项目资料清洗、收尾原因、树干条款摘要、读取视图状态、超时信号 | 220 |
| `tree3-research-branches.test.ts` | 条款员（接受等效品带第 7 页、都没有、没有标书 / 扫描件、格式不对、请求过续跑、结论记下续跑、让出、额度 0、开关关、矛盾）；联邦数据（两条记录与额度、续跑恢复、额度占满、敏感词被拦、开关没开、出错、没有英文检索词、去重与不相干合同、两次查询之间让出、请求失败与撞截止后行还在、抛错、额度不够记一行、查询中断、开关关零查询）；同类记录（两组单价与币种与口径、零散事实、模型后来不可用、币种 / 口径对不上、组名 Lot 1 / Lot 2、规格关键词）；测试注入漏项报错 | 62 |
| `research-branches-db.isolated.test.ts` | 隔离库：真页表读到第 7 页、读数量与合同期、读取接口开关关 404、开关关 + 非成员 403、非成员 403、没有树、在查、条款员经生产库跑一次只多审计、查完读到结论不含网址金额、再关开关 404、Job 取消时「停下了」 | 15 |
| `research-clauses-card.test.tsx` | 卡片各状态文字（查完、出处对不上、证明挂在等效品下、品牌措辞、草稿指向 RFI、没有内部说法、都未写明、未接通不重复短标签、在查、停下了、矛盾、发起时间）、只读、404 / 500 / 读取中 / 没有树不显示、重读与出错保留 | 25 |

## 4. 门禁

实现者在干净 worktree、新建空库上各跑一遍（`scratchpad/gate2.sh`）。分支提交 `387c1eb9` 叠在 `4909bddf`（main `58508ecc` + TREE-2 归档提交，只动 docs 与 openspec）上；之后 TREE-2 归档 #583 合并成 `e77e2c72`，分支变基到它（`368c8e13`），与 `387c1eb9` 只差 TREE-2 的报告与交接两份文档（代码相同，交接 D-26）。

| 项 | 分支 `387c1eb9` | main `58508ecc` 基线（新库） |
|---|---|---|
| `npm test` | 750/760 通过，10 失败 | 746/756，10 失败 |
| 失败项 | 10 项与 main 逐条相同（Autopilot A2-P0、Phase3A-3 / 3A-4 ×2 / 3A-5、报价 PDF 分页、Sunny 工艺单 DB、T4 授标矩阵、RFQ-AUTO-2、MAIL-2），没有新增 | — |
| `test:ci` | PASS | — |
| `typecheck` | 通过 | — |
| `lint:baseline` | PASS（相对基线少 15 处） | — |
| 测试注册 / 架构 | 通过 / 通过 | — |
| openspec | `research-branches-awards --strict` 通过；`--specs --strict` 162/162 | — |
| 受保护文件（`prisma/`、`vercel.json`、`workforce-runtime/`、`.claude/launch.json`） | 没有改动 | — |

GitHub CI（`validate-lint-typecheck-test-build`）在 `368c8e13` 上 success（2026-11-23 15:26 UTC）。

## 5. 多维审查

九个维度子 agent 独立审查 `c8c1a895`（只看任务书、四件套、diff 与现有代码，不看自述）：⑤ 硬纪律、⑥ 开关关零变化「可以合」，其余七个「改完再合」，**没有阻断**。全部意见在提交 `4f72d683` 里处理（代码、测试、四件套一起）。逐条去向：

**① 需求符合（改完再合）**：1 联邦数据把同一部门不相干的合同记成「上一期」（第 2 个检索词常是采购方全称）【改：规格明显不同的行不成记录、只给模型看；D10、spec】；2a 有记录后模型不可用时原因没写【改：原因里写「未接通」，spec 措辞同步】；2b 场景「项目名带估值」不会发生【改：场景换成敏感词，另测数字进不了检索词】；2c 口径「含安装」没有记录级用例【补】；2d 树干条款摘要只测过 null【补】；3 MODIFIED 丢了 TREE-2 原文【改：交接单的 status 枚举、notFound 四类、researchSummary、到上限三种情形、另记请求的网址补回】；4 同类项目员缺规格关键词输入【改：项目资料加「规格关键词」一行，D13】；5 三条规则没有命中用例【补】；6 Job 停下后卡片一直「在查」【改，同 ⑨3】；7 proposal 小出入【改】。

**② 正确性与回归（改完再合）**：1 联邦数据跨检索词不去重（记录号含查询网址）【改：按合同编号】；2 数的写法给出错数（法文小数、数量的 million / 万、空格分组吞相邻数）【改，D6，补表驱动用例】；3 币种「两种都写」落到按网站推断【改，D8】；4 口径提示词太宽（an、including、年）【改，D7；另把「2024年」排除】；5 组名不合格被当作没给、同页两笔拼一条【改：组名归一、清完是空的用哈希】；6 单价不到 1 分给 0.00【改：不算】；7 联邦数据按采购人名对上却写部门名【改：写对上的那个名字】；8 续跑只恢复最后一次的行【改，同 ⑨2】；9 额度不够跳过检索词只记在内存【改：记一行 blocked_query】；10 没写组名的币种 / 采购方不套到有组名的记录【改：页级缺省，D5】；11 规则漏「Equivalents will (not) be accepted」「Aucun équivalent」【改】；12 同 ⑨3【改】。回归意见：TREE-2 改动的断言没有放松保护【无需改】。

**③ 读网页与对外请求（改完再合）**：1 联邦数据的超时只管到响应头【改：给它的 fetch 加管到正文读完的信号，另以「剩余时间 − 15 秒」兜底，D10】；2 游标里的「给模型看的行」spec 没列【改：spec 与 D10 写明，每行 ≤200 字、最多 10 行；不改成不存——续跑要用】；3 同 ①2b【改】；4 测试注入漏项会悄悄走生产实现【改：漏了会发请求的几项就报错】；5 查询网址不在可读网址里却进审计【改：spec 写明例外】；6 `EXTERNAL_INTEL_CONTRACTS_RESOURCE_ID` 指向全量数据集时全文检索失灵【不改：`canadabuys.ts` 既有行为、不在本 change 范围，写进交接】。

**④ 提示注入（改完再合）**：1 币种事实盖过合同额写明的币种【改，D8】；2 口径提示词形同虚设【改，D7】；3 卡片引文存模型改写过的大小写【改：存段落原文】；4 正文仿冒段号 `[S2]`【改：换掉】；5 事实值带双向控制字符【改：存之前清掉不可见字符与控制字符】；6 项目名 / 采购方没清洗就进提示（TREE-2 旧债）【改】。

**⑤ 硬纪律（可以合）**：1 「一次」写成数字 1【改：常量 `CLAUSE_MODEL_REQUESTS_PER_TREE`】；2 物理请求上限要写明【做：D2，物理最多 6 次计费调用（TREE-4 审查时更正，原写约 4 次），待 Evan 确认】；3 同 ①2b【改】；4 同 ③2【改】。

**⑥ 开关关零变化（可以合）**：1 「开关关联邦数据 0 次」写成显式断言【补：整树 DB 测试与 tree3 测试】；2 开关关时每次打开招标要求页多一次 GET（404）【不改：与寻源建议卡同一做法，页面与库都无变化，D4】。

**⑦ 使用流畅与文案（改完再合）**：1 在查时不刷新【改：每 15 秒重读、最多 10 分钟】；2 Job 停下后永远「在查」【改】；3 单元标签被再包一层【改：原样显示，夹具换成真实写法】；4 品牌一问措辞会和原文打架、草稿预设写了品牌【改：「是否限定品牌（不接受替代）」三个答案、矛盾提示、草稿改成「If any brand names…」】；5 往期同标理由句（「只用了搜索与读页」不对、出错不说、「外发闸」）【改】；6 内部说法【改：条款员 / 模型 / 三问 / 成条换成用户的话】；7 状态行与原因句重复【改】；「到上限，未查完」措辞【改：写明是本组织调到 0】；「可以重新查」没入口【改：去掉，改写下一步该做什么】；8 「要什么证明」【改：「等效品要交的证明」，挂在等效品下】；9 「页」与「相关条款」【改：「页 / 单元」「可能相关的文字」】；10 显示发起时间【改】；11 草稿指向 RFI、中文前加「意思：」【改】；12 标题括号【改】；13 「项目名里没有英文检索词」【改：项目名、采购方与类别】；读取出错不显示的取舍【不改：审查员认为合理；另加了重读时出错保留上一次的】。

**⑧ 规格—代码—测试一致性（改完再合）**：1 同 ②3【改】；2 同 ①2a【改】；3a 树干条款摘要改坏测试不红【补】；3b 外发闸改坏测试不红【补：margin / profit 用例】；3c 守卫 403 改成 404 测试不红【补：断言 403，另加开关关 + 非成员】；4 REMOVED 残留（计划描述、注释）【改】；5 「被挡了换来源」语义改了没进 MODIFIED【改：加进 MODIFIED】；6 同 ①3【改】；7 同 ③5【改】；8 design 缺备选与两节【改：D6、D11、D13、D14、D15 补备选，加「八条硬纪律」「验证方式」】；9 归档顺序写进 tasks【做】；10 spec 补实现细节（合并 ≤900 字、每规则每页 8 个、全支最多 5 条、同规格比往期标名、数据集优先）【改】；11 测试偏薄（规格关键词接线、授标支 clauses:null）【补】。

**⑨ 续跑、并发与失败隔离（改完再合）**：1 同 ②1【改】；2 续跑丢联邦数据的行（只存这一次的、恢复时整段替换、请求失败后被覆盖、model_call 就清空）【改：游标存合并后的行、恢复时合并、到模型第一次交回可用的决定才清空、请求失败时保留并附提示；三个序列都补了测试】；3 Job 停下后视图一直「在查」【改：「停下了」】；S1 条款员请求成功后写结论失败会丢结论【改：整份结论记进 decision 行，续跑原样交回】；S2 崩在联邦数据查询途中没有提示【改】；S3 联邦数据抛错整支停下【改：当作没查成】；S4 检索词按序号记【改：序号与文字都比】。

**挑错交叉验证**（另一个子 agent，对象 `387c1eb9`；它核对过 `387c1eb9..368c8e13` 在代码、脚本、库结构上没有差异）。它自己重跑的：全量门禁（分支 750/760、main 746/756，10 项失败逐条相同）、`test:ci` / typecheck / lint / 测试注册 / 架构 / openspec 都过；开关关三种关法 × 五支加树干共 27 个结果都是「未开启」、0 次调用、0 次 fetch，读取接口 404、全库快照不变，招标要求页服务端渲染与 main 哈希相同，一键分析的计划与工具面六项哈希与 main 相同；验收 2（23.00 / 25.00 / 21.00）与验收 8（条款员 29 项）照做都对。结论「改完再合」，逐条去向：

1. 【中高】组名截到 12 字、去掉符号后不同的组被并成一组（「Contract 2024-001」与「Contract 2024-002」拼成一条、单价 28.75；「Lot 1.1」与「Lot 11」）【改：截短或去掉过字符的组键带原文的哈希；补碰撞用例；D5、spec 加场景】。
2. 【中】数的写法读错：「$1.000.000」读成 1.00，「10.000 units」读成 10，「-$230,000」读成 230000【改：后面还剩没读完的数字分组、只有一个点且点后正好三位 → 认不清，不认；负号或括号的减项 → 不认；D6、spec 加场景】。
3. 【低】.ca 网站上写「€230,000」被按网站推断成 CAD；「230 000 $ CA」不认【改：合同额或币种事实写的是 € / £ / EUR 等别的币种 → 不明，不按网站推断；「$ CA」「$CAN」认成 CAD；D8、spec 加场景】。
4. 【低】「1-year warranty」「2024 to 2024」被收成多年期，「delivered by March」被收成含运费【改：多年期要两年以上或起止年份不同；含运费要写到运费 / 送货费 / FOB / DDP / 含送货；D7、spec 加场景】。
5. 【低，可不改】开关关时招标要求页每次打开多一次 GET（回 404），网络层不是严格的零变化【不改：页面显示与库都与 main 相同，与寻源建议卡同一做法（D4）；写进 PR「没验证到 / 已知」】。
6. 【待 Evan 确认，不阻断】条款员物理上最多 6 次计费调用，任务书写「一次模型调用」【不改：D2 已标待确认，写进交接】。

四处修改在提交 `761aecc2`（纯函数测试 179 → 194）。

**修改后复核**（又一个子 agent，只拿上面四条意见与代码，自己做实验与变异，不看实现者的说明）。结论「改完再合」：四条里点名的例子都修好了、没有弄坏别处，但——
- 【要改】含运费收得太紧：「Supply and delivery of…」「Supply, delivery and installation…」「Prices include delivery」「Delivery: included」「free delivery」「Delivered Duty Paid」「delivered to the City warehouse」「Fourniture et livraison…」「y compris la livraison」「incluant la livraison」「livraison et installation comprises」等 13 种正当写法被拒【改：补上供货并送货、含送货、免费送货、送到现场 / 仓库、FAB / franco destination、配送；17 种写法逐条有「照认」用例】。
- 【要改】「$US」「$ US」「dollars américains」在 .ca 网站上仍按网站推断成 CAD【改：认成写明的 USD；AU$ / A$ / euros 算别的币种】。
- 【要改】组名「截短带哈希」那一半没有测试守着（只改回那一半全绿）；测试与场景举的「Lot 1 – North / South」截短后本来就不同；哈希区分大小写，「CONTRACT 2024-001」与「Contract 2024-001」被拆开【改：补「Contract 2024-001 / 2024-002」两条记录的用例与截短撞名用例；哈希按小写、空白归一的写法算，先去掉不可见字符与末尾标点；场景换成真正截短撞名的例子】。
- 【要改】「币种事实写 EUR」的用例走不到（事实核对只收 CAD / USD 的币种事实）【改：删掉这条用例与场景、删掉对应的死代码；页面别处写 EUR 而金额不带符号时仍按网站推断（另标「按网站推断」），写进 D8 与「没验证到」】。
- 【低，可后续】减项漏网（「(230 000 $)」、长短横线做负号、尾负号）与「Total - $230,000」这类标签横线被误杀；保修年限、财年、0.5 年被算成多年期；「three (3) years」「36-month」「trois ans」「2024年至2026年」漏认【都顺手改了：负号按位置判（开头可带空格、中间要紧挨着数）、括号里货币符号前后都认、尾负号；保修年限与财年先去掉再判；补这几种合同期写法；各有用例】。
- 变异：只改回「截短带哈希」、只去掉「含送货」一条规则，纯函数测试都变红（2 条、4 条失败）。

这一轮修改在提交 `1e7a98d9`（纯函数测试 194 → 203）。

**第二次复核**（同一个复核子 agent 再看 `1e7a98d9`，对比 `761aecc2` 的输出，13 个变异全红）。结论「改完再合（一处）」：上一轮四条与可选第 5 条都修好了；新问题——
- 【要改】「先去掉保修年限」删多了：「a 3-year service and warranty contract」「5-year maintenance and warranty agreement」「3-year contract including warranty」「3-year guaranteed pricing」等 6 种真合同期不认了【改：保修与年数之间只放过形容词一类的词（manufacturer's、limited、extended、parts and labour…），guarantee 后要词边界；6 种逐条有「照认」用例】。
- 【要改】按月写的保修（「24-month warranty」「warranty of 36 months」「garantie de 24 mois」）被当成多年期【改：去保修时也认月数；另补「warranty: 2 years」「2 ans de garantie」「三年质保」「FY 2024-2025」「the 2024-2025 fiscal year」，各有用例】。
- 【低，顺手改】含运费收进只讲交货时间的句子（「include delivery schedule」「Supply and delivery dates」「avec livraison prévue」「配送时间」「delivered to the following location by May 1」「provide and deliver training」）【改：送货后面跟日期 / 时间表 / within / by 的不算，去掉 provide / furnish 与 location / address】；写明不含运费的（「Freight not included」「delivery costs are extra」「frais de livraison en sus」，`761aecc2` 以前就有）照算含运费【改：先查否定说法】；单写 transport（「Transport Canada」）【改：要写运输费用】。
- 【低，顺手改】括号规则误伤带单位的数量「(500 pcs)」「(12 kg)」【改：括号里只认币种字母】；「230 000 $ –」与「$230,000 –」不一致【改：一致不收】；公司名里的 Euro 让币种变不明【改：euros 要紧挨着数】；「第一包。」与「第一包」不并【改：去掉末尾中文标点】；「230 000 $ US」在 .ca 网站上的记录补了「写明」的断言。
- 【不改，记下】「supply and deliver the bins by March 31」按供货并送货算含运费（送货在合同范围里）；18 months、2.5 years 不认多年期（只会少口径）；「fiscal year 2024-2025 to fiscal year 2026-2027」不认；「Lot 1-2」与「Lot 1 2」并成一组。

这一轮修改在提交 `58825f06`（纯函数测试 203 → 210）。

**第三次复核**（同一个复核子 agent 看 `58825f06`，17 个变异里 16 个变红）。结论「改完再合（一处）」：上一轮 1–3 都修好；新问题——
- 【要改】「写明不含运费」管得太宽：「Delivery included, installation extra」「Prices include delivery, taxes extra」「Delivery included at no additional cost」「livraison incluse, installation en sus」等 8 种被拒【改：否定词要紧跟在运费词后面（中间只许 charges / costs / fees 与 is / are / 冒号），「at no extra cost」照认；9 种逐条有「照认」用例】。
- 【建议，同批改】交货时间的排除太宽：「including delivery within Canada」「Supply and delivery by the Contractor」「Fourniture et livraison en vrac」等 7 种被拒【改：by / within / en / le 后面要紧跟日期、月份、天数才算交货时间；7 种有用例】。
- 【低，顺手改】「over the 2022-2025 fiscal years」「FY 2024-2027」被当单个财年去掉【改：起止只差一年的才去掉】；「price guarantee: 3 years」被当保修【改：后置写法只认 warranty】；「合同期3年保修1年」丢了合同期【改：「期」后面的年数不当保修】；「en euros」「euros : 230 000」不算欧元、括号里小写币种字母不认【改】；「3-year warranty and maintenance contract」没有测试守着【补】；另补「warranty – 5 years」「warranty (5 years)」「Garantie : 5 ans」「质保期：3年」不算多年期。
- 【不改，记下】「supply and deliver the bins by March 31」「delivered to the site no later than June 30」按含送货算；「supply plus delivery」按「plus 运费」= 不含处理（只会少口径）；「FY 2024-25 to FY 2026-27」、2.5 years、18 months 不认多年期。

这一轮修改在提交 `27c0a6bd`（纯函数测试 210 → 216）。

**第四次复核**（同一个复核子 agent 看 `27c0a6bd`；按收敛规则：只有错数、错币种、错单价、把上一版认的常见写法拒了、或新规则没测试才阻断，只会少认的算可后续）。结论「改完再合（两处）」，第三轮的问题都修好、之前的探查结果一字不差：
- 【要改】新的「garantie」规则往后跨 30 个字找年数，把魁北克常见的合同期写法删了（「garantie et contrat de 3 ans」「Service après-vente et garantie : contrat de 5 ans」「warranty (3-year contract)」「Warranty – 3 year term」等）【改：garantie 与年数之间只放过形容词一类的词（pièces et main-d'œuvre、prolongée、du fabricant…）；年数后面跟着 contract / term / agreement / contrat / durée 的不当保修；8 种有「照认」用例】。
- 【要改】三条新规则没有测试（「Freight: N/A」「frais de livraison exclus」与 supply plus delivery——后者根本不起作用，因为「plus delivery」先被当成不含运费）【改：前两条补用例；去掉 supply 后面的 plus，「supply plus delivery」按不含运费处理并补用例】。
- 【可后续里最该先改的，顺手改】「Delivery charges will be extra」「Freight will be charged extra」「Freight charges, if any, are extra」「Les frais de livraison sont en sus」「Prices do not include delivery」「Shipping costs to be added」被标成含运费（标错，不是不明）【改：否定词前允许 will be / to be / sont / if any，另认 do not include、to be added、charged separately；用例】；「with delivery in March」「including delivery in 30 days」【改：in 也认，日期要像日期——月份（「Mar-Tech」不算）、天数周数、年份；「en 3 lots」「within 50 km」照认含运费；用例】。
- 【可后续，记下】括号里小写的「(500 can)」「(12 us)」一类数量不认（只少单价）；「Euro 2024 Ltd」会让币种不明；「fiscal year 2024-2025 to fiscal year 2026-2027」不认多年期。

这一轮修改在提交 `34664079`（纯函数测试 216 → 220）。

**第五次复核**（同一规则；19 个变异里 12 个变红，之前所有探查结果与 `27c0a6bd` 完全相同）。结论「改完再合（补测试、加几个词）」：
- 【要改】「garantie 与年数之间只放过形容词」清单太窄，魁北克常见的「garantie du manufacturier de 5 ans」「garantie minimale / standard / de base de 2 ans」「garantie sur les pièces de 5 ans」又被当成多年期【改：加 manufacturier、minimale、standard、de base、sur les pièces；用例】。
- 【要改】六处新规则没有测试（交货时间里的年份与 3/31、charged / billed separately、n'incluent pas / ne comprennent pas 与后面的 la / les frais de、garantie 后面跟合同期）【补用例；七处各做变异，测试都变红】。
- 【可后续，记下】「free delivery added to all orders」被 added 当成不含（只少认）；「by May Logistics」「en 2-3 lots」被当交货时间；「with delivery in Q2」「before year-end」仍算含运费；「warranty: 3 years terms and conditions apply」算多年期（构造的边缘）。

这一轮的新用例加进已有的断言里（纯函数测试仍是 220 条），其余 TREE-2 / TREE-3 测试照旧全过（160、85、62、15、36、25），typecheck 与改动文件的 eslint 通过。口径与写法的规则已经收敛到「认不清就不认」：五轮复核都没有发现错数、错币种、错单价；剩下的漏认只会让口径变「不明」、单价不算。

## 6. 对 TREE-2 测试的修改（逐条）

- `research-tree-pure.test.ts`：分叉真值表的「同类授标」事实换成「同组的合同额 + 数量」（「同类授标」这一事实类型已去掉，乙按能算单价的记录计）；`comparableAwardCount` 换成 `unitPriceRecordCount`；树干「条数」按记录数（往期同一页的中标方与金额是一条）；条款一支的静态单改成「没有标书」。另加：旧单（没有 records）按空处理。
- `tree2-research-branch.test.ts`：项目名与采购方改成中文（往期同标的联邦数据一步取不到检索词、不发，那一步在 tree3 测试里测；通用循环的断言不变）；条款一支从「零写入」改为「没有标书 → 未接通、零外部请求、只记一条交单游标」；第二波的上游交单改成带记录的。
- `tree2-research-tree-job-db.isolated.test.ts`：注入假的联邦数据（以前没注入，跑的是生产实现、会真的请求 open.canada.ca）；页面上的「同类授标」事实换成同组的合同额 + 数量 + 年份；断言改成核对记录与单价（25.00 / 21.00 / 24.00）；开关关时另断言联邦数据零查询。

## 7. 没验证到的地方

- 真实联邦数据接口、真实搜索、真实模型、真实网站都没碰过（本地没有 key）；联邦数据的采购方写法（英法两写、缩写）与项目采购方对不上时会少记录，**未核实**。
- 数的写法、币种与口径提示词只在构造的写法上测过（挑错与复核各做了几十种英 / 法 / 中写法）；真实网页上更怪的写法**未核实**，认不清的按「不认」、口径对不上的按「不明」处理（只会少单价、少口径，不会算错）。已知漏网：页面别处写「All amounts in EUR」而金额本身不带符号时，币种仍按网站推断（标「按网站推断」）；「CAD-230,000」这种币种字母紧贴负号的写法照收。
- 关键词规则的召回只在构造的段落上测过；真实标书的写法（表格里的品牌、只写型号）**未核实**，漏了按「未写明」给草稿。
- 「同规格」只比关键词；英法两写、同义词判「否」。
- 条款员每棵树一次请求，物理上最多 6 次计费调用（2 次尝试 × 主模型 / Astra 同模型重试 / 换备用；SDK 网络重试另算；D2，待 Evan 确认口径）。
- 每棵树的真实用量与耗时**未核实**；按上限：授标支不变（105 次模型请求、56 次搜索、42 次读页），条款员 +1。

## 8. 回退办法

revert 本 PR（无迁移）。卡片与读取接口一起去掉；交接单多出的两项旧代码不读。若某环境已打开开关，先关开关再 revert。
