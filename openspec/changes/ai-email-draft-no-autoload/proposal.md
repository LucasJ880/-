# Proposal：AI 起草的邮件 HTML 不自动加载外部地址

TASKFLOW：无（基础设施；收口 change `ai-markdown-image-allowlist` design「发现」第 1 点，即 `docs/QINGYAN_MAIL-1_REPORT.md` §9 第 1 点补记里写明「没关」的邮件 HTML 预览）。不触碰 `muse-bridge`，没有受影响的 Muse 意图。

## Why

澄清邮件与销售跟进邮件的正文是模型写的 HTML，从生成、预览到发出一路没有任何一处限制图片与样式里的地址：2026-11-16 在 Chromium 里实测，现行预览净化规则下 13 种写法（`<img src>`、`style` 里的 `url(…)` / `image-set(…)` / CSS 转义写法等）都让浏览器不经点击就发出请求，其中一种还带着登录态请求站内地址。模型读到的标书、客户资料、来信只要让它在草稿里写进一个夹着数据的地址，审核人一打开预览数据就出去了；点了发送，同一个地址还会随邮件发给客户或业主。

## What Changes

**规则**
- 新增一条确定性的邮件草稿 HTML 规范化规则：按允许清单重新生成 HTML，结果里没有图片元素，`style` 里没有任何带地址的声明，也没有其它会让浏览器或邮件客户端自动请求某个地址的写法。链接（`http` / `https` / `mailto`）保留、仍可点击。
- 保持现有品牌版式与五个降级模板逐字不变（只差空白与写法）：它们不含图片，内联样式都在允许清单内。

**生成**
- 在三个生成出口对正文做规范化后再入库、再返回：澄清邮件生成（`POST /api/projects/[id]/questions`）、跟进邮件生成（`POST /api/sales/email-compose`）、跟进邮件改写（`POST /api/sales/email-compose?action=refine`）。
- 在这三个接口的响应里新增字段 `removedAutoLoad`（`{ count, hosts }`）：被移除了几处、涉及哪些主机名；不含地址的路径与查询串。
- 在澄清邮件生成既有的那条审计记录里带上同一个字段。

**发送**
- 在两个发送出口对收到的正文做同一规范化，发出与入库的都是规范化之后的正文：澄清邮件发送（`POST /api/projects/[id]/questions/[questionId]/send`）、跟进邮件发送（`POST /api/sales/email-compose?action=send-approved`）。两个接口既有的校验与拒绝条件不变。

**预览**
- 让两处预览（澄清邮件对话框、销售行动队列的跟进邮件审阅）显示规范化之后的正文，与点「发送」后发出的正文一致。
- 从预览净化规则里去掉 `img` 标签与 `src` 属性。
- 在预览里加一行提示：正文被移除过内容时显示移除了几处、涉及的主机名，并写明发出的邮件与预览一致。

**不变的部分**
- 不改任何提示词，不新增模型调用，不新增依赖、环境变量与开关；零 schema。
- 不改发送的触发方式与权限：谁能点发送、发给谁、走哪个邮箱都不变。

**测试与文档**
- 新增并注册两个测试（`scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）：规范化规则的表驱动测试（含本次实测到的全部写法）；接线测试（生成 / 发送 / 预览都经过同一规则、现有版式不变、仓库里没有登记清单之外把 HTML 字符串直接放进页面的文件）。
- 新增并注册一个真实 Chromium 的测试脚本 `scripts/email-draft-preview-browser-e2e.ts`（只进 `scripts/test-all.sh`；没设 `CHROME_EXECUTABLE_PATH` 时打印 SKIP 并以 0 退出）：草稿含外部图片与带地址样式时，预览与整封邮件都不让浏览器发出请求。
- 把该脚本改动前 / 改动后的输出与两处预览的整页截图存到 `docs/acceptance/ai-email-draft-no-autoload/`。
- 在 `docs/QINGYAN_MAIL-1_REPORT.md` §9 第 1 点与 `docs/QINGYAN_MAIL-2_REPORT.md` §3.3 各追加一条带日期的补记。

## Capabilities

### New Capabilities
- `agents/ai-email-draft-html`：模型起草的邮件 HTML 允许包含什么——哪些内容会被移除、预览与发出的正文是否一致、移除时告诉审核人什么、规则覆盖哪些入口。

### Modified Capabilities

（无。`agents/ai-output-rendering` 管的是按 Markdown 渲染的模型输出，其 Requirement 文字不变；本 change 管的是另一条路：模型直接写 HTML 的邮件草稿。）

## Impact

- 新增：`src/lib/email-draft-html/**`（规范化纯函数与两个测试）、`scripts/email-draft-preview-browser-e2e.ts`。
- 修改：`src/lib/common/sanitize.ts`（先规范化、再净化；去掉 `img` / `src`）、`src/components/project-question/project-question-dialog.tsx`、`src/app/(main)/sales/ai-alert-panel.tsx`、`src/app/(main)/sales/types.ts`（草稿类型加一个可选字段）、`src/app/api/projects/[id]/questions/route.ts`、`src/app/api/projects/[id]/questions/[questionId]/send/route.ts`、`src/app/api/sales/email-compose/route.ts`、`src/lib/sales/email-composer.ts`（生成与改写的出口；版式与降级模板函数只加 `export` 供测试引用，内容不动）、`scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 文档：`docs/QINGYAN_MAIL-1_REPORT.md`、`docs/QINGYAN_MAIL-2_REPORT.md`、`docs/acceptance/ai-email-draft-no-autoload/`。
- 接口：三个生成接口的响应多一个字段 `removedAutoLoad`（只增不改）；两个发送接口的请求与响应形状不变。
- 对外发出的邮件：草稿里有图片、带地址的样式或允许清单之外的标签 / 属性 / 样式声明时，这些内容不再随邮件发出。已核对：现有提示词只要求 `<p>` `<br>` `<ul>` `<li>` `<strong>` 这类标签；品牌版式与降级模板没有图片；这两条发信路径不追加签名或 logo。所以按现有提示词产出的正常草稿，发出的内容不变。
- 助手对话里的 `sales_send_quote_email` 工具走同一个生成函数，生成的正文同样被规范化；该工具本身与它的审批要求不动。
- 零 schema；`prisma/`、`vercel.json`、`next.config.ts`、`src/proxy.ts`、`src/lib/ai/prompts/**`、`package.json`、`package-lock.json` 无 diff。

## Out of scope

- 全站内容安全策略（CSP）：不在本 change 里加，只报告模式也不加。理由见 design D5；另开 change。
- 其它放在沙箱 iframe 里的邮件预览（`src/app/(main)/revenue/[id]/page.tsx`、`src/app/(main)/settings/email/email-profile-card.tsx`、`src/components/accounting/warranty-panel.tsx`）：它们的 HTML 由服务端模板拼出，不是模型直接写的 HTML。本 change 不动；核对到什么程度写在 design「发现」第 2 点。
- 把这两条发信路径改成先建 PendingAction：见 design「发现」第 1 点，需要 Evan 单独决定。
- 改提示词让模型「不要写图片」：靠模型自觉，不是确定性的拦截；提示词不动。
- 给邮件草稿开放图片（签名图、logo）：现在没有任何草稿需要；以后要加，图片地址必须来自组织设置而不是模型，另开 change。
- 历史数据：已入库的 `ProjectQuestion.generatedBody` / `ProjectEmail.body` 不回刷（已核对：页面上没有任何地方把历史记录里的正文重新渲染成 HTML）。
- 外部链接的呈现（新标签页打开、显示主机名）：预览里的链接维持现状。
