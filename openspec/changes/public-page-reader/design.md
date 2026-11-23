# Design：读公开网页（TREE-1，含 TREE-0）

## Context

- 现状（main `451bb0d3` 只读核对）：`src/lib/tender-intel/tavily-client.ts` 只调搜索接口（`search_depth: "basic"`，每次 5 条）；`tender-intel/`、`supplier-intel/` 下没有读网页正文的代码；全库没有内网地址判断的现成函数（只有 `supplier-intel/submission-parser.ts` 的 `validatePublicHttpUrl` 做 http / https 白名单与长度上限）。
- 可复用：`validatePublicHttpUrl`；FIX-13 的 `toStorableText`（`src/lib/files/extracted-text.ts`，U+0000 → 空格、落单代理字符 → U+FFFD）；unpdf；`logAudit`（`src/lib/audit/logger.ts`）。
- 任务运行时：招投标 Job 由既有 cron `src/app/api/cron/agent-runs` 处理（让出后自触发续跑）。调研 Job 的分支步骤本身就跑在 cron 进程里——「定时任务上下文直接拒绝」不能按「当前是不是 cron 进程」判断，只能按「这次读页属于哪个 Job、那个 Job 是不是人发起的调研 Job」判断（D1）。
- `createWorkforceJob` 的 `extraMetadata` 只收原始值（≤16 键、字符串 ≤500、保留键拒绝；`src/lib/workforce-runtime/job.ts:110-134`），`initiatedByUserId`、`workDomain` 是运行时自己写的保留键——调研标记据此平铺（D1）。
- 需求方拍板（2026-11-22）：读公开网页全文开放；robots 看并遵守（判断点 1），ImportYeti 除外；被挡即停不取消；所有站点同一读页额度。

## 不确定处的核对结论（与本 change 有关的）

- **第 5 条（HTML 转文本放哪）**：任务书说现成函数在 `src/lib/google-email.ts`。实际全库已有四份：`google-email.ts`（私有，正则版）、`trade/tools.ts`（私有）、`projects/generate/tender-doc-html.ts`（导出，只为本文件的模板服务，只还原三个转义）、`trade/email-forward-parse.ts`（导出，单趟线性扫描、块级换行、表格制表符、实体解码、病态输入不回溯，有测试）。结论：把 `email-forward-parse.ts` 那一份挪到 `src/lib/text/html-to-text.ts`，输入上限做成参数（邮件解析仍传 200000 字符，行为逐项不变；读网页传 2 MB），原处改为调用。不另写第五份；另外三份不在本次范围（各自的调用方行为要另行核对，挪动有回归风险）。
- **第 8 条（各站条款与 robots）**：本 change 不逐站核对条款；robots 一律在运行时读取并遵守（ImportYeti 除外，见 D6）。第二批开工前补逐站核对，写进交接文档。
- **第 7 条（同址只读一次的缓存放哪）**：本 change 只定义会话缓存的接口（取 / 存），默认实现是进程内的；TREE-2 用 Job 的步骤结果实现它（跨处理持久），不新建存储。

## Goals / Non-Goals

**Goals**
- 一个读网页入口，六条读网页规则与安全护栏全部在代码里强制，用注入的假网络（与本机起的服务）把每条都测到。
- 开关关、没有调用方时零变化：本 change 合并后生产上没有任何代码路径会发出读网页请求。

**Non-Goals**
- 不接调用方：`src/lib/tender-intel/**`、`src/lib/supplier-intel/**`、`src/lib/tender-workforce/**`、`src/app/**` 不改一行。
- 不改 `src/lib/tender-intel/tavily-client.ts` 与搜索的任何用法。
- 不改 `src/lib/google-email.ts`、`src/lib/trade/tools.ts`、`src/lib/projects/generate/tender-doc-html.ts` 里的三份 HTML 转文本。
- 不改 `src/lib/workforce-runtime/**`、`prisma/**`、`vercel.json`、`next.config.ts`。
- 不做组织设置的编辑页面与接口。

## Decisions

### D1 读页会话只能从一条「人发起的调研 Job」建出（规则 1）
生产入口 `createResearchReadSession({ orgId, jobId, scheduled? })`（`src/lib/web-reader/index.ts`）调 `createResearchReadSessionWithDeps`，读 `AgentRun` 的 `id / orgId / status / metadata`，逐项核对：同组织；`metadata.workDomain === "tender"`；`metadata.researchTree === true` 且 `researchTreeVersion === 1`；`researchTrigger ∈ { "human_start", "requirements_confirmed", "human_rerun", "human_page_intake" }`（开始调研 / 确认招标要求 / 某一支重新查 / 人工补页后重算）；发起人取运行时写的保留键 `metadata.initiatedByUserId`（调用方没法经 extraMetadata 伪造）；状态不是 completed / failed / cancelled。调用方传 `scheduled: true`、没有 `jobId`、开关关着都直接抛错。会话的 `forBranch({ branchKey, budget, blockedSites?, deadlineAt?, allowUrl })`（`allowUrl` 必填）造每一支的上下文；`readPublicPage(url, ctx)` 只接受这样造出来的上下文（内部 WeakSet 登记，手拼、展开复制都被拒），每次读页再查一次开关（关开关即停）。TREE-2 的「开始调研」接口经 `createWorkforceJob` 的 `extraMetadata` 写 `{ researchTree: true, researchTreeVersion: 1, researchTrigger }`。
- 否决「按当前进程是不是 cron 判断」：调研 Job 本身就由 `api/cron/agent-runs` 处理，这样判断会把合法的调研也挡掉，而真正的定时任务换一个进程照样能调。
- 否决「只要求调用方传一个 jobId 字符串」：任何定时任务都能编一个；必须到库里确认它是人发起的调研 Job。
- 否决「标记写成一个对象 `metadata.researchTree = {…}`」（第一稿）：`extraMetadata` 只收原始值，对象只能建完 Job 再补写，补写之前处理器就可能认领这个 Job；平铺后建 Job 时一次写全。
- 测试接缝 `createResearchReadSessionWithDeps`（可注入 `loadJob`、`env`）只给测试用。守卫测试扫 `src/` 与 `scripts/`：把 import / require / import() 里的模块路径规范化（去 `./`、多余的 `/`）后，含 web-reader 的只许恰好是 `@/lib/web-reader`；接缝名、读库与写审计的函数名、审计动作字面量 `research.web_read` 不许出现在 web-reader 目录以外；生产入口不收 `env`。刻意混淆（拼字符串取属性等）静态守卫拦不住，由代码审查兜底（第二轮挑错交叉验证 Y6）。
- **所有影响判断的状态都在读页层内部**（第二轮挑错交叉验证 Y2：调用方曾能清空会话上的站点名单、清空被挡站、改审计归属、把截止时间改空）：会话状态与分支状态放在模块内的 WeakMap 里；调用方拿到的会话与上下文是冻结的只读外观，站点名单深冻结，额度与被挡站是快照；`forBranch` 的每个原始值只读一次（防 getter 前后给不同的值），截止时间只收有限数或不给。
- **重建会话不清零**（Y3）：建会话时按 `jobId` 读这棵树的 `research.web_read` 审计（审计里加了 `blockedSite`），每支「发过页面请求的读页」条数计入已用额度、被挡站并进被挡站，分支总数（审计里已有的 + 本会话的）≤24。零 schema；审计写入失败（`logAudit` 吞错）时会少记，属于已知的宽松方向。
- 会话只活一个处理切片（≤240 秒）：Job 被取消后，下一切片建会话时被拒；同一切片里已建的会话不再查 Job 状态。`scheduled` 由调用方自报、`researchTrigger` 不是运行时保留键——规则 1 最终依赖「只有 TREE-2 的人发起接口写调研标记」，写进 TREE-2 的验收（守卫测试：`researchTree: true` 只许出现在那几个接口里）。

### D2 自己发请求，连接时再校验地址（安全）
用 Node 自带的 `http` / `https.request`，`lookup` 换成「解析全部地址 → 有一个不合格就报错」的函数，所以「先解析校验、再由连接库自己解析」之间换了地址（DNS 重绑定）也连不上内网；主机名是 IP 字面量时 Node 不走 lookup，传输层先自己判断。请求前读页层还先解析一次做同样判断（假网络测试走这一层），解析超过 5 秒按解析失败。只发 GET；请求头固定为用户代理、`Accept`、`Accept-Encoding: gzip, deflate, br`、`Accept-Language`，没有 cookie 罐；`agent: false`（不复用连接、也不走 `HTTP(S)_PROXY`）；响应按 `Content-Encoding` 解压，解压后计数到 2 MB 截断（防压缩炸弹）；每次尝试一个 15 秒的总计时（连接 + 收头 + 收正文）。传输层有一个只给测试的接缝 `createNodeNet({ isBlockedAddress })`，用来在本机起服务测正常路径。
- 否决全局 `fetch`：Node 的 `fetch` 不能换解析函数（要装 undici 才能传 dispatcher，新增依赖）；`redirect: "follow"` 不能逐跳校验，`manual` 也拿不到连接地址。
- 否决只在请求前解析校验：挡不住 DNS 重绑定。

### D3 结果五类与原因；与 TREE-2 交接单的对应
`outcome ∈ ok | blocked | unreachable | refused | limit`，中文名唯一一份 `OUTCOME_ZH`：读到 / 被挡 / 打不开 / 不读 / 到上限。`blocked` 字段只在被挡时非空：`{ reason, messageZh, site }`，`site` 是真正挡住我们的站。原因与中文句唯一一份（`pure.ts` 的 `REASON_ZH`）：被挡句以「未读取」结尾、打不开句以「没打开」结尾、不读句以「不读」结尾，不出现「robots」这类技术词；页面要说明是哪个站时拼成「〈站名〉被挡：〈原因句〉」。读页额度用完是「读页次数到上限，未读」，整支一级的「到上限，未查完」由 TREE-2 写。
- 与 TREE-2 交接单 `notFound` 原因（没有 / 未接通 / 被挡 / 到上限）的对应：读到 → 交给子代理判断，落 `found` 或 `notFound`「没有」；被挡 → 被挡；打不开 → 未接通；不读 → 只记进这一支的明细，整支只碰到「不读」时按「被挡」写；到上限 → 到上限。
- 不用「拒绝」「未接通」作读页一级的类别名：「拒绝」容易被读成对方拒绝，且与审批按钮、TREE-4 的「被拒」撞词；「未接通」在情报区域已经表示「来源还没接进系统」（`tender-competition/source-status.ts`）。
- 否决只用 `blocked` 一个字段表达所有失败：TREE-2 要区分「被挡」（换来源）与「打不开」（可以换个时间再试），混在一起会让「被挡即停」与「临时故障可重试」无法分开验证。

### D4 登录页与人机验证的识别（被挡即停）
- 登录地址：路径里有一段恰好是登录词（`login`、`signin`、`sign-in`、`signon`、`logon`、`sso`、`auth`、`oauth`、`authentication`、`wp-login`、`saml`、法语 `connexion` / `se-connecter` 等；去掉 `;jsessionid=…` 路径参数与 `.php` / `.aspx` 等扩展名后整段相等，所以 `/author/…`、`/sign-in-help`、`/news/cas` 不算），或查询值里有这样一段（`?route=account/login`），或主机名以 `login.`、`signin.`、`sso.`、`auth.`、`accounts.`、`idp.` 开头。跳转到登录地址、或页面用 `<meta http-equiv="refresh">` 跳到登录地址 → 被挡（不请求该地址，挡住我们的是发出跳转的站）；调用方直接给的网址就是登录地址 → 不读、不请求，也不把该站记为这一支被挡过（模型提了一个登录地址，不该让整个政府站点在这一支里作废）。
- 登录页：页面里有密码输入框（`type="password"`），且转出的正文少于 2000 字符。很多公开页面在页眉放一个登录框，正文很多的不算。
- 人机验证的标记分强弱：强标记（Cloudflare 等待页标题、`Attention Required! | Cloudflare`、`_cf_chl_opt`、DataDome、Incapsula、PerimeterX）出现即判；弱标记（reCAPTCHA、hCaptcha、Turnstile、`/cdn-cgi/challenge-platform/`）只在正文少于 2000 字符时判——正常页面也会在页尾表单嵌验证码，CDN 也会给正常页面注入检测脚本。不用 `cf-chl-` 作强标记：正文里出现这几个字就会把整站判成被挡。
- 否决「页面里只要有 password 输入框就算登录页」：会把大量带页眉登录框的政府与厂家页面误判为被挡。

### D5 限量、间隔、重试与截止的计数口径
- 额度由调用方给（TREE-2 每支一个，初值 12，可被组织调低），并与审计历史取较大的已用数（D1）。每支发起取 robots 最多 12 次（第二轮挑错 Y7：额度 1 时也能对 30 个站各取一次 robots），超了按到上限。`forBranch` 拒绝「剩余 + 已用 > 12」或不是非负整数的额度，同一会话里同一支只能建一次上下文；额度拷进读页层内部记账（WeakMap），`ctx.budget` 只是只读快照——建好后改调用方的对象不起作用（挑错交叉验证 X4）。跨会话（每个切片新建会话）的额度靠调用方把 `used` 持久化后传回，**这是 TREE-2 的硬要求**。一次读页在**真正发出第一个页面请求前一刻**扣 1（`beforeSend` 钩子）；同一次读页里的跳转、重试与 robots 请求不扣；缓存命中、不读、这一支已被挡的站、时间到了而没发请求的都不扣。额度为 0 时连 robots 也不请求。
- 站点间隔：进程内的「站点节拍」，按时钟对象分开（生产是一个模块级时钟 → 全进程共享；测试的每个假世界各自一份），按站点键（主机名去掉 `www.`）记「下一次最早可以开始的时间」。每次请求前**同步预约**：算出开始时间并立刻占住（之后的预约至少再晚 2 秒），再等到开始时间；开始时间超过本支剩余时间就不预约、直接「时间到了」。跨进程（两个函数实例同时读同一站）不保证，交接文档记为已知限制。
- 重试：超时 / 连接中断 / 5xx 最多再试 2 次，等待 1 秒、3 秒；429 只在 `Retry-After` 给出纯数字秒数、或带 GMT 的 HTTP 日期、且不超过 30 秒时等够再试一次。每次请求前再查一次这一支被挡过的站。
- 截止：等待、重试、站点排队、域名解析、等别的支的同址结果、取 robots 都受本支截止时间约束（与截止赛跑的计时器在赛跑结束时清掉，不留悬着的计时器）；单次超时被截止缩短后超时的记「时间到了」（不进缓存）。TREE-2 传切片截止时间，做法同 FIX-12。
- 否决「重试也扣额度」：额度是「读几个页面」，按尝试次数扣会让一个不稳定的站点吃掉一支的大半额度。
- 否决「先扣额度再查截止」（第一稿）：时间不够时会扣了额度却没发请求。
- 否决「站点节拍按 Promise 链排队」（第一稿）：排在后面的支无法在入队前知道自己要等多久，会越过截止时间。
- 被挡站点的判定按后缀：gov.example 在这一支被挡后，m.gov.example 同样不再请求（不靠换子域名绕过）；反过来 m.gov.example 被挡不影响 gov.example（父域名不一定是同一台服务器）。主机名是 IP 地址的网址一律不读（`ip_literal`）：被挡后不靠换成 IP 绕过，公开的政府与厂家网站也不用 IP 地址。
- 等审计写库与调用方的持久缓存取 / 存不受截止约束（毫秒级；按截止中断会丢审计行）——挑错交叉验证 X12，不改。

### D6 站点名单与 robots
- 代码常量（`src/lib/web-reader/pure.ts` 的 `PRESET_SITE_POLICY`）：`deny`「不碰」（预置 `detail.1688.com`、`login.1688.com`、`merx.com`、`linkedin.com`、`facebook.com`、`instagram.com`——要登录才能看的站；`qingyan.ca`、`qingyan.ai`、`vercel.app`——青砚自己的站与预览域名，不对自家站点发请求；后缀匹配）；`humanInitiated`「按人发起处理」（预置 `importyeti.com`）；`allow`「可以读」（预置 `canada.ca`、`gc.ca`、`canadabuys.canada.ca`，与默认同样处理、照样看 robots，只是文档化）。
- 组织覆盖：`Organization.settingsJson.researchTree.sites = { deny?: string[], allow?: string[] }`；只收这两类，分类时 `deny` 永远先查（组织把 ImportYeti 加进 `deny` 就不读）。不收 `humanInitiated`：不看 robots 是一个要拍板的放宽，不能由组织设置自己放开。
- robots：按 RFC 9309——取 `QingyanResearchBot` 组（`User-agent` 值的版本号部分忽略），没有则取 `*` 组；规则与路径按 UTF-8 百分号编码归一（非 ASCII 编码；非保留字符 `A–Z a–z 0–9 - . _ ~` 的 `%xx` 解码；其余 `%xx` 大写）后比较；`Allow` / `Disallow` 最长匹配，同长 `Allow` 优先；支持 `*` 与 `$`，路径含查询串；只读前 500 KiB。4xx（含 401 / 403）视为没有限制；429、5xx、超时、连接失败视为全部不许读（RFC 9309 §2.3.1.3 / §2.3.1.4；429 按读取失败处理与主流爬虫一致）。规则超过 5000 条或单条模式超过 512 字 → 读取失败；一次判断的匹配步数预算 200 万步，用完按不许读——对方没法用超大规则表占满 CPU。robots 的跳转只跟到别处的 `/robots.txt`（最多 5 次，RFC 建议）；跳到别的页面（登录页等）视为没有 robots、不请求；跳到登录地址视为没有 robots、不请求；跳到 IP 地址按读取失败、不请求（第二轮挑错 Y4）；跳到「不碰」站不请求、按读取失败；跳到这一支被挡过的站不请求、记为「这一支被挡」——这个结论与那一支的状态有关，不进会话缓存（挑错交叉验证 X3）。robots 结果按「协议 + 主机 + 端口」在会话里缓存；某支取 robots 时它自己的时间到了、或跳到了它被挡过的站，结果不缓存，别的支自己再取；等别的支取 robots 也受本支截止约束（X2）。
- 否决「robots 401 / 403 也视为不许读」：RFC 明确 4xx 视为不可得，政府站点常对 `/robots.txt` 返回 403，会让大量页面无谓被挡。

### D7 读到的内容
- HTML / XHTML：按 `Content-Type` 的 charset（没有则看 `<meta charset>`，再没有用 UTF-8）解码后转纯文本（公共模块，见「不确定处」第 5 条）。
- 纯文本：同样解码。任务书只写了 HTML 与 PDF；纯文本（`.txt` 公告、CSV 预览）风险与 HTML 转出的文本相同，收下更有用，所以一并收。
- **PDF：本层不解析**（网址以 `.pdf` 结尾的不发请求；返回 `application/pdf` 的不解析正文；都是「不读」，原因写明请用「我来补一页」上传）。过程：第一稿直接用 unpdf 抽文字——审查员③实测 58 KB 的 PDF 让 unpdf 跑 21.8 秒、用 3.4 GB；第二稿加了预扫描（解压量上限 + 30 页 + 8 秒）——第一轮挑错找到三种绕过；第三稿收紧预扫描——第二轮挑错又找到六种语法变体绕过（间接引用的 /Filter、名字转义、`stream` 后只跟 `\r` 等），并用一个 1.1 KB、不超过任何上限的 PDF（一个表单对象被调用 6000 次）让单页解析跑 11 秒、占 711 MB。结论：靠正则预扫描做不到可靠，进程内解析 PDF 限不住成本。
- 进程隔离（worker 线程或子进程 + 内存上限 + 超时终止）才是正解，但本 PR 不做：unpdf 被 webpack 打进服务端代码（`next build --webpack`，不在 `serverExternalPackages`），要在 worker 里加载它就得改 `next.config.ts` 的打包方式，会改变既有上传解析（招标文件页级解析、文件列表解析、宣传册解析）加载 unpdf 的方式——开关关着生产也有变化；worker 在 Vercel 上的打包与运行在本地也验证不了。
- **与任务书的出入**：任务书 TREE-1「PDF 用现有的 unpdf 抽文字」与测试项「PDF 的 U+0000 被清」本 PR 没有做到——写进报告、PR 与交接，请 Evan 定：是另开一个改动做进程隔离（要改打包，不在本批授权内），还是维持「PDF 由人补页」。
- 其它类型（含没有 `Content-Type`）：不读，不读正文。
- 所有正文最后都清掉 U+0000、落单代理字符（`toStorableText`）、Unicode 标签字符（U+E0000–E007F）、双向控制符与零宽字符（常被用来藏指令）；后续写库不会因此失败。隐藏元素（`display:none` 等）里的文字不在本层处理，交给 TREE-2 的提示词约束（正文只作为数据进模型）。
- 返回结果冻结（含 `blocked` 子对象）：一支改不了缓存里别的支会拿到的结果。

### D8 审计
每次实际发出过请求（页面请求或 robots 请求；缓存命中、不读、到上限不写）的读页写一条 `AuditLog`：`action = "research.web_read"`、`targetType = "research_job"`、`targetId = jobId`、`userId = 发起人`、`afterData = { branchKey, url, finalUrl, outcome, httpStatus, chars, truncated, reason, attempts, robotsRequests, site }`，网址各截到 2048 字。`finalUrl` 只写实际请求过的最后一个网址（页面给的跳转目标没请求就不写）。正文、请求头、响应头一律不写。写审计失败只记日志（`logAudit` 自己就吞错），不影响读页结果。
- 否决「每次请求（含重试、robots）各写一条」：一棵树最多 24 × 12 次读页，再乘重试会到上千条；一次读页一条、带请求次数已能回答「读了什么、发了几个请求、结果如何」。
- 否决「只有发了页面请求的才写」（第一稿）：被 robots 挡下的读页同样向对方发过请求，「被挡」正是最该留痕的事件。

### D9 开关模块放在 `src/lib/tender-research-tree/flags.ts`
后面七个 change 都要用同一个开关，放在调研树自己的目录里；读网页模块引用它。写法与 `tender-intel/sourcing-flags.ts` 相同（`envBool` / `envList` 各自一份私有小函数，照现有做法，不抽公共）。

### D10 TREE-0 的落点
`openspec/config.yaml` 硬纪律第 7 条把原文「唯一例外（KPI-2…）」改为「例外一（KPI-2…）」（KPI-2 的正文一字不动；加了第二条，「唯一」必须去掉），其后补「例外二（TREE-0，Evan 2026-11-22 拍板）」，分「开放 / 上限 / 约束」三段写明：分支子代理在分支内由模型决定下一步搜索、读页或结束；每支最多 16 次搜索、12 次读页、模型请求 30 次（每决定一步算一次：16 + 12 次动作加收尾 2 次；同一次请求里的重试与换备用模型不另算）；每棵树最多 24 个分支、最深 5 层；条款员每棵树一次；核对员每棵树调用模型一次（一次核对全部待核事实）；以上上限写成常量，组织设置只能调低；调研树只由人发起（「开始调研」「重新查」、确认招标要求、补页后重算），任何定时任务都不发起（既有 agent-runs 处理器续跑人发起的调研 Job 不算）；开关默认关；骨架分叉、单价、可比度、建议区间与结论句仍是规则与纯函数，模型不写结论里的数字。另起一句写明同一拍板反转的两处范围：读公开网页全文（反转 CHAIN 任务书「系统不抓任何第三方网站」与供应商发现「只用搜索索引」；第 5 条不变）；给出建议报价区间（只限调研树的树干结论，区间只由代码从已核实的证据算，最终报价仍由人定；第 4 条与 CHAIN-2 价格对照卡 `tender/auto-supplier-run` 不变）。文件头的来源注释加一行。
- 「核对员一次」按字面登记为每棵树一次（把全部待核事实一次交给核对员；第一稿写成「每条一次、每棵树最多 60 次」，挑错交叉验证 X5 指出那是放宽，改回字面）。TREE-4 第 1 条「输入只有待核的值 + 网址」照样能满足：一次调用里每条只带值、网址与重读到的摘录。
- 「模型请求 30 次」与「组织设置只能调低」是实现者按授权定的数与做法（任务书只要求写明每处上限），config 里写明「由实现者定」。
- 另三处是实现者对任务书的解释，config 里同样标明、交接请 Evan 确认（第二轮挑错 Y9）：「既有 agent-runs 处理器续跑人发起的调研 Job 不算定时任务」（任务书「任何定时任务里不跑」与运行时由 cron 驱动之间的张力）；「补页后重算」「重新查」算人发起；每次模型请求内部的重试与换备用模型不另算（受既有调用层自身的重试上限约束）。
- 交接文档 `docs/QINGYAN_TENDER_FLOW_HANDOFF.md` §0.5k 第 12 条写着「`openspec/config.yaml` 由 Evan 改」——那一条说的是 FIX-22 的 G8。本处改动是 Evan 在任务书 TREE-0 里亲自要求、并写明了内容的登记；PR 正文写明这一点。`src/lib/sales/period/narrative-pure.ts` 文件头注释里「第 7 条的唯一例外」同步改为「例外一」（只改注释）。
- 否决把例外写进单独的文件：硬纪律的唯一事实源是 `openspec/config.yaml` 的 `context`，例外必须写在同一处才会注入每一次 `/opsx:*`。

### D11 网址本身是外发数据：调用方的网址检查
要读的网址由模型决定（TREE-2），网址的路径与查询串本身就会发到对方服务器——页面里一句「去读 https://x/?q=<上下文里的东西>」就是外泄通道。读页层没有项目上下文，不知道我方成本与目标价是多少；把搜索词的敏感词闸（`china-supplier-brief.ts`）套到网址上又会误挡（它的模式里有 `cost`、`budget`、预算 这类普通词，政府页面网址里常见）。所以本层要求 `forBranch({ allowUrl })`（必填，不给就拒绝建立上下文——挑错交叉验证 X7）：对调用方给出的每个网址先问一次，不过就「不读」（`url_not_allowed`），不发请求、不扣额度、不进缓存；跳转目标是对方给的，不过这道检查（否则正常跳转全被挡）。TREE-2 必须传这个检查，做两件事：网址只能来自本支的搜索结果、已读页面里的链接、标书引用或人工提供；网址里不得出现我方成本、毛利、目标价的数。
- 否决在读页层直接套敏感词闸：误挡太多，且仍挡不住「把数字编进网址」。

### D12 并发同址合并不会空转
第一稿里，发起读取的那支要等审计写完才删掉「正在读」的登记，而别的支在等它时，若拿到的是与发起方状态有关的结果（这一支被挡、时间到了），会在同一个已完成的等候对象上无限循环——全是微任务，事件循环被饿死，写库审计（宏任务）永远轮不到，进程卡死（两名审查员独立复现）。改为：登记的是 `p.finally(删除登记)`，等候方拿到结果时登记已经删了；循环里同一个等候对象只等一次；等候也受本支截止时间约束。测试用宏任务写审计复现两种情形。

## 与八条硬纪律的关系

1. 零 schema：遵守。不新增表、字段、迁移；组织覆盖读既有的 `Organization.settingsJson`；调研标记落在既有的 `AgentRun.metadata` JSON 列（零迁移，已有 `workDomain` 先例）；审计写既有的 `AuditLog`。
2. 出站先审批：不涉及。读网页是取数，不对外发送内容；只发 GET、不提交表单。
3. 不新增队列 / 定时任务：遵守。没有新的 cron、队列、租约；站点节拍是进程内的一张「站点 → 下一次最早开始时间」表，不持久、不跨请求。文件名不含 engine / queue / lease / scheduler 等（`scripts/test-runtime-architecture.sh` 通过）。
4. 脱敏：本层请求里只有网址与固定请求头，不带我方数据；网址本身由调用方决定，本层提供网址检查（D11），由 TREE-2 用来保证网址不含我方成本、毛利、目标价；搜索词过敏感词闸也在 TREE-2。
5. 不爬登录页：遵守并机制化。不登录、不带凭证、不存 cookie；登录页 / 验证码 / 401 / 403 / 407 / 登录跳转即停，直接给的登录地址不读；「不碰」名单预置要登录的站。
6. 邮箱分离：不涉及。
7. 确定性优先：本 change 不增加模型调用；TREE-0 登记例外（D10）。
8. 测试注册：新增 `web-reader.test.ts`、`web-reader-pure.test.ts`、`web-reader-edges.test.ts`、`web-reader-transport.test.ts`、`web-reader-context-db.isolated.test.ts`、`src/lib/text/__tests__/html-to-text.test.ts` 都注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（隔离库那份在 CI 里自动跳过，与仓库里其它隔离库测试同一写法）；`__tests__/fake-world.ts` 是测试夹具，不是测试文件。

## Risks / Trade-offs

- 登录页识别是启发式：可能漏判（返回 200 的登录页正文很多、JS 跳转）——后果是读到一页没有用的文字，不会登录、不会带凭证；也可能误判（正文少的公开页面带密码框）——后果是该支换来源。
- 同站 2 秒间隔只在同一进程内保证（D5）。
- robots 对 5xx / 429 视为全部不许读：站点 robots 不稳定时会被挡，符合 RFC，且只影响该站点。
- 一支里 robots 只禁了某一路径，也会让该站在这一支里作废（任务书「同一站点在这一支里被挡过一次，这一支不再读它」按字面执行）——会损失一些召回，交接给 TREE-2 留意。
- PDF 不在线解析：政府授标公告常是 PDF，这一层读不到，要人补页（TREE-6）——召回会少一截，等 Evan 定是否做进程隔离（D7）。

## 验证方式

- `npx tsx src/lib/web-reader/__tests__/web-reader.test.ts`、`web-reader-edges.test.ts`（全部假网络与虚拟时钟：规则 1–6、内网与跳转、每跳校验、被挡即停与记站、重试与 429、截止、额度与封顶、同站间隔跨会话、同址去重与并发合并不空转、站点名单与 robots、内容、冻结、审计）。
- `npx tsx src/lib/web-reader/__tests__/web-reader-pure.test.ts`（开关真值表、内网地址、robots 解析 / 归一 / 上限 / 步数预算、站点名单、登录地址 / 登录页 / 人机验证 / meta refresh、Retry-After、文案、唯一入口守卫）。
- `npx tsx src/lib/web-reader/__tests__/web-reader-transport.test.ts`（真实传输层，只连本机服务）。
- `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/web-reader/__tests__/web-reader-context-db.isolated.test.ts`（隔离库：Job 校验与审计落库）。
- `npx tsx src/lib/text/__tests__/html-to-text.test.ts`（挪动前实现算出的固定期望值）、`npx tsx src/lib/trade/__tests__/email-forward-parse.test.ts`。
- 开关关 = 零变化：全仓 `git grep -nE "web-reader|tender-research-tree|lib/text/html-to-text" -- src scripts`，除本模块、测试、注册行与 `trade/email-forward-parse.ts` 外为空（没有调用方）；开关关的用例。
- 门禁：`npm test`（与 main 基线对比）、`npm run test:ci`（不连库，同 CI）、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`openspec validate public-page-reader --strict`、`git diff origin/main -- prisma/ vercel.json next.config.ts src/lib/workforce-runtime/` 为空。

## Migration Plan

无迁移。回退：revert 本 PR（没有调用方、没有数据）。

## Open Questions

无（判断点 1 按默认；其余新选择见 D1–D12，写进交接文档）。
