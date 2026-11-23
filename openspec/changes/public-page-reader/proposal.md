# Proposal：读公开网页（TREE-1，含 TREE-0 登记例外）

TASKFLOW：TREE-1（Phase F（续）— 情报调研树；本 PR 同时完成 TREE-0：例外登记、TASKFLOW 新增一节并登记 TREE-0 ～ TREE-8、任务书入库）。任务书 `docs/QINGYAN_TREE_RESEARCH_TREE_TASKBRIEF.md`（Evan 2026-11-22 拍板第 1、2、7、8、9 项）。不触碰 muse-bridge，无受影响的 Muse 意图。

## Why

情报调研树要「查不到就换个角度再查」，就得能读公开网页正文；现在系统只调搜索接口拿标题与摘要，`tender-intel/`、`supplier-intel/` 下没有任何读网页正文的代码。读网页是对外取数，必须先有一个把六条读网页规则与安全护栏都写死在代码里的唯一入口，后面七个 change 才能放心用。

## What Changes

- 新增 `src/lib/web-reader/`：读公开网页的唯一入口（一个读页函数 + 从调研 Job 建读页会话的函数），返回冻结的不可信资料 `{ untrusted: true, url, finalUrl, fetchedAt, text, truncated, blocked }` 以及结果类别（读到 / 被挡 / 打不开 / 不读 / 到上限）、原因、中文句与请求次数；守卫测试拦住别处绕过入口。
- 强制「只在人发起的调研任务里读」：读页会话只能从一条由人发起、没有结束的调研 Job 建出（Job 带平铺的调研标记、运行时写入的发起人、发起方式为「开始调研」「确认招标要求」「重新查」「补页后重算」之一）；定时任务、没有 Job、不是调研 Job、开关关着时一律拒绝，不发任何请求；每次读页再查一次开关。
- 强制身份与不登录：请求头的用户代理写明青砚与联系网址，不伪装浏览器；不带 cookie、不带任何凭证、不走代理（网址里带用户名密码直接不读）、不提交表单，只发 GET。
- 强制被挡即停：遇到登录页、人机验证、401 / 403 / 407、跳转（含 meta refresh）到登录地址、robots 不许读，返回 `blocked` 并写明原因与挡住我们的站，不换地址、不重试，同一支里不再向该站发请求；超时、连接中断、5xx 最多重试 2 次、间隔递增；429 只在对方给出不超过 30 秒的等待时间时等够再试一次，否则按被挡；一切等待不越过调用方的截止时间。
- 强制限量与间隔：每次读页在真正发出第一个页面请求前从这一支额度里扣 1 次（重试、跳转与 robots 不另扣；每支最多 12 次，读页层内部记账、重建会话时从审计恢复；每棵树最多 24 支；每支取 robots 最多 12 次），额度为 0 时不发请求、返回「到上限」；同一进程内同一站点两次请求的开始时间间隔不少于 2 秒（robots 请求也算）。
- 强制同址只读一次：同一读页会话内同一网址第二次读直接返回第一次的结果，不发请求、不扣额度；并发读同一网址只发一次请求，与某一支状态有关的结果不给别的支共用。
- 加安全护栏：网址先过 `validatePublicHttpUrl`，只收 http / https 与默认端口；解析出的地址是内网、回环、链路本地、保留地址一律不读，连接时再校验一次；最多跟 3 次跳转、每一跳重新校验；单次请求 15 秒超时；正文解压后上限 2 MB，超出截断并标 `truncated`；robots 规则表有条数与计算量上限；调用方可传网址检查（网址本身是外发数据，TREE-2 用它限定网址来源与内容）。
- 抽文字：HTML 转纯文本（把 `trade/email-forward-parse.ts` 里现成的线性扫描实现挪成公共模块，原处改为调用、行为不变）；纯文本与其它类型不读（任务书「其它类型拒绝」）；**PDF 不在本层解析**（进程内解析限不住成本，审查实测 1.1 KB 的构造文件单页 11 秒 / 711 MB；返回「不读」，由人用「我来补一页」上传——与任务书「PDF 用 unpdf 抽文字」有出入，见 design D7）；正文清掉 U+0000 与不可见字符。
- 加站点名单：代码常量三类（可以读 / 按人发起处理 / 不碰），「不碰」预置要登录的站（1688 详情、MERX 等），「按人发起处理」预置 ImportYeti（不看 robots，读页额度与其它站相同）；组织设置只能把站点加进「不碰」或「可以读」，不能放宽「不碰」、不能新增「按人发起处理」。其它站点按 robots 声明读（判断点 1 默认）。
- 写审计：每次实际发出的读页写一条审计，只记网址、最终网址、结果类别、HTTP 状态、字数、是否截断、原因与尝试次数，不记正文。
- 新增开关模块 `src/lib/tender-research-tree/flags.ts`：`TENDER_RESEARCH_TREE_ENABLED` + `TENDER_RESEARCH_TREE_ORG_ALLOWLIST`（写法照 `tender-intel/sourcing-flags.ts`，名单为空 = 所有组织）。
- 登记 TREE-0：`openspec/config.yaml` 硬纪律第 7 条补「情报调研树」例外（拍板人、日期、每处模型调用的上限），并写明两条已拍板的范围反转（读公开网页全文、给出建议报价区间）；`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 新增「Phase F（续）— 情报调研树」并登记 TREE-0 ～ TREE-8；任务书放进 `docs/`；新建交接文档 `docs/QINGYAN_TREE_HANDOFF.md`。

## Out of scope

- 不接任何调用方：本 change 之后没有任何页面、接口、定时任务或 Job 会读网页（TREE-2 才接）；开关开着也不会发出任何请求。
- 不做任何绕过访问限制的事：不换地址、不用代理池、不批量注册、不识别验证码、不伪装浏览器、不登录、不带凭证。
- 不读 ImportYeti（第三批才接反查）；本 change 只把它放进站点名单。
- 不做组织设置的编辑页面：组织覆盖只能由已有的设置写入途径写进 `settingsJson`。
- 不改 `src/lib/tender-intel/tavily-client.ts`、搜索接口与它的用法。
- 不删、不改另外三份 HTML 转文本（`google-email.ts`、`trade/tools.ts`、`projects/generate/tender-doc-html.ts`）；只挪 `trade/email-forward-parse.ts` 那一份。
- 不改数据库结构、不改任务运行时（`src/lib/workforce-runtime/**`）、不改 `vercel.json`。

## Capabilities

### New Capabilities

- `tender/public-page-reader`：情报调研读公开网页的唯一入口——谁能读、怎么读、读到什么、什么时候停、记什么。

### Modified Capabilities

无。

## Impact

- 新增：`src/lib/web-reader/**`（`index` / `read-page` / `transport` / `pure` / `types` / `db-deps`）、`src/lib/text/html-to-text.ts`、`src/lib/tender-research-tree/flags.ts` 及其测试（六份，注册进 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`）。
- 修改：`src/lib/trade/email-forward-parse.ts`（改为调用公共模块，行为不变）；`openspec/config.yaml`（TREE-0）；`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`；`src/lib/sales/period/narrative-pure.ts`（只改一行注释：「唯一例外」→「例外一」）。
- 新增文档：`docs/QINGYAN_TREE_RESEARCH_TREE_TASKBRIEF.md`、`docs/QINGYAN_TREE_HANDOFF.md`、`docs/QINGYAN_TREE-1_REPORT.md`。
- 零 schema、零依赖（只用 Node 自带的 http / https / dns / zlib；不加载 unpdf）、零新增模型调用、零出站发送。
