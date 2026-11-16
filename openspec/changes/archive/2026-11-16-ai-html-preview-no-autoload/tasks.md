# Tasks

## 1. 内联样式过滤

- [x] 1.1 新增 `src/lib/common/inline-style-policy.ts`（纯函数 `sanitizeInlineStyle`：按 `;` 拆声明；属性名为普通标识符；值里的函数名须在 `rgb / rgba / hsl / hsla / calc` 内；值含反斜杠、`/*`、`@` 的去掉；保留的声明顺序不变）。verify：`npx tsx src/lib/common/__tests__/sanitize-html.test.ts` 的纯函数段通过

## 2. 净化函数

- [x] 2.1 改 `src/lib/common/sanitize.ts`：DOMPurify 返回 DOM 后处理 `img`（`classifyAiImageSrc` 放行的改成规范化站内路径，其余换成只含 `blockedImageLabel` 文字的 `span`）与 `style`（`sanitizeInlineStyle`，结果为空则去掉属性）；没有 `window` 时返回空字符串。verify：同一测试的源码段与（有 Chromium 时）真实浏览器段通过

## 3. 测试与注册

- [x] 3.1 写 `src/lib/common/__tests__/sanitize-html.test.ts`（三段：纯函数、源码与 `dangerouslySetInnerHTML` 清单、真实浏览器——找不到 Chromium 时该段 SKIP），在 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` 注册。verify：`npx tsx src/lib/common/__tests__/sanitize-html.test.ts` 通过且本机真实浏览器段没有跳过；`bash scripts/check-test-registry.sh` 通过

## 4. 文档与全量验证

- [x] 4.1 更新 `docs/QINGYAN_MAIL-1_REPORT.md` §9 与 `docs/QINGYAN_MAIL-2_REPORT.md` §11（邮件 HTML 预览一处改为已修，写明没有审的 `iframe srcDoc` 预览与没有内容安全策略）。verify：两份文档里有 `ai-html-preview-no-autoload`
- [x] 4.2 全量验证。verify：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`openspec validate ai-html-preview-no-autoload --strict` 通过；`git diff --stat main -- src/app/api prisma vercel.json` 为空；`npm test` 的失败集合与 main 对照
  - 实施备注：`npm test` 666 / 679 通过，13 个失败全部在此前 main 的基线失败集合里（缺 `DATABASE_URL` 等环境原因），没有新增；main 的基线是 2026-11-15 `0925ec9d` 那一轮跑的，之后 main 上修掉了其中 1 项，这次没有在最新 main 上重跑基线。新测试连同真实浏览器段通过（56 项，没有跳过）。

## Workflow follow-up

- `/opsx:verify ai-html-preview-no-autoload`，开 PR；合并后 `/opsx:archive ai-html-preview-no-autoload --yes`（独立小 PR）。
