# Tasks

开工前先跑将要触碰模块的已注册测试并记下基线通过数：`npx tsx src/lib/navigation/__tests__/entry-naming.test.ts`、`npx tsx src/lib/preview/__tests__/preview.test.ts`（这两个对 `chat-panel.tsx` 等页面做源码断言）、`npx tsx src/lib/agent-core/__tests__/mail-untrusted-guard.test.ts`。

## 1. 地址判定

- [x] 1.1 新增 `src/lib/ai-markdown/url-policy.ts`（纯函数，不引 React、不读环境：图片地址判定——以单个 `/` 开头、按固定占位源解析后源不变、规范化路径位于 `/api/files/` 之下才放行，返回规范化后的站内路径；被拦图片的提示文字拼装；链接是否外部与主机名提取）；新增 `src/lib/ai-markdown/__tests__/url-policy.test.ts`（表驱动：外部 / 协议相对 / 反斜杠 / 夹制表符 / `data:` / `javascript:` / 路径穿越两种写法 / 站内其它路径 / 不以 `/` 开头 / 指向自己域名的绝对地址 / 放行的站内文件路径；提示文字有无替代文字、有无主机名四种组合；源码里没有 `process.env`、`window`、`fetch`），并在 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 注册。verify：`npx tsx src/lib/ai-markdown/__tests__/url-policy.test.ts` 通过；`bash scripts/check-test-registry.sh` 通过

## 2. 统一渲染组件

- [x] 2.1 新增 `src/components/ai-markdown.tsx`（固定 `remark-gfm`；接收调用方 `components`，`img` 与 `a` 两项最后合并、调用方覆盖不了；不传 `urlTransform`；放行的图片渲染为 `<img>`，被拦的渲染为不可点击的文字提示；外部链接加 `target="_blank"`、`rel="noopener noreferrer nofollow"`，链接文字不含主机名时在链接后追加主机名，站内链接原样）；新增 `src/components/__tests__/ai-markdown.test.tsx`（服务端静态渲染，覆盖 spec 里「允许清单之外的图片不自动加载」「被拦下的图片显示为不可点击的文字提示」「站内文件图片照常显示」「外部链接可点击并显示真实去向」各场景，以及「调用方不能把图片规则换掉」），并在 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 注册。verify：`npx tsx src/components/__tests__/ai-markdown.test.tsx` 通过

## 3. 五个页面改用统一组件

- [x] 3.1 把 `src/app/(main)/assistant/chat-panel.tsx`（继续传既有的 `mdComponents`）、`src/app/(main)/trade/chat/page.tsx`、`src/components/market-intelligence/monitoring-workspace.tsx`、`src/components/market-intelligence/manual-analysis-panel.tsx`、`src/components/bidtogo/intelligence-card.tsx` 的 Markdown 渲染换成统一组件，删掉这五个文件里对 `react-markdown` / `remark-gfm` 的直接引入，其余逻辑与样式类名不动；在 `ai-markdown.test.tsx` 里补源码断言（五个文件都用统一组件且不再直接引入渲染库；`src/` 下直接引入 `react-markdown` 的文件只有统一组件一个，否则列出路径并失败）。verify：`npx tsx src/components/__tests__/ai-markdown.test.tsx` 通过；`git grep -n "from \"react-markdown\"" -- src` 只剩 `src/components/ai-markdown.tsx` 一行；开工前记下的三个基线测试通过数不低于基线；`npm run typecheck` 通过

## 4. 浏览器实测

- [x] 4.1 本地起应用，在助手对话页放一条同时含外部图片、站内文件图片、文字与去向不一致的外部链接的助手消息，打开开发者工具网络面板确认没有发往外部主机的请求、站内图片照常显示、外部链接后带主机名。verify：截图两张（对话气泡、网络面板）存 `docs/acceptance/ai-markdown-image-allowlist/`；起不了本地应用时在 PR 描述里写明「浏览器实测未做」及原因，不以测试通过代替。实施后的说明（2026-11-15）：实测已做（本机 `next dev` + 隔离库 + Chromium）；没有截开发者工具的网络面板，改为记录浏览器发出的全部请求并另起一个本机服务充当外部主机，两边的记录写在 `browser-acceptance.txt`；另在改动前的代码上跑了同一条消息作对比。截图三张：气泡、整页、改动前的气泡

## 5. 文档与全量验证

- [x] 5.1 更新 `docs/QINGYAN_MAIL-1_REPORT.md`（§9 第 1 点与 §11「运维前置」第 4 点各追加一句：已由 change `ai-markdown-image-allowlist` 关闭、关的是什么、没关的是什么——邮件 HTML 预览与全站 CSP）与 `docs/QINGYAN_MAIL-2_REPORT.md` §3.3（同样追加）；原有文字保留，只追加带日期的说明。verify：`git diff main -- docs/QINGYAN_MAIL-1_REPORT.md docs/QINGYAN_MAIL-2_REPORT.md` 只有新增行、没有删除行
- [x] 5.2 全量验证。verify：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate ai-markdown-image-allowlist --strict` 全部通过；`git diff --stat main -- src/app/api prisma vercel.json next.config.ts src/proxy.ts package.json package-lock.json` 为空。实施后的说明（2026-11-15，合并 main `148df620` 之后，Node 22.23.4）：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate … --strict` 全部通过，上面的 `git diff --stat` 为空。`npm test` 是 655/668，**不是全部通过**：13 个失败都与本 change 无关——11 个因为这台机器没有 `DATABASE_URL` 被库安全检查拦下（Agent Trace、Phase3A-2/3/4/5 共 8 个、Governance Hygiene 两个、T4 授标情报矩阵）；另外 2 个（`google-email-oauth.test.ts`、`quotation-pdf-layout-e2e.ts`）在同一台机器上未改动的 main 上以同样的断言失败，前者在 `test:ci`（`NODE_ENV=test`）里通过。本 change 新增的两个测试在两套里都通过（67 项、62 项）。以 PR 上的 CI 结果为准

## Workflow follow-up

- `/opsx:verify ai-markdown-image-allowlist`，然后开 PR（一个 change = 一个 PR）；PR 描述写明 design「发现」里的两条没有在本 change 里改。
- 合并并部署之后，生产打开 `MAIL_READ_ENABLED` 的前置里「外部图片」这一项才算满足；其余前置见 `docs/QINGYAN_MAIL-1_REPORT.md` §11。
- PR 合并后 `/opsx:archive ai-markdown-image-allowlist --yes`（独立小 PR），确认 `openspec list --specs` 列出 `agents/ai-output-rendering`；同一个 PR 里在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 MAIL-1 行状态列补一句「外部图片自动加载已由 #PR 号关闭」。
