# Tasks

## 1. 策略生成

- [x] 1.1 新增 `src/lib/security/csp.ts`（纯函数：`resolveCspMode`、`sentryIngestOrigin`、`buildCspDirectives`、`buildSecurityHeaders`、`fileResponseCsp`；页面规则与粗报价工具页规则的 `source`）。verify：`npx tsx src/lib/security/__tests__/csp.test.ts` 的纯函数段通过

## 2. 接线

- [x] 2.1 `next.config.ts` 加 `async headers()`，直接返回 `buildSecurityHeaders(process.env)`；`.env.example` 写明 `CSP_MODE` 三种取值。verify：同一测试的源码段通过；本地起服务后 `curl -sI http://localhost:<端口>/login` 带 `content-security-policy`
- [x] 2.2 `src/app/api/files/[...path]/route.ts` 成功返回文件时按内容类型加沙箱响应头。verify：同一测试的源码段通过；`docs/acceptance/site-csp-baseline/file-proxy.txt` 里网页类型带 `sandbox`、PDF 不带

## 3. 测试与注册

- [x] 3.1 写 `src/lib/security/__tests__/csp.test.ts`（纯函数、源码、真实浏览器三段——找不到 Chromium 时浏览器段 SKIP），在 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` 注册。verify：测试通过且本机真实浏览器段没有跳过；`bash scripts/check-test-registry.sh` 通过

## 4. 实测记录与文档

- [x] 4.1 本地起服务做两份实测并存档：22 个页面的巡检（`docs/acceptance/site-csp-baseline/page-crawl.txt`）、文件代理三种模式的实测（`file-proxy.txt`）。verify：`page-crawl.txt` 每行 `header` 为 `yes`、`violations` 为空；`file-proxy.txt` 里强制模式 `scriptRan:false`、关闭模式 `scriptRan:true`
- [x] 4.2 更新 `docs/QINGYAN_MAIL-1_REPORT.md` §9 与 `docs/QINGYAN_MAIL-2_REPORT.md` §11（「全站没有内容安全策略」改为已加基线，写明不限制图片 / 脚本 / 样式）。verify：两份文档里有 `site-csp-baseline`
- [ ] 4.3 全量验证。verify：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`openspec validate site-csp-baseline --strict` 通过；`git diff --stat main -- prisma vercel.json src/proxy.ts public` 为空；`npm test` 的失败集合与 main 对照

## Workflow follow-up

- `/opsx:verify site-csp-baseline`，开 PR；合并后 `/opsx:archive site-csp-baseline --yes`（独立小 PR）。
