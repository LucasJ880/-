## Context

盘点结果（2026-11-16）：

- 仓库里没有任何安全响应头：`next.config.ts` 没有 `headers()`，`src/proxy.ts` 不设响应头，`vercel.json` 里也没有。
- 页面不引外部脚本；唯一的例外是静态页 `public/sunny-quote.html`（粗报价工具），它有一整段内联脚本，并按需从 `cdn.jsdelivr.net` 取文字识别库。
- 浏览器端的请求都发往站内接口。没有客户端直传对象存储、没有 `WebSocket` / `EventSource` / `sendBeacon`。Sentry 浏览器端的地址来自 `NEXT_PUBLIC_SENTRY_DSN`，构建时若配了 `SENTRY_DSN` 还会走 `/monitoring` 隧道。
- 嵌入框架 6 处：2 处用站内地址（粗报价工具、报价 PDF），4 处用 `srcDoc`（邮件效果、样例邮件、质保邮件与证书），都带 `sandbox=""`。
- 页面里没有 `<audio>` / `<video>` 元素；语音播放用 `blob:` 地址。Service worker（`/sw.js`）只处理同源请求，跨源请求不拦。
- 没有用 `next/image`。**图片来源列不出允许清单**：企业 Logo、用户头像、面料目录的预览图与纹理图（含外部供应商网站的 http 地址）、效果图导出地址、社媒账号头像、邮件预览里企业配置的图片、历史遗留的对象存储公开地址、粗报价工具页的缩略图——这些字段存的是任意地址。
- 文件代理 `/api/files/[...path]` 按路径前缀鉴权后，把对象存储里存下的内容类型原样返回、内联显示，只带 `X-Content-Type-Options: nosniff`。

## Goals / Non-Goals

**Goals:**

- 全部页面有一条强制执行的内容安全策略，覆盖确定不会误伤现有页面的指令。
- 出问题时不改代码就能退回（只提示不拦截，或完全关闭）。
- 文件代理不再把上传的网页 / SVG 当成青砚自己的页面执行。
- 如实写明这一版没有管什么。

**Non-Goals:**

- 不限制图片、脚本、样式来源（见 D1）。
- 不加接收违规上报的接口。
- 不加其他安全响应头（`Strict-Transport-Security`、`Referrer-Policy`、`Permissions-Policy`、`X-Frame-Options`）。
- 不改 `src/proxy.ts`、`public/sw.js`、`public/sunny-quote.html`、任何页面组件。
- 不改 `src/app/api/product-content/upload/route.ts` 等上传接口，不改另外三个流式返回文件的接口（见「发现」）。
- 不新增依赖，不动 `prisma/`、`vercel.json`。

## Decisions

### D1 只上「基线」十条指令，不写 `default-src` / `img-src` / `script-src` / `style-src`

十条：`frame-ancestors`、`base-uri`、`form-action`、`object-src`、`frame-src`、`connect-src`、`media-src`、`font-src`、`worker-src`、`manifest-src`。不写 `default-src`，所以没列出的资源类型（图片、脚本、样式）不受限制。

- 否决：加 `img-src 'self' data: blob:`。Context 里那八类图片字段存的是任意地址，一上就坏。要限制图片得先把这些字段改成只存站内文件代理地址（或逐个列主机），是数据与产品层面的事。
- 否决：加 `script-src 'self' 'unsafe-inline'`。框架靠内联脚本注水，不带 nonce 只能写 `'unsafe-inline'`，等于没限制，还会让人误以为脚本已经受控。
- 否决：现在就上 nonce。要在 `src/proxy.ts` 给每个请求生成 nonce 并让所有页面改成动态渲染，影响面是全站的渲染方式，不属于「基线」。

代价：这一版挡不住「页面里混进一张外部图片」这条外泄途径。模型输出的两类渲染（Markdown、邮件 HTML 预览）已经在渲染时挡掉（#486、#499），其余位置靠的是数据来源，不是本策略。spec 里单独有一条 Requirement 写明这一点，测试里也有一项如实断言「外部图片照常加载」。

### D2 用 `next.config.ts` 的 `headers()`，策略由纯函数生成

`src/lib/security/csp.ts` 只读传入的环境变量；`next.config.ts` 的 `headers()` 直接返回它的结果。

- 否决：在 `src/proxy.ts` 里设响应头。那是登录与路由闸门，改它的回归面大；静态策略也用不着按请求计算。
- 否决：写进 `vercel.json`。本地开发与测试就看不到这个头了，而且 `vercel.json` 按约定不动。

### D3 默认强制执行，配 `CSP_MODE` 开关

不配 = 强制执行；`report-only` = 改发 `Content-Security-Policy-Report-Only`；`off` = 不发。写错的值按强制执行。

- 否决：先上线「只提示」观察一段时间。没有接收上报的接口，提示只出现在各人浏览器的控制台里，没人会看；加上报接口又是一条新的写入路径。改用上线前实测代替：本地起服务以三种身份逐页打开，违规数为 0。
- 否决：写错的值按关闭处理。打错一个字母就把防护关掉，方向不对。

响应头在构建时定下，改 `CSP_MODE` 要重新部署才生效。

### D4 页面策略不加在 `/api/*`、`/_next/*`、`/monitoring` 上

接口返回的是数据；其中返回文件的接口若带上 `frame-src` / `object-src` 之类的页面策略，Chrome 自带的 PDF 阅读器会受影响（它在内部用嵌入对象显示 PDF）。文件响应用 D6 那条单独的规则。

### D5 粗报价工具页只加 `frame-ancestors 'self'`

它是一张自带内联脚本、从 CDN 取识别库的静态页，被站内页面用嵌入框架引用。套十条指令里的 `connect-src 'self'` 会挡住识别库下载语言数据。只加「不许被别的网站嵌套」。

- 否决：给它单独列一份放行 CDN 的策略。要逐个确认识别库运行时访问的主机，超出这次范围；记在「发现」里。

### D6 文件代理的响应加 `Content-Security-Policy: sandbox`（PDF 除外）

文件被 `<img>` 引用或以附件下载时，响应上的策略不起作用；只有浏览器把它当成文档直接打开时才生效——这时沙箱让其中的脚本不执行，文档也不算青砚这个站点。PDF 不加：Chrome 的 PDF 阅读器在沙箱里打不开，PDF 也不会以站点身份执行脚本。内容类型按「分号前的部分、去空格、小写」比对，必须恰好是 `application/pdf`。

沙箱没有「只提示」的形式，所以 `report-only` 时照常发；`off` 时不发。

- 否决：只对 `text/html`、`image/svg+xml` 加。要维护一份「哪些类型会被当成文档执行」的清单，漏一个就是洞；反过来「除了 PDF 都加」对图片、表格、压缩包没有副作用（实测：图片引用、附件下载照常）。
- 否决：改成一律以附件下载。图片在新标签页里打开、生成文档回落成网页时在线阅读，这些现有用法会变。
- 否决：这次同时收紧上传接口的类型。那是另一层防护，要逐个接口定允许清单，记在「发现」里另行处理；沙箱对已经存进去的文件也生效，上传侧的收紧做不到这一点。

### D7 预览环境放行 Vercel 工具条的主机

`VERCEL_ENV=preview` 时放行 `vercel.live`（连接、框架、字体）、`wss://ws-us3.pusher.com`（连接）、`assets.vercel.com`（字体）。这份主机清单来自对 Vercel 文档的记忆，**没有在真实的预览部署上核对**；清单不全的后果是预览环境里工具条的部分功能不可用，页面本身不受影响。

- 否决：预览环境整体关闭策略。预览环境是合并前唯一能在真实部署上看到策略的地方。

### D8 测试分三段，外加两份实测记录

`src/lib/security/__tests__/csp.test.ts`：

1. 纯函数段：指令内容与顺序、三种模式、Sentry / 预览 / 开发的差异、适用范围、文件沙箱的类型判定。
2. 源码段：`next.config.ts` 与文件代理路由的接线，`csp.ts` 不读 `process.env`、不引框架。
3. 真实浏览器段：Playwright 的 Chromium 拦截全部请求，把生成的策略当响应头发出去，逐项验证该挡的挡住、该放的放过；文件沙箱带「不加沙箱时脚本确实会执行」的对照。找不到 Chromium 时打印 SKIP，前两段照常判定。

实测记录（`docs/acceptance/site-csp-baseline/`）：`page-crawl.txt`——本地起开发服务器，以未登录 / 企业负责人 / 销售三种身份打开 22 个页面，记录每页是否带响应头与违规事件；`page-crawl-production-build.txt`——同一批页面在本地生产构建下再跑一遍；`file-proxy.txt`——经真实上传接口传入带脚本的网页，另一名成员经真实文件代理打开，三种模式各跑一遍。

## 与八条硬纪律的关系

1. 零 schema：遵守，`prisma/` 无 diff。
2. 出站先审批：不涉及（不发任何东西；本策略只会减少浏览器向外的请求）。
3. 禁止第三套队列：不涉及。
4. 脱敏：策略里的 Sentry 主机只取源，不带 DSN 的公钥与项目号；验收记录里的账号是本地生成的假数据。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：纯规则，没有模型调用。
8. 测试注册：新测试在 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` 注册。

## 验证方式

- `npx tsx src/lib/security/__tests__/csp.test.ts`（本机真实浏览器段不得跳过）。
- `npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`openspec validate site-csp-baseline --strict`。
- `npm test` 的失败集合与 main 对照。
- `git diff --stat main -- prisma vercel.json src/proxy.ts public` 为空。

## Risks / Trade-offs

- [某个没巡检到的页面有被挡的用法] 巡检覆盖 22 个页面，全站页面远多于此 → 被挡的只可能是十条指令管的那几类（外部框架、外部请求、外部媒体与字体），盘点时全仓库搜过这些用法；真出现时 `CSP_MODE=report-only` 或 `off` 重新部署即可退回。
- [真实部署上没有实测] 本地用开发服务器与生产构建（`next build` + `next start`）各巡检过一遍，都没有违规；Vercel 的预览与生产部署从这个环境连不上，没有核对 → 合并后的预览部署是第一处真实核对点，未核对前按「未验证」列出。
- [公开报价页里嵌入的 PDF 没有在真实浏览器里看过] 无头 Chromium 不带 PDF 阅读器 → 嵌入框架里的 PDF 是从接口加载的独立文档，不继承父页面的策略，接口响应上也没有页面策略（D4）；按规范推断不受影响，列为未验证。
- [预览环境的 Vercel 工具条] 主机清单凭记忆（D7）→ 影响限于预览环境的工具条。
- [以后接入第三方服务] 新的浏览器端外部请求、外部嵌入框架会被挡 → 需要在 `src/lib/security/csp.ts` 里加主机；测试里指令内容是逐字断言的，改动会被看见。
- [文件沙箱让直接打开的网页文档不能执行脚本] 生成文档回落成网页时，模板里没有脚本与图片（已核对 `src/lib/projects/generate/`）→ 阅读与浏览器菜单打印不受影响。

## 发现（不在本 change 里改）

1. **图片来源没有兜底。** 见 D1。要补 `img-src`，得先处理 Context 里列的八类字段（盘点时逐类看过用法，没有逐字段核对库里现有的数据）。
2. **`src/app/api/product-content/upload/route.ts` 不限制文件类型。** 它把浏览器报上来的内容类型原样存下，没有扩展名或类型的允许清单（项目文件上传走的 `src/lib/files/upload-guard.ts` 是禁止 `html` / `svg` 的，这个接口没有走它）。本地实测：同企业成员可以传入 `text/html` 文件，另一名成员打开文件代理地址时脚本会以青砚站点的身份执行。D6 的沙箱让它不再执行；上传侧的类型限制仍然值得补，另行处理。
3. **另外三个流式返回文件的接口这次没有加沙箱，核对结论是不需要：** 报价分享 PDF（固定 `application/pdf`）；采购附件（一律以附件下载）；效果图公开分享的图片（上传时校验为图片类型——只看了上传处有类型校验，没有逐条核对校验函数）。
4. **粗报价工具页仍从 CDN 取脚本，没有来源限制。** 见 D5。
5. **没有接收违规上报的接口。** `report-only` 的提示只在浏览器控制台里。
6. **其他安全响应头都没有**（`Referrer-Policy`、`Permissions-Policy` 等）。`Strict-Transport-Security` 由托管平台在它的域名上处理，没有核对自定义域名的情况。
