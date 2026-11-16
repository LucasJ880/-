# platform/content-security-policy Specification

## Purpose
规定页面响应的内容安全策略基线与文件代理响应的沙箱：页面不许被别的网站嵌套，嵌入框架、浏览器脚本的网络请求、音视频、字体只到站内，禁用插件对象，表单与基准地址只到站内；策略适用哪些地址、各环境的差异、三种运行模式（强制 / 只提示 / 关闭）；文件代理返回的文件除 PDF 外放进沙箱。这一版不限制图片、脚本、样式的来源。

## Requirements

### Requirement: 页面响应带内容安全策略响应头

系统 SHALL 在全部页面与站内静态文件的响应上发 `Content-Security-Policy` 响应头，值为以下十条指令按此顺序用「; 」连接：`frame-ancestors 'self'`、`base-uri 'self'`、`form-action 'self'`、`object-src 'none'`、`frame-src 'self'`、`connect-src 'self'`、`media-src 'self' blob: data:`、`font-src 'self' data:`、`worker-src 'self' blob:`、`manifest-src 'self'`。同一组环境变量下两次生成的值 SHALL 相同。

#### Scenario: 生产环境的指令内容
- **WHEN** 运行 `npx tsx src/lib/security/__tests__/csp.test.ts`
- **THEN** 「十条指令，内容与顺序固定」与「同一组环境变量两次结果相同」两项通过

#### Scenario: 真实页面带这个响应头
- **WHEN** 本地起服务后以未登录、企业负责人、销售三种身份打开登录页、首页、设置、助手、客户详情、销售日程等页面
- **THEN** 每个页面的响应都带 `Content-Security-Policy`，且浏览器没有报告任何违反策略的事件（记录在 `docs/acceptance/site-csp-baseline/page-crawl.txt`）

### Requirement: 不许被别的网站嵌套

别的网站把青砚页面放进嵌入框架时，浏览器 SHALL NOT 显示页面内容。粗报价工具页（`/sunny-quote.html`）SHALL 同样不许被别的网站嵌套；站内页面嵌入它 SHALL 照常。

#### Scenario: 外部网站嵌入青砚页面
- **WHEN** 一个外部来源的页面用嵌入框架加载带本策略的青砚页面
- **THEN** 框架里不显示青砚页面的内容（测试项「别的网站把青砚页面嵌进框架：被 frame-ancestors 挡住」）

#### Scenario: 粗报价工具页
- **WHEN** 请求 `/sunny-quote.html`
- **THEN** 响应的策略只有 `frame-ancestors 'self'` 一条（该页面自带内联脚本并从 CDN 取识别库，不套用其余指令）

### Requirement: 页面不得把浏览器引向外部的嵌入内容、基准地址与表单

带本策略的页面里，以下行为 SHALL 被浏览器拒绝且不发出对应的外部请求：嵌入外部网站的框架；加载插件对象（`object` / `embed`）；把页面基准地址改到外部；把表单提交到外部地址。

#### Scenario: 四类行为被拒绝
- **WHEN** 测试在带本策略的页面里依次放入外部嵌入框架、插件对象、指向外部的 `base`、提交到外部的表单
- **THEN** 浏览器分别报告 `frame-src`、`object-src`、`base-uri`、`form-action` 违规，外部主机没有收到请求，页面地址与基准地址不变

### Requirement: 浏览器脚本的网络请求只到站内

带本策略的页面里，脚本向站外主机发起的网络请求（`fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`、`sendBeacon`）SHALL 被浏览器拒绝。配置了浏览器端 Sentry（`NEXT_PUBLIC_SENTRY_DSN` 是 https 地址）时，系统 SHALL 只额外放行它的上报主机。

#### Scenario: 向外部主机发请求
- **WHEN** 页面脚本 `fetch` 一个外部地址
- **THEN** 请求被拒绝，浏览器报告 `connect-src` 违规

#### Scenario: 站内接口
- **WHEN** 页面脚本请求站内接口
- **THEN** 请求照常完成，没有违规

#### Scenario: 配置了浏览器端 Sentry
- **WHEN** `NEXT_PUBLIC_SENTRY_DSN` 为 `https://<公钥>@o1234.ingest.us.sentry.io/5678`
- **THEN** `connect-src` 为 `'self' https://o1234.ingest.us.sentry.io`

### Requirement: 外部音视频、字体不加载

带本策略的页面 SHALL NOT 加载站外的音频、视频与字体。站内地址、`blob:` 与 `data:` 的音视频、站内与 `data:` 的字体 SHALL 照常。

#### Scenario: 外部媒体与字体
- **WHEN** 页面里出现外部地址的 `audio` / `video` 与 `@font-face`
- **THEN** 浏览器报告 `media-src`、`font-src` 违规，外部主机没有收到请求

#### Scenario: 语音播放
- **WHEN** 页面用 `blob:` 地址播放音频
- **THEN** 没有 `media-src` 违规

### Requirement: 现有的站内嵌入与预览不受影响

站内地址的嵌入框架（粗报价工具、报价 PDF）与用 `srcDoc` 写入的预览（邮件效果、样例邮件、质保邮件与证书）SHALL 照常显示；`srcDoc` 预览里企业自己配置的图片 SHALL 照常加载。

#### Scenario: 站内嵌入框架
- **WHEN** 页面嵌入一个站内地址
- **THEN** 子页面照常显示，没有违规

#### Scenario: srcDoc 预览
- **WHEN** 页面放入带 `sandbox=""` 的 `srcDoc` 预览，里面有一张外部地址的图片
- **THEN** 预览文字照常显示，浏览器控制台没有「被内容安全策略拒绝」的记录

### Requirement: 这一版不限制图片、脚本、样式的来源

页面策略 SHALL NOT 含 `default-src`、`img-src`、`script-src`、`style-src`。页面上的外部图片在这一版 SHALL 照常加载（不得据此认为图片外泄已由本策略兜底）。

#### Scenario: 没有这四条指令
- **WHEN** 运行测试
- **THEN** 「没有 default-src / img-src / script-src / style-src」通过

#### Scenario: 外部图片
- **WHEN** 带本策略的页面里出现一张外部地址的图片
- **THEN** 图片请求照常发出，没有违规（测试项「页面上的外部图片：这一版不拦」）

### Requirement: 策略内容不含通配符、不安全关键字与敏感信息

页面策略 SHALL NOT 含 `*` 通配符与任何 `unsafe-` 关键字；放行 Sentry 上报主机时 SHALL NOT 带上 DSN 里的公钥与项目号。DSN 不是 https 地址或解析失败时，系统 SHALL NOT 放行任何额外主机。

#### Scenario: 没有通配符与 unsafe
- **WHEN** 运行测试
- **THEN** 「策略里没有 unsafe-* 与通配符」通过

#### Scenario: DSN 只取主机
- **WHEN** DSN 带公钥与项目号
- **THEN** 策略里只出现 `https://<主机>`

#### Scenario: DSN 不可用
- **WHEN** DSN 是 http 地址、不是地址、或没有配置
- **THEN** `connect-src` 只有 `'self'`

### Requirement: 预览与开发环境的额外放行不进生产

预览环境（`VERCEL_ENV=preview`）SHALL 额外放行 Vercel 工具条用到的主机（`connect-src` 加 `https://vercel.live wss://ws-us3.pusher.com`，`frame-src` 加 `https://vercel.live`，`font-src` 加 `https://vercel.live https://assets.vercel.com`）；开发环境（`NODE_ENV=development`）SHALL 额外放行本机的 WebSocket（`ws://localhost:* ws://127.0.0.1:*`）。生产环境的策略 SHALL NOT 含这些主机。

#### Scenario: 三种环境
- **WHEN** 运行测试
- **THEN** 「预览环境：额外放行 Vercel 工具条用到的主机」「生产环境：不放行 Vercel 工具条的主机」「开发环境：放行本机热更新的 WebSocket；生产没有」三项通过

### Requirement: 页面策略的适用范围

接口（`/api/*`）、框架静态资源（`/_next/*`）与 Sentry 隧道（`/monitoring`）的响应 SHALL NOT 带页面策略。

#### Scenario: 范围
- **WHEN** 运行测试
- **THEN** 「页面与静态文件：在范围内」与「接口、框架静态资源、Sentry 隧道、粗报价工具页：不在这条规则的范围内」通过

### Requirement: 运行模式开关

环境变量 `CSP_MODE` SHALL 决定运行模式，大小写与首尾空格不敏感：没有配置、为空或写成无法识别的值时为强制执行（发 `Content-Security-Policy`）；`report-only` 时页面改发 `Content-Security-Policy-Report-Only`，内容相同，浏览器不拦截、只在控制台提示；`off` 时不发任何内容安全策略响应头。

#### Scenario: 三种模式的响应头
- **WHEN** 运行测试
- **THEN** 「CSP_MODE 没配或写错：按强制执行」「只上报模式：换成 Report-Only 响应头，内容相同」「关闭模式：不发任何响应头」通过

#### Scenario: 真实服务上切换
- **WHEN** 本地服务分别以不配、`report-only`、`off` 启动后请求登录页
- **THEN** 响应头依次为 `Content-Security-Policy`、`Content-Security-Policy-Report-Only`、两者都没有（记录在 `docs/acceptance/site-csp-baseline/file-proxy.txt`）

### Requirement: 文件代理的响应放进沙箱

文件代理（`/api/files/*`）成功返回文件时，除内容类型为 `application/pdf` 的响应外，SHALL 带 `Content-Security-Policy: sandbox`：文件被浏览器当成文档直接打开时，其中的脚本 SHALL NOT 执行。内容类型为 `application/pdf` 的响应 SHALL NOT 带这个响应头。`CSP_MODE=report-only` 时该响应头 SHALL 照常发出；`CSP_MODE=off` 时 SHALL NOT 发出。页面用 `<img>` 引用文件、以附件方式下载文件 SHALL 不受影响。

#### Scenario: 直接打开上传的网页
- **WHEN** 一名成员经上传接口传入内容类型为 `text/html`、带脚本的文件，另一名同企业成员直接打开它的文件代理地址
- **THEN** 响应带 `Content-Security-Policy: sandbox`，文档内容显示，脚本没有执行（`docs/acceptance/site-csp-baseline/file-proxy.txt`；`CSP_MODE=off` 的对照里脚本执行了）

#### Scenario: 带脚本的 SVG
- **WHEN** 浏览器直接打开带沙箱响应头、内含脚本的 SVG
- **THEN** 脚本没有执行（测试项「带脚本的 SVG：不带沙箱会执行，带沙箱不执行」）

#### Scenario: PDF
- **WHEN** 文件的内容类型是 `application/pdf`（大小写、带参数均算）
- **THEN** 响应不带内容安全策略响应头

#### Scenario: 图片引用与下载
- **WHEN** 页面用 `<img>` 引用带沙箱响应头的图片，或点击带沙箱响应头的附件下载链接
- **THEN** 图片照常显示，文件照常下载

#### Scenario: 两种非默认模式
- **WHEN** `CSP_MODE` 为 `report-only` 或 `off`
- **THEN** 网页类型的文件响应分别为带 `sandbox`、不带任何内容安全策略响应头
