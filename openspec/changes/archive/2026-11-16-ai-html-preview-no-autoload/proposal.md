## Why

`ai-markdown-image-allowlist`（#486）关掉了「模型输出按 Markdown 渲染时自动加载外部图片」这条外泄途径，当时记下一处同类问题没有关：模型起草的邮件 HTML 预览。两处预览（项目里问供应商的邮件、销售 AI 跟进邮件）都把模型写的 HTML 经 `src/lib/common/sanitize.ts` 净化后直接放进页面，而净化规则放行 `img` 与内联 `style`——一张外部图片、或一段 `background:url(...)`，浏览器一渲染就会去请求那个地址，地址里夹的数据不经用户点击就出去了。模型起草邮件时读的是客户资料、项目资料等外部可影响的内容，路径与 Markdown 那条相同。Lucas 2026-11-16：「邮件 HTML 预览那个同类问题也修掉」。

## What Changes

- `sanitizeHtml` 的图片规则与 Markdown 渲染统一：只放行站内文件代理（`/api/files/`）之下的地址，其余图片不生成图片元素，原位置显示一段不可点击的文字提示（复用 `src/lib/ai-markdown/url-policy.ts` 的判定与提示文字）。
- 内联样式里能让浏览器加载资源的声明一律去掉（`url()`、`image-set()` 等任何不在允许清单里的函数，以及带反斜杠转义、注释、`@` 的值）；颜色、间距、宽度、字体等普通声明保留，预览的排版不变。
- 没有浏览器环境时（服务端渲染）`sanitizeHtml` 不再原样返回传入的 HTML，改为返回空字符串。
- 直接把 HTML 放进页面的位置登记成清单，测试扫描全仓库，出现清单之外的新位置时失败。
- 只改预览怎么显示；发出去的邮件内容、服务端、数据结构都不变。零 schema、零出站、零模型调用。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `agents/ai-output-rendering`：在 Markdown 渲染规则之外，增加「模型起草的 HTML 预览」的规则——图片允许清单、内联样式不加载资源、无浏览器环境时不放行原文、直接渲染 HTML 的位置清单。

## Impact

- 修改：`src/lib/common/sanitize.ts`。
- 新增：`src/lib/common/inline-style-policy.ts`（纯函数）、`src/lib/common/__tests__/sanitize-html.test.ts`（纯函数断言 + 源码断言 + 真实浏览器段，找不到 Chromium 时该段跳过）。
- 注册：`scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 文档：`docs/QINGYAN_MAIL-1_REPORT.md` §9、`docs/QINGYAN_MAIL-2_REPORT.md` §11 各补一句。
- 不改：两个预览组件本身（它们继续调 `sanitizeHtml`）、发信路径、`src/lib/ai-markdown/url-policy.ts` 的既有导出、任何服务端代码、`prisma/`、`vercel.json`。
