# tender/public-page-reader Specification

## Purpose
规定情报调研读公开网页的唯一入口：只在由人发起的调研 Job 里读，表明身份、不登录、不带凭证，被挡即停、临时故障有限重试，按额度与站点间隔限量，同一棵树内同一网址只读一次，读到的内容一律标为不可信资料，审计只记网址、状态与字数。

## ADDED Requirements

### Requirement: 只在人发起的调研 Job 里读
系统 SHALL 只在一条由人发起的情报调研 Job 的上下文里读网页：该 Job 属于调用方给出的组织，带调研标记、发起人与发起方式，发起方式只能是「开始调研」或「确认招标要求」。系统 SHALL 在以下任一情况下拒绝建立读页上下文、不发出任何网络请求：调用方声明自己处在定时任务中；没有给出 Job；Job 不存在或不属于该组织；Job 不带调研标记或缺发起人；发起方式不是上述两种；该组织的情报调研树开关是关的。

#### Scenario: 定时任务上下文被拒
- **WHEN** 调用方声明处在定时任务中，或给出的 Job 的发起方式不是「开始调研」「确认招标要求」
- **THEN** 建立读页上下文失败，假网络上没有任何请求（`npx tsx src/lib/web-reader/__tests__/web-reader.test.ts`）

#### Scenario: 不是调研 Job
- **WHEN** 给出的 Job 是一键招标分析的 Job（没有调研标记），或属于另一个组织
- **THEN** 建立读页上下文失败（`npx tsx src/lib/web-reader/__tests__/web-reader-context-db.isolated.test.ts`）

#### Scenario: 开关关着
- **WHEN** `TENDER_RESEARCH_TREE_ENABLED` 未设，或组织不在非空的 `TENDER_RESEARCH_TREE_ORG_ALLOWLIST` 里
- **THEN** 建立读页上下文失败，没有任何请求（`web-reader.test.ts`）

### Requirement: 情报调研树开关
系统 SHALL 只在 `TENDER_RESEARCH_TREE_ENABLED` 为 `1` / `true` / `on` / `yes`（不分大小写）且组织在 `TENDER_RESEARCH_TREE_ORG_ALLOWLIST`（逗号分隔的组织 id）里时认为某组织的情报调研树开着；名单为空时对所有组织生效；没有组织 id 时一律为关。

#### Scenario: 开关真值表
- **WHEN** 开关取未设、`0`、`1`、` TRUE `，名单取空、含本组织、不含本组织，组织 id 取有、无
- **THEN** 只有「开关为真、组织 id 存在、名单为空或含本组织」为开（`npx tsx src/lib/web-reader/__tests__/web-reader-pure.test.ts`）

### Requirement: 表明身份、不登录、不带凭证
每个读页请求（含 robots 请求与跳转后的请求）系统 SHALL 只用 GET，用户代理 SHALL 写明青砚与联系网址、SHALL NOT 冒充浏览器。系统 SHALL NOT 发送 cookie、Authorization 或任何凭证头，SHALL NOT 保存对方返回的 cookie，SHALL NOT 提交表单。网址带用户名或密码时系统 SHALL 拒绝读取、不发请求。

#### Scenario: 请求头
- **WHEN** 读一个返回 `Set-Cookie` 的页面后再读同站另一页
- **THEN** 两次请求都是 GET，用户代理含 `QingyanResearchBot` 与 `https://qingyan.ca`、不含 `Chrome` / `Safari` / `Firefox`，都没有 `Cookie` 与 `Authorization` 头（`web-reader.test.ts`）

#### Scenario: 网址带凭证
- **WHEN** 读 `https://user:pass@example.gov/page`
- **THEN** 返回「拒绝」，没有任何请求（`web-reader.test.ts`）

### Requirement: 只读公开地址
系统 SHALL 只读 http / https、默认端口（80 / 443）的网址，网址 SHALL 先过既有的公开网址校验。网址的主机名解析出的任一地址属于内网、回环、链路本地、运营商级 NAT、组播、未指定或其它保留地址（含 IPv6 对应段与映射到 IPv4 的地址）时，系统 SHALL 拒绝读取、不发请求；实际建立连接时 SHALL 再校验一次连接的地址。系统 SHALL 最多跟 3 次跳转，每一跳 SHALL 重新做上述全部校验与站点名单检查；第 4 次跳转 SHALL 停止并返回「未接通」。

#### Scenario: 内网地址与跳转到内网
- **WHEN** 读一个解析到 `10.0.0.5`、`127.0.0.1`、`169.254.169.254`、`::1`、`fd00::1`、`::ffff:192.168.1.1` 的网址；或一个公开页面 302 跳转到解析为 `192.168.0.10` 的网址
- **THEN** 都返回「拒绝」，内网地址上没有任何请求（`web-reader.test.ts`）

#### Scenario: 跳转次数
- **WHEN** 一个网址连续跳转 4 次
- **THEN** 发出 4 个请求后停止，返回「未接通」，原因是跳转过多（`web-reader.test.ts`）

### Requirement: 被挡即停
遇到下列任一情况，系统 SHALL 返回「被挡」并写明原因，SHALL NOT 重试、SHALL NOT 换地址再读：HTTP 401、403、407；跳转目标是登录地址（不请求该地址）；返回的页面是登录页（有密码输入框且正文很少）；返回的页面是人机验证；robots 声明不许读或读取失败；对方限流且不能按规定等待（见「临时故障有限重试」）；该站点在这一支里已经被挡过。被挡之后，同一支里 SHALL NOT 再向该站点发出任何请求（同一棵树里别的支已经读到的结果照常从缓存取，不发请求）。调用方直接给出的网址本身是登录地址时，系统 SHALL 返回「拒绝」、不发请求，且 SHALL NOT 把该站点记为这一支里被挡过。

#### Scenario: 登录页、验证码、403
- **WHEN** 读页目标分别返回登录页、人机验证页、403
- **THEN** 每个都返回「被挡」并带对应原因，每个目标只发出一次请求（`web-reader.test.ts`）

#### Scenario: 直接给的登录地址
- **WHEN** 读 `https://site.example/account/login`
- **THEN** 返回「拒绝」（登录地址），没有请求，这一支之后仍可读该站其它网址（`web-reader.test.ts`）

#### Scenario: 同一支里同站被挡过
- **WHEN** 某站点在这一支里被挡过一次，再读同站另一个网址
- **THEN** 直接返回「被挡」（原因：这一支里该站点已被挡），不发请求、不扣额度（`web-reader.test.ts`）

### Requirement: 临时故障有限重试
超时、连接中断与 HTTP 5xx 系统 SHALL 视为临时故障，最多重试 2 次，两次重试的等待时间 SHALL 递增；仍失败 SHALL 返回「未接通」。HTTP 429 只在对方给出等待时间且不超过 30 秒时，系统 SHALL 等够后再试一次；没有给出、超过 30 秒或再试仍为 429 时 SHALL 返回「被挡」。重试与等待 SHALL NOT 超过调用方给的截止时间。

#### Scenario: 超时与 5xx
- **WHEN** 读页目标三次都超时，或三次都返回 503
- **THEN** 共发出 3 个请求，第二次等待长于第一次，返回「未接通」（`web-reader.test.ts`）

#### Scenario: 429 的等待时间
- **WHEN** 读页目标返回 429 带 `Retry-After: 10`，之后返回正常页面；另一个目标返回 429 不带等待时间；第三个返回 429 带 `Retry-After: 60`
- **THEN** 第一个等满 10 秒后再试一次并读到正文；第二、三个都只发一次请求并返回「被挡」（`web-reader.test.ts`）

### Requirement: 限量与站点间隔
每次需要发出请求的读页，系统 SHALL 从调用方给的这一支读页额度里扣 1 次（同一次读页的重试与跳转不另扣，robots 请求不扣）；额度为 0 时 SHALL 返回「到上限」、不发请求。对同一站点的任意两次请求（含 robots 请求、重试与跳转），开始时间之间 SHALL 至少间隔 2 秒，并行的多支也一样。所有站点用同一个读页额度标准。

#### Scenario: 额度用完
- **WHEN** 这一支读页额度为 2，依次读 3 个不同网址
- **THEN** 前两个发出请求，第三个返回「到上限」且没有请求（`web-reader.test.ts`）

#### Scenario: 同站间隔
- **WHEN** 两支并行，各读同一站点的一个网址
- **THEN** 该站点上任意两次请求的开始时间相差不少于 2 秒（`web-reader.test.ts`）

### Requirement: 同一棵树内同一网址只读一次
同一棵树内，系统 SHALL 把每个网址（去掉片段、主机名小写、去掉默认端口后）第一次读取的结果记下；第二次读同一网址 SHALL 直接返回第一次的结果，SHALL NOT 发请求、SHALL NOT 扣额度。「到上限」与「这一支里该站点已被挡」这两种与调用方状态有关的结果 SHALL NOT 记下。

#### Scenario: 同址去重
- **WHEN** 两支先后读 `https://Example.gov:443/a#x` 与 `https://example.gov/a`
- **THEN** 只发出一次页面请求，第二次返回相同的正文与读取时间，第二支的额度不变（`web-reader.test.ts`）

### Requirement: 站点名单与 robots
系统 SHALL 按站点名单处理每个站点（每一跳都查）：「不碰」里的站点 SHALL 直接拒绝、不发请求，预置至少包括 1688 详情页与 MERX；「按人发起处理」里的站点 SHALL NOT 读取 robots 声明，读页额度与其它站点相同，预置 ImportYeti；其余站点 SHALL 先读该站点的 robots 声明并遵守（按「QingyanResearchBot」与「*」两组规则，最长匹配优先）。robots 读不到（404 等 4xx）时视为全部允许；robots 服务出错（5xx、超时、连接失败）时 SHALL 视为全部不许读。组织设置 SHALL 只能把站点加进「不碰」或「可以读」，SHALL NOT 把预置「不碰」的站点放出来，SHALL NOT 新增「按人发起处理」的站点。

#### Scenario: 不碰的站
- **WHEN** 读 `https://detail.1688.com/offer/1.html` 或 `https://www.merx.com/x`，或组织设置把某站点加进「不碰」后读该站
- **THEN** 返回「拒绝」，没有任何请求（`web-reader.test.ts`）

#### Scenario: robots
- **WHEN** 站点 robots 对「*」写了 `Disallow: /private`；读 `/private/a` 与 `/public/b`；另一站点 robots 返回 503
- **THEN** `/private/a` 返回「被挡」（robots）且没有页面请求，`/public/b` 读到正文；robots 返回 503 的站点返回「被挡」（`web-reader.test.ts`、`web-reader-pure.test.ts`）

#### Scenario: 按人发起处理的站
- **WHEN** 读 `https://www.importyeti.com/company/x`
- **THEN** 不请求它的 robots 声明，直接读页面，并照常扣额度（`web-reader.test.ts`）

### Requirement: 读到什么
系统 SHALL 只接收 HTML、XHTML、纯文本与 PDF：HTML 与 XHTML 转成纯文本，PDF 抽出文字并把 U+0000 换成空格，其它类型 SHALL 返回「拒绝」。单次请求（含读完正文）超过 15 秒 SHALL 视为超时。正文（解压后）超过 2 MB 时 SHALL 只取前 2 MB 并标「已截断」。返回结果 SHALL 带 `untrusted: true`、请求的网址、最终网址、读取时间、正文、是否截断、被挡原因（没被挡为空）、结果类别（读到 / 被挡 / 未接通 / 拒绝 / 到上限）。

#### Scenario: PDF 里的 U+0000
- **WHEN** 读一个 PDF，抽出的文字含 U+0000
- **THEN** 返回的正文不含 U+0000（`web-reader.test.ts`）

#### Scenario: 超长正文与不支持的类型
- **WHEN** 读一个 3 MB 的 HTML 页面；读一个 `image/png`
- **THEN** 前者读到正文且标「已截断」；后者返回「拒绝」（`web-reader.test.ts`）

### Requirement: 审计不记正文
每次实际发出请求的读页，系统 SHALL 写一条审计，内容只有网址、最终网址、结果类别、HTTP 状态、正文字数、是否截断、原因与尝试次数，记在发起人名下、指向调研 Job。审计、日志与错误信息 SHALL NOT 包含页面正文。

#### Scenario: 审计内容
- **WHEN** 读到一个正文含「SECRET-BODY-TEXT」的页面
- **THEN** 写一条审计，含网址、状态与字数，审计与日志里搜不到「SECRET-BODY-TEXT」（`web-reader.test.ts`、`web-reader-context-db.isolated.test.ts`）

### Requirement: 网页转文字的公共实现
HTML 转纯文本 SHALL 只有一份公共实现供读网页与邮件转发询盘解析共用：块级标签换行、表格单元格之间用制表符、去掉 script / style 的内容、还原常见字符实体、线性时间。邮件转发询盘解析改用它之后，解析结果 SHALL 与改动前逐项相同。

#### Scenario: 邮件转发解析不变
- **WHEN** 跑邮件转发询盘解析的既有测试
- **THEN** 全部通过（`npx tsx src/lib/trade/__tests__/email-forward-parse.test.ts`、`npx tsx src/lib/text/__tests__/html-to-text.test.ts`）
