# Proposal：模型输出里的外部图片不自动加载

TASKFLOW：无（基础设施；收口 `docs/QINGYAN_MAIL-1_REPORT.md` §9 第 1 点与 `docs/QINGYAN_MAIL-2_REPORT.md` §3.3，是生产打开 `MAIL_READ_ENABLED` 的前置）。不触碰 `muse-bridge`，没有受影响的 Muse 意图。

## Why

青砚把模型输出按 Markdown 渲染的五个页面都不限制图片来源，全站也没有内容安全策略：模型读到的外部内容（邮件、网页、标书、附件）只要让它在回复里写一张地址里夹着数据的图片，浏览器就会自己去请求那个地址，数据不经用户点击就出去了。MAIL-1 的写入封锁与原文省略都挡不住这条路，必须在生产打开读信开关之前关掉。

## What Changes

**图片**
- 拦下允许清单之外的图片：模型输出里的图片地址只要不是站内文件代理（`/api/files/` 之下的站内相对路径），页面不生成图片元素，也不生成任何会让浏览器自动请求该地址的元素。行内写法、引用式写法、协议相对地址（`//host/…`）、包在链接里的图片同样处理。
- 把被拦下的图片显示成一段不可点击的文字提示：含「图片未加载」、图片的替代文字、地址的主机名；不输出完整地址。
- 保留站内文件图片：`/api/files/` 之下的站内相对路径照常显示；带 `..` 穿越、落到 `/api/files/` 之外的站内路径一律拦下。

**覆盖面**
- 把同一条规则用到全部五个渲染模型输出的页面：助手对话（`/assistant`）、外贸对话（`/trade/chat`）、市场情报的监测详情与手动分析、标讯情报卡。
- 新增一条源码断言测试：仓库里除统一渲染组件外，没有第二处直接使用 Markdown 渲染库。

**链接**
- 保持链接可点击（点击是用户自己的选择，不属于自动加载）。
- 给外部链接补三样：在新标签页打开、不向目标站带来源页与窗口句柄、链接文字里没有目标主机名时在链接后面显示主机名。站内相对链接维持原样。

**不变的部分**
- 不改任何接口、不改存库的消息文本、不改系统提示；规则只作用在浏览器端渲染。
- 不加开关：规则对所有组织、所有用户始终生效，与 `MAIL_READ_ENABLED` 是否打开无关。
- 不新增模型调用、不新增依赖、不新增环境变量；零 schema。

**测试与文档**
- 新增并注册两个测试（`scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）：图片地址判定的表驱动测试；渲染结果测试（外部图片不产生图片元素、站内图片照常产生、外部链接三样属性、五个页面的源码断言）。
- 更新 `docs/QINGYAN_MAIL-1_REPORT.md` §9 第 1 点、§11 第 4 点与 `docs/QINGYAN_MAIL-2_REPORT.md` §3.3：写明这条路已由本 change 关闭。

## Capabilities

### New Capabilities
- `agents/ai-output-rendering`：模型输出在网页上按 Markdown 渲染时的资源加载规则——哪些图片地址允许显示、被拦下的图片显示成什么、外部链接怎么呈现、规则覆盖哪些页面。

### Modified Capabilities

（无。`mail/assistant-read` 里「邮件内容是不可信资料」的 Requirement 文字不变：那条规定的是系统提示里的固定规则，本 change 在渲染层另加一道确定性的拦截，不改它。）

## Impact

- 新增：`src/lib/ai-markdown/**`（图片与链接地址判定的纯函数与测试）、`src/components/ai-markdown.tsx`（统一渲染组件）、`src/components/__tests__/ai-markdown.test.tsx`。
- 修改（只把 Markdown 渲染换成统一组件，其余逻辑不动）：`src/app/(main)/assistant/chat-panel.tsx`、`src/app/(main)/trade/chat/page.tsx`、`src/components/market-intelligence/monitoring-workspace.tsx`、`src/components/market-intelligence/manual-analysis-panel.tsx`、`src/components/bidtogo/intelligence-card.tsx`、`scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 文档：`docs/QINGYAN_MAIL-1_REPORT.md`、`docs/QINGYAN_MAIL-2_REPORT.md`。
- 对用户可见的变化：模型输出里的外部图片从「直接显示」变成一行文字提示；外部链接改为新标签页打开并带主机名。核对结果：现在没有任何功能依赖在模型输出里显示图片——工具结果与提示词都不产出图片写法，助手的系统提示还明确禁止插图；用户上传的图片附件由附件组件显示，不走 Markdown，不受影响。
- 零 schema；`vercel.json`、`prisma/`、`src/app/api/**`、`next.config.ts`、`src/proxy.ts` 无 diff。

## Out of scope

- 全站内容安全策略（CSP `img-src`）：站内其它页面有来自外部地址的图片（已核对到两处：微信登录带回的用户头像、运营矩阵页的社媒账号头像），没有逐页清点之前加策略会打坏这些页面；另开 change，先以只报告模式上线。
- AI 起草的邮件 HTML 预览（`src/components/project-question/project-question-dialog.tsx`、`src/app/(main)/sales/ai-alert-panel.tsx`）：它们经 `src/lib/common/sanitize.ts` 渲染，净化规则允许 `img` 与 `style`，存在同一类自动加载。它们是待发邮件的预览，改净化规则会让预览与实际发出的内容不一致，需要单独设计；本 change 不改，在 design 里登记为发现。
- 服务端对模型输出做任何改写或过滤（存库文本、流式内容、微信 / Muse 通道的文字）。
- 把外部链接改成不可点击，或加「即将离开青砚」的中转确认页。
- 系统提示里「回复里不插入图片」的固定规则（保留，不删不改）。
- MAIL-1 报告 §9 的第 2、3 点（`l2_soft` 工具直接写库、写入封锁只管同一轮）。
- 项目问青砚（`src/components/project-ai-chat/project-ai-chat.tsx`）：它按纯文本逐行显示模型输出，不渲染 Markdown，没有这条路。
