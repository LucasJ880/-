# tender/public-page-reader Specification

## Purpose
规定情报调研读公开网页的唯一入口：只在由人发起的调研 Job 里读，表明身份、不登录、不带凭证，被挡即停、临时故障有限重试，按额度与站点间隔限量，同一读页会话内同一网址只读一次，读到的内容一律标为不可信资料，审计只记网址、状态与字数。

## ADDED Requirements

### Requirement: 只在人发起的调研 Job 里读
系统 SHALL 只在一条由人发起的情报调研 Job 的上下文里读网页：该 Job 属于调用方给出的组织、`workDomain` 为 `tender`、带调研标记（`researchTree` 为 `true`、`researchTreeVersion` 为 `1`）、发起方式（`researchTrigger`）只能是「开始调研」「确认招标要求」「重新查」「补页后重算」、有运行时写入的发起人（`initiatedByUserId`）、且没有结束（不是 completed / failed / cancelled）。系统 SHALL 在以下任一情况下拒绝建立读页会话、不发出任何网络请求：调用方声明自己处在定时任务中；没有给出 Job；Job 不存在、不属于该组织、不带调研标记或标记版本不认识；缺发起人；发起方式不是上述四种；Job 已结束；该组织的情报调研树开关是关的。会话建好之后，每次读页前系统 SHALL 再查一次开关，关着就拒绝、不发请求。生产入口 SHALL NOT 接受调用方覆盖开关配置；仓库里除读网页模块本身与测试外，SHALL NOT 直接调用它的内部实现。

#### Scenario: 定时任务上下文被拒
- **WHEN** 调用方声明处在定时任务中，或给出的 Job 的发起方式不是上述四种（如 `cron` / `scheduled`）
- **THEN** 建立读页会话失败，假网络上没有任何请求（`npx tsx src/lib/web-reader/__tests__/web-reader.test.ts`）

#### Scenario: 不是调研 Job 或已结束
- **WHEN** 给出的 Job 是一键招标分析的 Job（没有调研标记）、属于另一个组织、标记版本是 2、或状态为 completed
- **THEN** 建立读页会话失败（`npx tsx src/lib/web-reader/__tests__/web-reader-context-db.isolated.test.ts`、`web-reader.test.ts`）

#### Scenario: 开关关着
- **WHEN** `TENDER_RESEARCH_TREE_ENABLED` 未设，或组织不在非空的 `TENDER_RESEARCH_TREE_ORG_ALLOWLIST` 里；或会话建好之后开关被关
- **THEN** 建立读页会话失败 / 下一次读页失败，没有任何请求（`web-reader.test.ts`、`npx tsx src/lib/web-reader/__tests__/web-reader-edges.test.ts`）

#### Scenario: 唯一入口
- **WHEN** 扫描 `src/` 与 `scripts/`
- **THEN** 读网页模块目录与测试之外没有文件直接引用它的内部实现或测试接缝（`npx tsx src/lib/web-reader/__tests__/web-reader-pure.test.ts`）

### Requirement: 情报调研树开关
系统 SHALL 只在 `TENDER_RESEARCH_TREE_ENABLED` 为 `1` / `true` / `on` / `yes`（不分大小写、去掉首尾空白）且组织在 `TENDER_RESEARCH_TREE_ORG_ALLOWLIST`（逗号分隔的组织 id）里时认为某组织的情报调研树开着；名单为空时对所有组织生效；没有组织 id 时一律为关。

#### Scenario: 开关真值表
- **WHEN** 开关取未设、`0`、`1`、` TRUE `，名单取空、含本组织、不含本组织，组织 id 取有、无
- **THEN** 只有「开关为真、组织 id 存在、名单为空或含本组织」为开（`web-reader-pure.test.ts`）

### Requirement: 表明身份、不登录、不带凭证
每个读页请求（含 robots 请求与跳转后的请求）系统 SHALL 只用 GET，用户代理 SHALL 写明青砚与联系网址、SHALL NOT 冒充浏览器。系统 SHALL NOT 发送 cookie、Authorization、Proxy-Authorization 或任何凭证头，SHALL NOT 走环境变量里配置的代理，SHALL NOT 保存对方返回的 cookie，SHALL NOT 提交表单。网址带用户名或密码时系统 SHALL 不读、不发请求。

#### Scenario: 请求头
- **WHEN** 读一个返回 `Set-Cookie` 的页面后再读同站另一页
- **THEN** 两次请求都是 GET，用户代理含 `QingyanResearchBot` 与 `https://qingyan.ca`、不含 `Chrome` / `Safari` / `Firefox` / `Mozilla`，都没有 `Cookie` 与 `Authorization` 头，连接不复用（`web-reader.test.ts`、`npx tsx src/lib/web-reader/__tests__/web-reader-transport.test.ts`）

#### Scenario: 网址带凭证
- **WHEN** 读 `https://user:pass@example.gov/page`
- **THEN** 返回「不读」，没有任何请求（`web-reader.test.ts`）

### Requirement: 只读公开地址
系统 SHALL 只读 http / https、默认端口（80 / 443）、主机名是域名（不是 IP 地址、没有空标签）的网址，网址 SHALL 先过既有的公开网址校验。网址的主机名解析出的任一地址属于内网、回环、链路本地、运营商级 NAT、组播、未指定、文档或其它保留地址（含 IPv6 对应段、映射与翻译到 IPv4 的地址、NAT64）时，系统 SHALL 不读、不发请求；实际建立连接时 SHALL 再校验一次连接的地址；域名解析超过 5 秒按解析失败处理。系统 SHALL 最多跟 3 次跳转，每一跳 SHALL 重新做上述全部校验与站点名单、登录地址、这一支被挡站点的检查；第 4 次跳转 SHALL 停止并返回「打不开」。跳转目标没通过校验时 SHALL 不请求它。

#### Scenario: 内网地址与跳转到内网
- **WHEN** 读一个解析到 `10.0.0.5`、`127.0.0.1`、`169.254.169.254`、`::1`、`fd00::1`、`::ffff:192.168.1.1` 的网址；或一个公开页面 302 跳转到解析为 `192.168.0.10` 的网址；或连接时才发现地址是内网（DNS 重绑定）
- **THEN** 都返回「不读」，内网地址上没有任何请求（`web-reader.test.ts`、`web-reader-transport.test.ts`）

#### Scenario: 每跳重新校验
- **WHEN** 公开页面跳到「不碰」站、非默认端口、带凭证的网址、`data:` 网址，或跳到一个不看 robots 而解析到内网的站
- **THEN** 依次返回「不读」或「打不开」，跳转目标都没有被请求（`web-reader-edges.test.ts`）

#### Scenario: 跳转次数
- **WHEN** 一个网址连续跳转 4 次
- **THEN** 发出 4 个请求后停止，返回「打不开」，原因是跳转过多（`web-reader.test.ts`）

### Requirement: 被挡即停
遇到下列任一情况，系统 SHALL 返回「被挡」并写明原因与真正挡住我们的站点，SHALL NOT 重试、SHALL NOT 换地址再读：HTTP 401、403、407；跳转目标是登录地址或页面用 meta refresh 跳到登录地址（不请求该地址，挡住我们的是发出跳转的站）；返回的页面是登录页（有密码输入框且正文少于 2000 字）；返回的页面是人机验证；robots 声明不许读或读取失败；对方限流且不能按规定等待（见「临时故障有限重试」）；该站点在这一支里已经被挡过。被挡之后，同一支里 SHALL NOT 再向该站点及其子域名发出任何请求（每次发请求前都再查一次；同一读页会话里别的支已经读到的结果照常从缓存取，不发请求）。调用方直接给出的网址本身是登录地址时，系统 SHALL 返回「不读」、不发请求，且 SHALL NOT 把该站点记为这一支里被挡过。

#### Scenario: 登录页、验证码、403
- **WHEN** 读页目标分别返回登录页、人机验证页、401、403、407、跳到登录地址
- **THEN** 每个都返回「被挡」并带对应原因与该站点，每个目标只发出一次请求（`web-reader.test.ts`）

#### Scenario: 跳转后被挡记在挡住我们的站
- **WHEN** a 站 302 跳到 b 站、b 站返回 403，之后同一支先后读 b 站与 a 站的别的网址
- **THEN** 被挡的站点是 b；读 b 不发请求；读 a 照常读到（`web-reader-edges.test.ts`）

#### Scenario: 不靠换地址绕过
- **WHEN** gov.example 返回 403 后，同一支读 m.gov.example 的网址与一个 IP 地址的网址
- **THEN** 前者「被挡」（站点 gov.example）、后者「不读」，都没有请求（`web-reader-edges.test.ts`）

#### Scenario: 直接给的登录地址
- **WHEN** 读 `https://site.example/account/login`，再读该站另一个网址
- **THEN** 前者返回「不读」（登录地址）、没有请求；后者照常读到（`web-reader.test.ts`）

#### Scenario: 同一支里同站被挡过
- **WHEN** 某站点在这一支里被挡过一次（首次请求即被挡、或从缓存取到被挡结果、或并发的另一个读取刚被挡），再读同站另一个网址
- **THEN** 直接返回「被挡」（原因：这一支里该站点已被挡），不发请求、不扣额度（`web-reader.test.ts`、`web-reader-edges.test.ts`）

### Requirement: 不经代理换地址
被挡之后系统 SHALL NOT 经第三方抓取代理、网页快照或翻译代理换地址读同一个站：这类服务（如 r.jina.ai、translate.goog、webcache.googleusercontent.com、web.archive.org、archive.ph、12ft.io）SHALL 预置在「不碰」里；网址的路径或查询里（百分号编码最多解两层）嵌着这一支被挡过的站或其子域名时，SHALL 按「这一支里该站点已被挡」处理、不发请求；嵌着「不碰」站时 SHALL 返回「不读」。每一跳都这样查。

#### Scenario: 经代理换地址
- **WHEN** gov.example 返回 403 后，同一支读 `https://r.jina.ai/https://gov.example/a` 等预置代理网址、`https://fetcher.example/get?u=https%3A%2F%2Fgov.example%2Fa`、一个跳转到这种网址的页面；以及嵌着 LinkedIn 的代理网址
- **THEN** 预置代理与嵌着 LinkedIn 的返回「不读」，嵌着 gov.example 的返回「被挡」（站点 gov.example），代理与 gov.example 上都没有请求；别的支读不在名单里的代理网址照读（`web-reader-edges.test.ts`、`web-reader-pure.test.ts`）

### Requirement: 其它状态码
HTTP 404、410 等其它 4xx（401、403、407、429 之外）与 1xx，系统 SHALL 返回「打不开」（原因：页面不存在或已下线）、不重试。3xx 系统 SHALL 只跟 301、302、303、307、308 且带 Location 的；其它 3xx（如 300、304）或没有 Location 的 SHALL 返回「打不开」（原因：跳转地址无效）、不请求别处。

#### Scenario: 其它状态码
- **WHEN** 读页目标返回 404、410、300、没有 Location 的 302
- **THEN** 都返回「打不开」，各只发出一次请求（`web-reader.test.ts`、`web-reader-edges.test.ts`）

### Requirement: 临时故障有限重试
超时、连接中断与 HTTP 5xx 系统 SHALL 视为临时故障，最多重试 2 次，两次重试前的等待 SHALL 递增（1 秒、3 秒）；仍失败 SHALL 返回「打不开」。HTTP 429 只在对方给出等待时间（纯数字秒数，或带 GMT 的 HTTP 日期）且不超过 30 秒时，系统 SHALL 等够后再试一次；没有给出、认不出、超过 30 秒或再试仍为 429 时 SHALL 返回「被挡」。重试、等待、站点排队与等候别的支同址结果都 SHALL NOT 超过调用方给的截止时间，到时返回「打不开」（原因：这一轮处理时间到了）；单次请求的超时被截止时间缩短后超时的，同样按「时间到了」处理。

#### Scenario: 超时与 5xx
- **WHEN** 读页目标三次都超时，或三次都返回 503 或 500
- **THEN** 共发出 3 个请求，第二次等待长于第一次，返回「打不开」（`web-reader.test.ts`、`web-reader-edges.test.ts`）

#### Scenario: 429 的等待时间
- **WHEN** 读页目标返回 429 带 `Retry-After: 10` 或 `30` 之后返回正常页面；另一个目标返回 429 不带等待时间；第三个返回 429 带 `Retry-After: 31` 或 `60`
- **THEN** 前者等满后再试一次并读到正文；后两者都只发一次请求并返回「被挡」（`web-reader.test.ts`、`web-reader-edges.test.ts`）

#### Scenario: 截止时间
- **WHEN** 429 要等 10 秒而截止只剩 8 秒；或截止时间不够发请求；或单次超时被截止缩短
- **THEN** 返回「打不开」（时间到了），时钟没越过截止时间，没发请求的不扣额度，这个结果不记进缓存（`web-reader-edges.test.ts`）

### Requirement: 读页额度
每次读页，系统 SHALL 在真正发出第一个页面请求前一刻从调用方给的这一支读页额度里扣 1 次（同一次读页的重试与跳转不另扣，robots 请求不扣，没有发出请求的不扣）；额度为 0 时 SHALL 返回「到上限」、不发任何请求（含 robots）。每支读页额度 SHALL 不超过 12 次（调用方给的剩余与已用合计超过 12、或不是非负整数时拒绝建立该支的上下文），额度 SHALL 由读页层自己记账（调用方的额度对象只读一次；建好上下文后改它不起作用，调用方只能读到快照）；所有站点用同一个读页额度标准；同一读页会话里同一支 SHALL 只能建一次上下文。

#### Scenario: 额度用完
- **WHEN** 这一支读页额度为 2，依次读 3 个不同网址；另一支额度为 1，并发读两个不同网址；额度为 0 的一支读一个新站点
- **THEN** 前者第三个返回「到上限」且没有请求；并发的两个一个读到一个到上限、只扣 1 次；额度为 0 的没有任何请求（`web-reader.test.ts`、`web-reader-edges.test.ts`）

#### Scenario: 额度封顶
- **WHEN** 调用方给一支 13 次额度、或剩余 10 已用 3、或负数 / 小数，或在同一会话里给同一支建第二个上下文；或建好上下文后把传进去的额度对象改成 30
- **THEN** 前几种都被拒绝；最后一种仍只按原额度读（`web-reader-edges.test.ts`）

### Requirement: 额度跨会话与分支上限
每支的已用读页数、取 robots 次数与被挡站 SHALL 按 Job 记一份账：同一进程里同一 Job 的多个会话（含并发的）共用，建会话时再与这棵树的读页审计取大，所以重建会话不清零、并发会话不翻倍。每棵树 SHALL 最多 24 支；每支取 robots SHALL 不超过 12 次，超了返回「到上限」（原因：取读取规则的次数到上限）；每支被挡站到 24 个 SHALL 不再读页。审计历史超过 2000 行 SHALL 视为不可信，这棵树不再读页。跨进程同时处理同一 Job 不在本层防范（由调研 Job 的运行时保证同一时间只有一处处理）。

#### Scenario: 重建会话不清零
- **WHEN** 审计里某一支已发过请求的读页有 12 次、另一支有 2 次且有一个被挡站、第三支取过 12 次 robots、第四支从缓存拿到过被挡结果，同一 Job 在新进程里重建会话；审计里已有 24 支时再建第 25 支
- **THEN** 第一支额度为 0；第二支已用 2、被挡站照样被挡；第三支到上限、不发请求；第四支的被挡站照样被挡；第 25 支被拒（`web-reader-edges.test.ts`、`web-reader-context-db.isolated.test.ts`）

#### Scenario: 并发会话不翻倍
- **WHEN** 同一 Job 同时开两个会话，各给同一支 12 次额度并发读 24 个网址；两个会话合计开第 25 支；一个会话里该支被某站挡了，另一个会话的同一支读该站
- **THEN** 合计只发 12 个页面请求；第 25 支被拒；后者不发请求（`web-reader-edges.test.ts`）

#### Scenario: 历史超限
- **WHEN** 审计里这棵树有 2001 行；或别支 1500 行之后某一支又有 12 次读页
- **THEN** 前者这棵树任何一支都读不了、不发请求；后者那一支额度为 0（`web-reader-edges.test.ts`、`web-reader-context-db.isolated.test.ts`）

### Requirement: 同站间隔
同一进程内对同一站点（主机名去掉 `www.`）的任意两次请求（含 robots 请求、重试与跳转），开始时间之间 SHALL 至少间隔 2 秒，并行的多支、多个会话都一样。

#### Scenario: 同站间隔
- **WHEN** 两支并行或两个会话各读同一站点的一个网址
- **THEN** 该站点上任意两次请求的开始时间相差不少于 2 秒（`web-reader.test.ts`、`web-reader-edges.test.ts`）

### Requirement: 同一读页会话内同一网址只读一次
调用方 SHALL NOT 能改会话与上下文里影响判断的任何状态（站点名单、被挡站、截止时间、审计归属都在读页层内部；对外给的是冻结的只读外观与快照）。同一读页会话（一棵树的一次处理）内，系统 SHALL 把每个网址（去掉片段、主机名小写并去掉末尾的点、去掉默认端口后）第一次读取的结果记下；第二次读同一网址 SHALL 直接返回第一次的结果，SHALL NOT 发请求、SHALL NOT 扣额度；两支并发读同一网址 SHALL 只发一次请求。「到上限」「这一支里该站点已被挡」「时间到了」「网址检查不过」这几种与调用方状态有关的结果 SHALL NOT 记下，也 SHALL NOT 给别的支共用（别的支按自己的状态再读）。跨处理的去重由调用方传入持久缓存实现；从调用方的缓存取到的对象 SHALL 先校验形状（不合格当没命中），并一律重新标成不可信；写调用方缓存失败 SHALL NOT 影响结果与审计。返回的结果对象 SHALL 不可修改。

#### Scenario: 同址去重
- **WHEN** 两支先后读 `https://Example.gov:443/a#x` 与 `https://example.gov/a`；或两支并发读同一网址
- **THEN** 只发出一次页面请求，第二次返回相同的正文与读取时间，第二支的额度不变（`web-reader.test.ts`）

#### Scenario: 与调用方状态有关的结果不共用
- **WHEN** 一支在同址等候中、另一支得到「这一支被挡」或「时间到了」（审计写入走宏任务）
- **THEN** 两支都在 3 秒内返回，等候的那支按自己的状态读完（`web-reader-edges.test.ts`）

#### Scenario: 改不动内部状态
- **WHEN** 调用方清空会话上的「不碰」名单、整个替换站点名单、改 jobId、清空拿到的被挡站快照、把截止时间改成空、传 NaN 截止时间、用 getter 让额度前后不同
- **THEN** 「不碰」照旧、被挡站照旧不发请求、审计归属不变、NaN 被拒、额度只按第一次读到的值（`web-reader-edges.test.ts`）

### Requirement: 站点名单
系统 SHALL 按站点名单处理每个站点（每一跳都查）：「不碰」里的站点 SHALL 直接不读、不发请求，预置至少包括 1688 详情页、MERX、第三方抓取代理 / 快照 / 翻译代理与青砚自己的站点（qingyan.ca、qingyan.ai、vercel.app 预览域名）；「按人发起处理」里的站点 SHALL NOT 读取 robots 声明，读页额度与其它站点相同，预置 ImportYeti；其余站点（含「可以读」）按 robots 声明读。组织设置 SHALL 只能把站点加进「不碰」或「可以读」，「不碰」永远优先，SHALL NOT 把预置「不碰」的站点放出来，SHALL NOT 新增「按人发起处理」的站点。

#### Scenario: 不碰的站
- **WHEN** 读 `https://detail.1688.com/offer/1.html` 或 `https://www.merx.com/x`，或组织设置把某站点（含 ImportYeti）加进「不碰」后读该站
- **THEN** 返回「不读」，没有任何请求（`web-reader.test.ts`、`web-reader-edges.test.ts`）

#### Scenario: 按人发起处理的站
- **WHEN** 读 `https://www.importyeti.com/company/x`
- **THEN** 不请求它的 robots 声明，直接读页面，并照常扣额度（`web-reader.test.ts`）

### Requirement: robots 声明
不在「按人发起处理」名单里的站点，系统 SHALL 先读它的 robots 声明并遵守：按「QingyanResearchBot」组，没有则「*」组（组名只取开头的字母、下划线与连字符，不分大小写，后面的版本号等忽略）；规则与路径按 UTF-8 百分号编码归一后比较（百分号编码的非保留字符先解码）；最长匹配优先、同长「允许」优先；路径含查询串，路径里有重复斜杠时合并前后两种写法都允许才读。robots 读不到（404 等 4xx，含 401 / 403）时视为全部允许；返回 429、5xx、超时、连接失败，或规则超过 5000 条、单条模式超过 512 字时 SHALL 视为读取失败、全部不许读；一次匹配的计算量超过上限 SHALL 按不许读处理。读取失败与读到的规则在同一读页会话内共用。

#### Scenario: robots
- **WHEN** 站点 robots 对「*」写了 `Disallow: /private`；读 `/private/a`、`//private/a` 与 `/public/b`；另一站点 robots 返回 503；`www.canada.ca` 的 robots 不许读 `/x`；robots 写 `User-agent: QingyanResearchBot 1.0` + `Disallow: /`
- **THEN** `/private/a` 与 `//private/a` 不许读，`/public/b` 读到正文；robots 返回 503 的站点返回「被挡」；`www.canada.ca/x` 返回「被挡」；最后一种按本机器人的组不许读（`web-reader.test.ts`、`web-reader-edges.test.ts`、`web-reader-pure.test.ts`）

### Requirement: robots 的跳转
robots 的跳转 SHALL 只跟到别处的 `/robots.txt`（最多 5 次），跳到别的页面或登录地址视为没有 robots 且 SHALL NOT 请求它；跳到 IP 地址 SHALL NOT 请求、按读取失败处理；跳到「不碰」站 SHALL NOT 请求、按读取失败处理；跳到这一支被挡过的站 SHALL NOT 请求、按「这一支里该站点已被挡」处理，这个结论 SHALL NOT 给别的支共用。等别的支取 robots 的时间 SHALL 受本支截止时间约束。

#### Scenario: robots 的跳转
- **WHEN** robots 跳到登录地址、跳到别的页面、跳到 www 的 `/robots.txt`、跳到这一支被挡过的站
- **THEN** 前两种不请求跳转目标并视为没有 robots；第三种照跟照遵守；第四种不请求、记为这一支被挡，另一支照常取 robots 读到（`web-reader-edges.test.ts`）

#### Scenario: 等别的支取 robots
- **WHEN** 一支正在取一个 14 秒才回的 robots，另一支截止只剩 5 秒读同站
- **THEN** 后者到自己的截止就返回「时间到了」（`web-reader-edges.test.ts`）

### Requirement: 读到什么
系统 SHALL 只接收 HTML 与 XHTML，转成纯文本；PDF 见「PDF 不在本层解析」；纯文本与其它类型 SHALL 返回「不读」。单次请求（含读完正文）超过 15 秒 SHALL 视为超时。正文（解压后）超过 2 MB 时 SHALL 只取前 2 MB 并标「已截断」。返回的正文 SHALL 清掉 U+0000、落单代理字符、Unicode 标签字符、双向控制符与零宽字符。

#### Scenario: 超长正文与不支持的类型
- **WHEN** 读一个 3 MB 的 HTML 页面；读一个 `image/png` 与一个 `text/plain`；读一个 gzip 压缩后 300 KB、解压后 20 MB 的响应；读一个 3 KB、解压后 4 GiB 的 brotli 响应
- **THEN** 前者读到正文且标「已截断」；`image/png` 与 `text/plain` 返回「不读」；两个压缩炸弹都按上限截断，截断后不在后台继续解压（`web-reader.test.ts`、`web-reader-transport.test.ts`）

#### Scenario: 不可见字符
- **WHEN** 页面正文里有 Unicode 标签字符、双向控制符、零宽字符与 `&#xD800;`
- **THEN** 返回的正文里都没有（`web-reader-edges.test.ts`）

### Requirement: PDF 不在本层解析
网址路径以 `.pdf` 结尾的，系统 SHALL 不读、不发请求（连 robots 也不取）；返回的类型是 PDF、或正文开头是 `%PDF-`（不管标的什么类型）的，系统 SHALL NOT 解析、SHALL NOT 返回正文，返回「不读」（原因写明请用「我来补一页」上传）。进程内解析 PDF 限不住解析成本（构造的小文件就能占住几秒到几十秒、上 GB 内存），在能做到进程隔离之前本层 SHALL NOT 解析 PDF。

#### Scenario: PDF
- **WHEN** 读一个以 `.pdf` 结尾的网址；读一个返回 `application/pdf` 的网址；读一个标成 `text/html`、正文是 PDF 字节的网址
- **THEN** 前者不读、没有任何请求；后两者不读、正文为空（`web-reader.test.ts`、`web-reader-edges.test.ts`）

### Requirement: 返回结构
返回结果 SHALL 带 `untrusted: true`、请求的网址、最终网址（实际请求过的最后一个网址，一个请求都没发时为空）、读取时间、正文、是否截断、被挡原因与站点（没被挡为空）、结果类别（读到 / 被挡 / 打不开 / 不读 / 到上限）、原因与一句中文、HTTP 状态、页面请求数与 robots 请求数、是否来自缓存。

#### Scenario: 返回字段
- **WHEN** 读到一个页面、一个被挡的页面、一个跳到 `data:` 网址的页面
- **THEN** 都带 `untrusted: true` 与上述字段；被挡的带原因与站点；跳到 `data:` 的最终网址是最后一个实际请求过的网址（`web-reader.test.ts`、`web-reader-edges.test.ts`）

### Requirement: 结果与原因文案
系统 SHALL 为结果类别提供唯一一份中文名：读到、被挡、打不开、不读、到上限；SHALL 为每个原因提供唯一一句中文，被挡句以「未读取」结尾、不读句以「不读」结尾，原因句里 SHALL NOT 出现「robots」这样的技术词；读页额度用完的那句 SHALL 为「读页次数到上限，未读」，取读取规则次数到上限与被挡站到上限各有一句（整支一级的「到上限，未查完」由调研树写）。

#### Scenario: 文案
- **WHEN** 取各类别与各原因的中文
- **THEN** 与上面的规定一致（`web-reader-pure.test.ts`）

### Requirement: 调用方的网址检查
建立某一支的读页上下文时，调用方 SHALL 给一个网址检查（不给就拒绝建立）；对调用方给出的每个网址，检查只有返回 `true` 才算通过（返回 Promise 或别的值都不算），不过时系统 SHALL 返回「不读」（原因：网址不是从搜索结果或已读页面里来的）、不发请求、不扣额度。该检查 SHALL 只用于调用方给出的网址，SHALL NOT 用于对方返回的跳转目标。

#### Scenario: 网址检查
- **WHEN** 检查只放行 `ok.example`，读 `https://evil.example/?q=…` 与 `https://ok.example/p`；另一次建上下文时不给检查；检查是 async 函数、或返回 1 / 字符串 / undefined
- **THEN** 前者不读、没有请求、额度不变；后者照读；不给检查的建立失败；后几种都不读（`web-reader-edges.test.ts`）

### Requirement: 审计不记正文
每次发出过请求、或这一支发起过取 robots 的读页，以及这一支从缓存拿到被挡结果而新记下被挡站时，系统 SHALL 写一条审计，内容只有分支、网址、最终网址（各不超过 2048 字）、结果类别、HTTP 状态、正文字数、是否截断、原因、页面请求数、robots 请求数、取 robots 次数、站点、被挡站与是否来自缓存，记在发起人名下、指向调研 Job；这些审计同时是重建会话时恢复账的依据。仓库里读网页模块以外 SHALL NOT 写这个审计动作。审计、日志与错误信息 SHALL NOT 包含页面正文、请求头或响应头。

#### Scenario: 审计内容
- **WHEN** 读到一个正文含「SECRET-BODY-TEXT」的页面；读一个只请求了 robots（返回 503）就被挡的页面
- **THEN** 各写一条审计（后者 robots 请求数为 3），审计的键固定，审计与日志里搜不到「SECRET-BODY-TEXT」（`web-reader.test.ts`、`web-reader-edges.test.ts`、`web-reader-context-db.isolated.test.ts`）

### Requirement: 网页转文字的公共实现
HTML 转纯文本 SHALL 只有一份公共实现供读网页与邮件转发询盘解析共用：块级标签换行、表格单元格之间用制表符、去掉 script / style / head / title 的内容、还原常见字符实体（不还原成 U+0000）、线性时间。邮件转发询盘解析改用它之后，解析结果 SHALL 与改动前逐项相同。

#### Scenario: 邮件转发解析不变
- **WHEN** 跑邮件转发询盘解析的既有测试，并用改动前的实现算出的固定期望值比对
- **THEN** 全部相同（`npx tsx src/lib/trade/__tests__/email-forward-parse.test.ts`、`npx tsx src/lib/text/__tests__/html-to-text.test.ts`）
