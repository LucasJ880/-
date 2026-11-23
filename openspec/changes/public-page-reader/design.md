# Design：读公开网页（TREE-1，含 TREE-0）

## Context

- 现状（main `451bb0d3` 只读核对）：`src/lib/tender-intel/tavily-client.ts` 只调搜索接口（`search_depth: "basic"`，每次 5 条）；`tender-intel/`、`supplier-intel/` 下没有读网页正文的代码；全库没有内网地址判断的现成函数（只有 `supplier-intel/submission-parser.ts` 的 `validatePublicHttpUrl` 做 http / https 白名单与长度上限）。
- 可复用：`validatePublicHttpUrl`；FIX-13 的 `toStorableText`（`src/lib/files/extracted-text.ts`，U+0000 → 空格、落单代理字符 → U+FFFD）；unpdf（`tender-auto-analysis/page-parse.ts` 的用法）；`logAudit`（`src/lib/audit/logger.ts`）。
- 任务运行时：招投标 Job 由 `src/app/api/cron/agent-runs` 这个既有 cron 处理（让出后自触发续跑）。也就是说调研 Job 的分支步骤本身就跑在 cron 进程里——「定时任务上下文直接拒绝」不能按「当前是不是 cron 进程」判断，只能按「这次读页属于哪个 Job、那个 Job 是不是人发起的调研 Job」判断（见 D1）。
- 需求方拍板（2026-11-22）：读公开网页全文开放；robots 看并遵守（判断点 1），ImportYeti 除外；被挡即停不取消；所有站点同一读页额度。

## 不确定处的核对结论（与本 change 有关的）

- **第 5 条（HTML 转文本放哪）**：任务书说现成函数在 `src/lib/google-email.ts`。实际全库已有四份：`google-email.ts`（私有，正则版）、`trade/tools.ts`（私有）、`projects/generate/tender-doc-html.ts`（导出，只为本文件的模板服务，只还原三个转义）、`trade/email-forward-parse.ts`（导出，单趟线性扫描、块级换行、表格制表符、实体解码、病态输入不回溯，有测试）。结论：把 `email-forward-parse.ts` 那一份挪到 `src/lib/text/html-to-text.ts`，输入上限做成参数（邮件解析仍传 200 000 字符，行为逐项不变；读网页传 2 MB），原处改为调用。不另写第五份；另外三份不在本次范围（各自的调用方行为要另行核对，挪动有回归风险）。
- **第 8 条（各站条款与 robots）**：本 change 不逐站核对条款；robots 一律在运行时读取并遵守（ImportYeti 除外，见 D6）。第二批开工前补逐站核对，写进交接文档。
- **第 7 条（同址只读一次的缓存放哪）**：本 change 只定义树级缓存的接口（取 / 存），默认实现是进程内的；TREE-2 用 Job 的步骤结果实现它（跨切片持久），不新建存储。

## Goals / Non-Goals

**Goals**
- 一个读网页入口，六条读网页规则与安全护栏全部在代码里强制，用注入的假网络把每条都测到。
- 开关关、没有调用方时零变化：本 change 合并后生产上没有任何代码路径会发出读网页请求。

**Non-Goals**
- 不接调用方：`src/lib/tender-intel/**`、`src/lib/supplier-intel/**`、`src/lib/tender-workforce/**`、`src/app/**` 不改一行。
- 不改 `src/lib/tender-intel/tavily-client.ts` 与搜索的任何用法。
- 不改 `src/lib/google-email.ts`、`src/lib/trade/tools.ts`、`src/lib/projects/generate/tender-doc-html.ts` 里的三份 HTML 转文本。
- 不改 `src/lib/workforce-runtime/**`、`prisma/**`、`vercel.json`。
- 不做组织设置的编辑页面与接口。

## Decisions

### D1 读页上下文只能从一条「人发起的调研 Job」建出（规则 1）
`createResearchReadContext({ orgId, jobId, scheduled?, … })` 读 `AgentRun` 行：同组织、`metadata.researchTree` 存在且 `initiatedByUserId` 非空、`trigger ∈ { "human_start", "requirements_confirmed" }`；调用方传 `scheduled: true`、没有 `jobId`、开关关着都直接抛错。`readPublicPage(url, ctx)` 只接受这个函数造出来的上下文（内部标记，手拼的对象被拒）。`metadata.researchTree` 的写入方是 TREE-2 的「开始调研」接口；本 change 定下这个契约（`{ version: 1, initiatedByUserId, trigger }`）。
- 否决「按当前进程是不是 cron 判断」：调研 Job 本身就由 `api/cron/agent-runs` 处理，这样判断会把合法的调研也挡掉，而真正的定时任务换一个进程照样能调。
- 否决「只要求调用方传一个 jobId 字符串」：任何定时任务都能编一个；必须到库里确认它是人发起的调研 Job。

### D2 自己发请求，连接时再校验地址（安全）
用 Node 自带的 `http` / `https.request`，`lookup` 换成「解析 → 全部地址过内网判断 → 有一个不合格就报错」的函数，所以「先解析校验、再由连接库自己解析」之间换了地址（DNS 重绑定）也连不上内网。请求前代码层面还先解析一次做同样判断（假网络测试走这一层）。只发 GET；请求头固定为用户代理、`Accept`、`Accept-Encoding: gzip, deflate, br`、`Accept-Language`，没有 cookie 罐；响应按 `Content-Encoding` 解压，解压后计数到 2 MB 截断（防压缩炸弹）；每次尝试一个 15 秒的总计时（连接 + 收头 + 收正文）。
- 否决全局 `fetch`：Node 的 `fetch` 不能换解析函数（要装 undici 才能传 dispatcher，新增依赖）；`redirect: "follow"` 不能逐跳校验，`manual` 也拿不到连接地址。
- 否决只在请求前解析校验：挡不住 DNS 重绑定。

### D3 结果类别（五类）与被挡原因
`outcome ∈ ok | blocked | unreachable | refused | limit`，对应 TREE-2 交接单的「查到 / 被挡 / 未接通 / （拒绝不计入）/ 到上限」。`blocked` 字段只在被挡时非空：`{ reason, messageZh }`，原因有 `http_401 | http_403 | http_407 | login_redirect | login_page | captcha | robots_disallow | robots_unavailable | rate_limited | site_blocked_in_branch`。404 等其它 4xx、跳转过多、截止时间到、PDF 抽不出文字归「未接通」；内网地址、非默认端口、带凭证、「不碰」名单、直接给的登录地址、不支持的类型归「拒绝」。一支里任何一次「被挡」都把该站点记为这一支被挡过（任务书 TREE-2「同一站点在这一支里被挡过一次，这一支不再读它」，按字面执行，含 robots 不许读）。
- 否决只用 `blocked` 一个字段表达所有失败：TREE-2 要区分「被挡」（换来源）与「未接通」（可以换个时间再试），混在一起会让「被挡即停」与「临时故障可重试」无法分开验证。

### D4 登录页与人机验证的识别（被挡即停）
- 登录地址：路径里有一段恰好是登录词（`login`、`signin`、`sign-in`、`logon`、`sso`、`auth`、`oauth`、`cas`、`wp-login` 等，去掉 `.php` / `.aspx` 等扩展名后整段相等，所以 `/author/…`、`/sign-in-help` 不算），或主机名以 `login.`、`sso.`、`auth.`、`accounts.` 等开头（表驱动）。跳转到登录地址 → 被挡（不请求该地址）；调用方直接给的网址就是登录地址 → 「拒绝」、不请求，也不把该站记为这一支被挡过（模型提了一个登录地址，不该让整个政府站点在这一支里作废）。
- 登录页：页面里有密码输入框（`type="password"`），且转出的正文少于 2 000 字符。很多公开页面在页眉放一个登录框，正文很多的不算。
- 人机验证：页面里出现已知标记（`g-recaptcha`、`h-captcha` / `hcaptcha.com`、`/cdn-cgi/challenge-platform/`、`cf-chl-`、标题「Just a moment...」、`Attention Required! | Cloudflare`）。
- 人机验证的标记分强弱：强标记（Cloudflare 等待页标题、`cf-chl-`、DataDome、Incapsula、PerimeterX）出现即判；弱标记（reCAPTCHA、hCaptcha、Turnstile、`/cdn-cgi/challenge-platform/`）只在正文少于 2 000 字符时判——正常页面也会在页尾表单嵌验证码，CDN 也会给正常页面注入检测脚本。
- 否决「页面里只要有 password 输入框就算登录页」：会把大量带页眉登录框的政府与厂家页面误判为被挡。

### D5 限量、间隔与重试的计数口径
- 额度对象由调用方给（TREE-2 每支一个，初值 12，可被组织调低）。一次 `readPublicPage` 在确定要发页面请求时扣 1；同一次读页里的跳转、重试与 robots 请求不扣。缓存命中、拒绝、这一支已被挡的站点不扣。
- 站点间隔：树级的「站点节拍器」，按主机名串行排队，每次请求开始前等到「上次开始 + 2 秒」。并行的多支共享同一个节拍器（同一进程内）。跨进程（两个函数实例同时跑同一棵树的不同支）不保证——TREE-2 把同一棵树的分支放在同一次处理里并行（`WORKFORCE_JOB_MAX_PARALLEL_TASKS`），交接文档记为已知限制。
- 重试：超时 / 连接中断 / 5xx 最多再试 2 次，等待 1 秒、3 秒；429 只在 `Retry-After` 给出秒数或日期、且不超过 30 秒时等够再试一次。等待与重试都不超过上下文的截止时间（TREE-2 传切片截止时间，做法同 FIX-12）。
- 否决「重试也扣额度」：额度是「读几个页面」，按尝试次数扣会让一个不稳定的站点吃掉一支的大半额度。

### D6 站点名单与 robots
- 代码常量（`site-policy.ts`）：`deny`（预置 `detail.1688.com`、`login.1688.com`、`merx.com`、`linkedin.com`、`facebook.com`、`instagram.com`——要登录才能看的站，后缀匹配）；`humanInitiated`（预置 `importyeti.com`）；`allow`（预置 `canada.ca`、`gc.ca`、`canadabuys.canada.ca`，与默认同样处理，只是文档化）。
- 组织覆盖：`Organization.settingsJson.researchTree.sites = { deny?: string[], allow?: string[] }`；只收这两类，合并时 `deny` 永远优先。不收 `humanInitiated`：不看 robots 是一个要拍板的放宽，不能由组织设置自己放开。
- robots：按 RFC 9309——取 `QingyanResearchBot` 组，没有则取 `*` 组；`Allow` / `Disallow` 最长匹配，同长 `Allow` 优先；支持 `*` 与 `$`；只读前 500 KiB。4xx（含 401 / 403）视为没有限制；5xx、超时、连接失败视为全部不许读（RFC 9309 §2.3.1.3 / §2.3.1.4）。robots 结果按「协议 + 主机 + 端口」在树级缓存。
- 否决「robots 401 / 403 也视为不许读」：RFC 明确 4xx 视为不可得，政府站点常对 `/robots.txt` 返回 403，会让大量页面无谓被挡。

### D7 读到的内容
- HTML / XHTML：按 `Content-Type` 的 charset（没有则看 `<meta charset>`，再没有用 UTF-8）解码后转纯文本（公共模块，见「不确定处」第 5 条）。
- 纯文本：同样解码。
- PDF：unpdf 逐页抽文字，页与页之间空一行，再过 `toStorableText`。截断的 PDF 抽不出来归「未接通」（原因 `pdf_unreadable`）。
- 其它类型（含没有 `Content-Type`）：「拒绝」，不读正文。
- 所有正文最后都过 `toStorableText`（U+0000、落单代理字符），后续写库不会因此失败。
- 返回字段 `text` 为空字符串表示没有正文。

### D8 审计
每次真正发出页面请求（缓存命中、拒绝、到上限不写）写一条 `AuditLog`：`action = "research.web_read"`、`targetType = "research_job"`、`targetId = jobId`、`userId = 发起人`、`afterData = { branchKey, url, finalUrl, outcome, httpStatus, chars, truncated, reason, attempts, site }`。正文、请求头、响应头一律不写。写审计失败只记日志（`logAudit` 自己就吞错），不影响读页结果。
- 否决「每次请求（含重试、robots）各写一条」：一棵树最多 24 × 12 次读页，再乘重试会到上千条；一次读页一条已能回答「读了什么、结果如何」。

### D9 开关模块放在 `src/lib/tender-research-tree/flags.ts`
后面七个 change 都要用同一个开关，放在调研树自己的目录里；读网页模块引用它。写法与 `tender-intel/sourcing-flags.ts` 相同（`envBool` / `envList` 各自一份私有小函数，照现有做法，不抽公共）。

### D10 TREE-0 的落点
`openspec/config.yaml` 硬纪律第 7 条在 KPI-2 例外之后补「例外二（TREE-0，Evan 2026-11-22 拍板）」，写明：分支子代理在分支内自行决定搜索与读页；每支最多 16 次搜索、12 次读页；每棵树最多 24 个分支、最深 5 层；每支模型请求最多 30 次（每次决定一步，16 + 12 次动作加收尾 2 次）；条款员每棵树一次；核对员每条待核事实一次；只由人发起、开关默认关；骨架分叉、单价、可比度、区间与结论句仍是规则与纯函数。同处写明两条已拍板的范围反转：读公开网页全文（反转 CHAIN 任务书「系统不抓任何第三方网站」与供应商发现「只用搜索索引」）；给出建议报价区间（改 CHAIN-2「不推导建议报价」，区间由代码从已核实证据算，最终报价仍由人定）。文件头的来源注释加一行。
- 交接文档 `docs/QINGYAN_TENDER_FLOW_HANDOFF.md` §0.5k 第 12 条写着「`openspec/config.yaml` 由 Evan 改」。本处改动是 Evan 在任务书 TREE-0 里亲自要求、并写明了内容的登记；PR 正文写明这一点。
- 否决把例外写进单独的文件：硬纪律的唯一事实源是 `openspec/config.yaml` 的 `context`，例外必须写在同一处才会注入每一次 `/opsx:*`。

## 与八条硬纪律的关系

1. 零 schema：遵守。不新增表、字段、迁移；组织覆盖读既有的 `Organization.settingsJson`，审计写既有的 `AuditLog`。
2. 出站先审批：不涉及。读网页是取数，不对外发送任何内容；只发 GET、不提交表单。
3. 不新增队列 / 定时任务：遵守。没有新的 cron、队列、租约；站点节拍器是一次树处理内的内存排队，不持久、不跨请求。文件名不含 engine / queue / lease / scheduler 等（`scripts/test-runtime-architecture.sh` 通过）。
4. 脱敏：不涉及。读页不带任何我方数据（请求里只有网址与固定请求头）；搜索词的脱敏在 TREE-2。
5. 不爬登录页：遵守并机制化。不登录、不带凭证、不存 cookie；登录页 / 验证码 / 401 / 403 / 登录跳转即停；「不碰」名单预置要登录的站。
6. 邮箱分离：不涉及。
7. 确定性优先：本 change 不增加模型调用；TREE-0 登记例外（见 D10），本 change 本身没有模型调用。
8. 测试注册：新增的 `web-reader.test.ts`、`web-reader-pure.test.ts`、`web-reader-context-db.isolated.test.ts`、`html-to-text.test.ts` 注册进 `scripts/test-all.sh`（纯函数的两份同时进 `scripts/test-ci-unit.sh`）。

## Risks / Trade-offs

- 登录页识别是启发式：可能漏判（返回 200 的登录页正文很多）——漏判的后果是读到一页没有用的文字，不会登录、不会带凭证；也可能误判（正文少的公开页面带密码框）——后果是该支换来源。
- 站点间隔只在同一进程内保证（D5）。
- robots 对 5xx 视为全部不许读：站点 robots 不稳定时会被挡，符合 RFC，且只影响该站点。

## 验证方式

- `npx tsx src/lib/web-reader/__tests__/web-reader.test.ts`（全部假网络：内网与跳转到内网、被挡不重试、超时 / 5xx 重试 2 次、429 等待、额度与间隔、同址去重、定时任务被拒、PDF U+0000、截断、类型、请求头、审计不含正文）。
- `npx tsx src/lib/web-reader/__tests__/web-reader-pure.test.ts`（开关真值表、内网地址判断、robots 解析、站点名单合并、登录页识别、Retry-After 解析）。
- `NODE_ENV=test npx tsx src/lib/web-reader/__tests__/web-reader-context-db.isolated.test.ts`（隔离库：Job 校验与审计落库）。
- `npx tsx src/lib/text/__tests__/html-to-text.test.ts`、`npx tsx src/lib/trade/__tests__/email-forward-parse.test.ts`（挪动前后逐项相同）。
- 开关关 = 零变化：`git grep -n "web-reader" -- src/app src/lib/tender-intel src/lib/tender-workforce src/lib/workforce-runtime` 为空（没有调用方）；`web-reader.test.ts` 里开关关的用例。
- 门禁：`npm test`（与 main 基线对比）、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`openspec validate public-page-reader --strict`、`git diff origin/main -- prisma/ vercel.json src/lib/workforce-runtime/` 为空。

## Migration Plan

无迁移。回退：revert 本 PR（没有调用方、没有数据）。

## Open Questions

无（判断点 1 按默认；其余新选择见 D1–D10，写进交接文档）。
