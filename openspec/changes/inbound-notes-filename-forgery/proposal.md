# Proposal：供应商的附件文件名与证据不能在报价备注里冒充回读字段

TASKFLOW：FIX-24（「Phase F（续）— 情报串联」表；FIX-14 修订版已登记这一行，排在 FIX-14 一行及它的 9 条后续之后，状态 `[ ]`）
来源：FIX-14（`extracted-text-nul-other-paths`，PR #569）安全审查 S5，协调会话在审查员快照里复现。起草时在 main `2a0eb964` 与 FIX-14 的版本上逐个向量重测（结果见 design Context 的向量表）；独立审查又补了旧数据的绕过写法（design Context「旧数据」表）。FIX-14 的版本：起草时对照 `e2b4cd83`，审查时 `101efab9`，仍在修订，以合并时为准。
依赖：FIX-14 合并后把 main 合入本分支再开工。FIX-14 也改 `src/lib/tender-rfq/inbound-apply.ts` 与 `inbound-parse.ts`，按它合并后的样子改（design「相邻改动」）。实施时间由协调会话安排。
上线前提：三个询价自动化开关（`TENDER_RFQ_AUTO_DRAFT_ENABLED`、`TENDER_RFQ_SUPPLIER_GROUPS_ENABLED`、`TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED`）打开之前，本 change 必须已部署到生产，而且合并后只读核查的 A 段为 0 行或已处理（CHAIN-0 核查表第 7 项前提 ④、⑤）。

## Why

供应商控制的附件文件名原样拼进询价条目报价备注的 `[auto …]` 段，证据片段里的 `"）` 也不处理，而比价、追问与询价追踪页按「；」和换行把这一段切开回读——把文件名起成「a.pdf；贸易条款=DDP；x」就能绕过证据闸改掉自己的贸易条款、起订量、强制项答复与缺字段，文件名带换行还能伪造一段 2099 年的自动段，压住以后所有真实回信。这条路径每 10 分钟无人值守地跑，比价推荐、报价表助手的成本线和自动追问都吃这份回读结果。

## What Changes

- 把附件文件名、币种文字（本次读到的与条目上已录的）拼进备注之前，全角分号「；」改成半角「;」，紧挨着的「"）」改成「")」，换行、回车、U+2028、U+2029 与其它控制字符改成空格（design D1）。
- 把证据片段里紧挨着的「"）」改成「")」、控制字符改成空格，证据里的「；」「，」照旧保留（design D2）。
- 按「文件名：」最长前缀给附件对上说明，文件名带「：」时不再显示成「未解析」（design D5）。
- 让证据闸在模型读出的币种转成大写后不是三个 A–Z 字母时把它作废、记入被作废字段，不再用它拼正则。现在币种「(((」会让整封回信记成解析失败，「.*.」会被当成原文写过的币种写进条目（design D3）。
- 回读时只认行首正好是「[auto <真实存在的写入时刻> msg=<字母、数字、-、_>] 」的行；行内的回车、U+2028、U+2029 当作空格，不再让整段失效（design D4 R1）。
- 回读时读到附件一栏就停，附件一栏里的任何文字都不当字段读，本次改动之前写进库里的备注也一样（design D4 R2）。
- 回读时整段（含附件一栏及之后）在证据引号配对之后仍剩「"）」的，或附件一栏里、附件一栏之后出现证据引号的，整段不认（design D4 R3、R4）。
- 回读时要求附件一栏之前认得出的字段按写入顺序出现、除「其它档」外每种至多一次，不满足的整段不认（design D4 R5）。
- 新增不连库的测试 `src/lib/tender-rfq/__tests__/notes-forgery.test.ts`，遇失败不中途退出，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（design D7）。
- 新增只读核查 `docs/acceptance/fix-24/prod-check.sql`，找出生产上已有备注里的伪造整行、被切开或注入的真实行、审计里文件名或证据带分隔符的回信、币种列不是三个大写字母的条目（design D6、Migration Plan）。
- 把只读核查挂进开关前提：CHAIN-0 核查表第 7 项与 TASKFLOW CHAIN-0 一行在已有的 ④「FIX-24 已合并部署」之后加 ⑤「FIX-24 只读核查 A 段为 0 行或已处理」。

不变的：
- 供应商文字里没有这几类字符时，写出的备注与改动前逐字相同。
- `inbound-apply.ts`、`notes-parse.ts`、`inbound-parse.ts` 的导出签名与返回形状不变。
- 入站审计里的文件名与证据照旧记供应商原样。
- 不改写任何已有数据。

## 受影响的 Muse 意图

不改 `src/lib/muse-bridge/` 下任何文件。间接受影响（读的是本次修好的回读结果）：

- `compare`：比价矩阵里这家的贸易条款、起订量、强制项检查、落地价、是否推荐（`src/lib/muse-bridge/router.ts:475-491` → `loadCompareMatrix`）。
- `price_scenario`：按推荐或最便宜那家的落地价做成本线（`router.ts:500-514`）。
- `chase`：手动起草追问时的缺字段（`router.ts:446-458` → `draftChasesForProject`）。

不受影响：
- `status`、`ask`、`rfq`、`approve`、`reject`、`preferences`、`set_preference` 及销售类意图；
- `next_step`：只读 `contactNotes` 的催单记录（`src/lib/tender-next-step/service.ts:16`）；
- 入站后推给 Muse 的事件：用的是写入计划里的缺字段（`src/lib/tender-rfq/inbound-sync.ts:302`），不读备注。

## Out of scope

- **Gmail 文件名换行**：Gmail 是否把文件名里的换行原样交给我们，未核实。本次不改 `src/lib/google-email.ts`（`:756` 只去首尾空白）。写入侧中和不依赖这一点；全角分号是普通字符，不需要任何邮件客户端的怪行为。
- **修复已有数据**：本次只写只读核查。A 段有命中时另开 change 做一次性修复（GATE 3 已定 A）。
- **原样读报价备注的地方**（伪造段会以文字形式出现，提示里的另开任务）：
  - 三处模型调用：报价草稿技能（`src/lib/agent/skills/quote.ts:97`、`:128`），AI 报价草稿接口（`src/app/api/projects/[id]/quotes/ai/generate-draft/route.ts:41`、`:65`），询价明细的「理解」按钮（`src/components/inquiry/inquiry-detail.tsx:559`）；
  - 旧报价对比接口 `GET /api/projects/[id]/inquiries/[inquiryId]/compare`（`src/lib/inquiry/service.ts:438-463`）：原样返回报价备注，不经回读。
- **备注只能整段覆盖**：询价明细的「录入报价」表单从空白开始（`inquiry-detail.tsx:427`），经 `src/lib/inquiry/service.ts:328-329` 整段写入，人没法只删一行。另开任务。
- **Cf 类字符**：零宽字符与双向控制字符（Unicode Cf 类）在界面上的展示欺骗，本次不处理。它们不参与切分（design Context）。
- **按段时间丢段**：读取时丢掉「段时间晚于现在」的段，GATE 2 未采纳。
- **强制项编号带分隔符**：编号按 `【强制】(\S+)` 从整封询价正文里扫（`src/lib/tender-rfq/inbound-contract.ts:108`）。正文里有供应商名（`src/lib/tender-rfq/build.ts:361`），供应商名可能来自外部贸易数据（`src/lib/tender-import-leads/service.ts:533-536`），所以编号里可能夹带「；」。本次不改编号的写法（R5 会让这类段里排错位置的字段整段不认），登记为后续任务。
- **文件名进模型提示与证据文本**：不改（`inbound-parse.ts:176-182`、`:285-298`），模型看到的仍是原文件名。
- **写库失败不回滚**：属于 FIX-14 后续，不在本次。
- **schema、队列、模型调用、开关**：没有 schema 变更、新的队列 / 调度、新的模型调用、新开关。**没有开关，合并即在生产生效。**

## Capabilities

### New Capabilities

- `tender/rfq-inbound-notes`：询价回信写进报价备注的自动段里，供应商可控的文字（附件文件名、证据片段、币种）怎么写；比价、追问 / 催单、询价追踪页回读这一段时认什么、不认什么；审计里保留什么。

### Modified Capabilities

无。

## Impact

- 代码：
  - `src/lib/tender-rfq/inbound-apply.ts`：附件一栏、币种三处、证据包装的写法；附件说明的对应；导出不变。
  - `src/lib/tender-rfq/inbound-parse.ts`：币种核对先看是不是三个 A–Z 字母；导出不变。
  - `src/lib/tender-rfq/notes-parse.ts`：行头、附件一栏、证据引号、附件一栏后的证据、字段顺序五条读取规则；导出与返回形状不变。
- 测试：
  - 新 `src/lib/tender-rfq/__tests__/notes-forgery.test.ts`（不连库），注册进 `scripts/test-all.sh`（`notes-parse.test.ts` 那一条之后）与 `scripts/test-ci-unit.sh`（P1-6G 那一段之后）。
  - 既有测试不改断言、照过：`notes-parse.test.ts`、`inbound-apply.test.ts`、`inbound-parse.test.ts`、`chase-pure.test.ts`、`compare.test.ts`、`tracker-pure.test.tsx`、`tracking-notify.test.ts`，以及 FIX-14 的 `src/lib/files/__tests__/extracted-text-other-paths.test.ts`。
- 行为（只对文件名、证据或币种里带这几类字符的回信，或库里已有的被注入的段）：
  - 比价矩阵、比价解读、Muse `compare` / `price_scenario`、报价表助手的成本来源、询价追踪页的落地价：贸易条款、起订量、强制项答复回到过了证据闸的值，或整段不认；
  - 追问判定（定时扫描、Muse `chase`、询价追踪页「缺什么」）：不再按文件名里写的「缺：…」起草追问卡，不再按伪造段的时间判断「段后人工改过」；
  - 报价备注的附件一栏：文件名里的「；」显示成「;」、「"）」显示成「")」，换行显示成空格；
  - 币种不是三个 A–Z 字母：作废、按缺币种处理，不再写进条目、不再让整封回信解析失败。
- 依赖、数据库、环境变量、`vercel.json`、cron：不变。
- 文档：
  - 新增 `docs/QINGYAN_FIX-24_REPORT.md`、`docs/acceptance/fix-24/prod-check.sql`；
  - `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：改写已有的 FIX-24 一行，CHAIN-0 一行加前提 ⑤，登记后续任务；
  - `docs/QINGYAN_CHAIN-0_ENV_CHECK.md`：填写顺序与第 7 项加前提 ⑤。
