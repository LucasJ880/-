## Why

全站没有任何内容安全策略：别的网站可以把青砚页面嵌进框架，页面里一旦混进不该有的内容，浏览器也不会拦它向外发请求；`ai-markdown-image-allowlist`（#486）与 `ai-html-preview-no-autoload`（#499）两次都把「没有内容安全策略」记成未关的一项。Lucas 2026-11-16：「全站内容安全策略也加上」。

TASKFLOW：无（基础设施）。

## What Changes

- 给全部页面响应加 `Content-Security-Policy` 响应头，十条指令：不许被别的网站嵌套；基准地址与表单提交只到站内；禁用插件对象；嵌入框架、浏览器脚本的网络请求、音视频、字体、worker、manifest 只到站内（配置了浏览器端 Sentry 时另放行它的上报主机）。
- 粗报价工具页（`/sunny-quote.html`）只加「不许被别的网站嵌套」一条；接口（`/api/*`）、框架静态资源（`/_next/*`）、Sentry 隧道（`/monitoring`）不带页面策略。
- 预览环境额外放行 Vercel 工具条用到的主机，开发环境额外放行本机热更新的 WebSocket；生产环境两者都不放行。
- 新增运行开关 `CSP_MODE`：不配 = 强制执行；`report-only` = 不拦截、只在浏览器控制台提示；`off` = 不发。写进 `.env.example`。
- 文件代理（`/api/files/*`）的响应，除 PDF 外加 `Content-Security-Policy: sandbox`：上传或生成的文件被直接打开时，里面的脚本不执行，文档不算青砚这个站点。`<img>` 引用与附件下载不受影响。
- **这一版不限制图片、脚本、样式的来源**（响应头里没有 `default-src`、`img-src`、`script-src`、`style-src`），原因与补齐前要先做的事写在 design。
- 零 schema、零出站、零模型调用、不新增依赖。

## Capabilities

### New Capabilities

- `platform/content-security-policy`：页面响应的内容安全策略基线（指令内容、适用范围、三种运行模式、各环境差异）与文件代理响应的沙箱。

### Modified Capabilities

（无）

## Impact

- 新增：`src/lib/security/csp.ts`（纯函数）、`src/lib/security/__tests__/csp.test.ts`（纯函数断言 + 源码断言 + 真实浏览器段，找不到 Chromium 时该段跳过）、`docs/acceptance/site-csp-baseline/`（本地真实页面巡检与文件代理实测的输出）。
- 修改：`next.config.ts`（加 `headers()`）、`src/app/api/files/[...path]/route.ts`（加一个响应头）、`.env.example`。
- 注册：`scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 文档：`docs/QINGYAN_MAIL-1_REPORT.md` §9、`docs/QINGYAN_MAIL-2_REPORT.md` §11 各补一句。
- 不改：任何页面组件、`src/proxy.ts`、`public/sw.js`、`public/sunny-quote.html`、上传接口、其余文件下载接口、`prisma/`、`vercel.json`。

## Out of scope

- 图片来源的限制（`img-src`）：页面上的外部图片仍会加载。助手回复与邮件 HTML 预览里的外部图片已由 #486、#499 在渲染时挡掉；其余位置这次不管。
- 脚本与样式来源的限制（`script-src`、`style-src`）：需要给每个请求发 nonce，另起 change。
- 接收违规上报的接口（`report-uri` / `report-to`）。
- 其他安全响应头（`Strict-Transport-Security`、`Referrer-Policy`、`Permissions-Policy`、`X-Frame-Options`）。
- 收紧 `product-content` 上传接口接受的文件类型（design「发现」第 2 点）。
- staging / 生产环境的实测。
