# TREE-1 报告 — 读公开网页（`public-page-reader`，含 TREE-0 登记例外）

任务书：`docs/QINGYAN_TREE_RESEARCH_TREE_TASKBRIEF.md`（Evan 2026-11-22）。四件套：`openspec/changes/public-page-reader/`。交接：`docs/QINGYAN_TREE_HANDOFF.md`。

## 1. 做了什么

- **读公开网页的唯一入口** `src/lib/web-reader/`：`readPublicPage(url, ctx)`；上下文只能由 `createResearchReadSession({ orgId, jobId })` 从库里核对过的「人发起的调研 Job」建出，再 `session.forBranch({ branchKey, budget, deadlineAt })` 得到每一支的上下文。
- **六条读网页规则全部在代码里强制**：只在人发起的调研 Job 里读（定时任务 / 没有 Job / 不是调研 Job / 开关关 → 抛错、零请求）；用户代理 `QingyanResearchBot/1.0 (+https://qingyan.ca)`；只 GET、不带 cookie 与任何凭证；被挡即停（登录页 / 验证码 / 401 / 403 / 407 / 跳转到登录地址 / robots）；超时 / 中断 / 5xx 最多重试 2 次（等 1 秒、3 秒），429 只在 `Retry-After` ≤30 秒时等够再试一次；每次读页扣 1 次额度（跳转、重试、robots 不扣）、同站请求开始时间间隔 ≥2 秒；同一棵树内同址只读一次（并发合并）。
- **安全护栏**：只 http / https、只 80 / 443、网址带凭证拒绝；解析出的地址是内网 / 回环 / 链路本地 / 保留段一律拒绝，连接时由传输层的 `lookup` 再校验一次（防 DNS 重绑定）；最多跟 3 次跳转、每跳重新校验；单次请求 15 秒；正文解压后 2 MB 截断。
- **内容**：HTML / XHTML 转纯文本（公共模块）、纯文本、PDF（unpdf，U+0000 → 空格）；其它类型拒绝。返回 `{ untrusted: true, url, finalUrl, fetchedAt, text, truncated, blocked, outcome, reason, messageZh, httpStatus, attempts, fromCache }`。
- **站点名单**：「不碰」预置 `detail.1688.com`、`login.1688.com`、`merx.com`、`linkedin.com`、`facebook.com`、`instagram.com`；「按人发起处理」预置 `importyeti.com`（不看 robots，额度相同）；「可以读」预置 `canada.ca`、`gc.ca`、`canadabuys.canada.ca`。组织设置 `settingsJson.researchTree.sites` 只能加「不碰」与「可以读」。
- **审计**：每次实际发出页面请求写一条 `research.web_read`，只记网址、最终网址、结果类别、状态、字数、是否截断、原因、尝试次数、站点、分支；不记正文与头。
- **HTML 转文本挪成公共模块** `src/lib/text/html-to-text.ts`（原 `trade/email-forward-parse.ts` 那一份，输入上限做参数；邮件解析仍传 200 000，行为不变）。
- **开关** `src/lib/tender-research-tree/flags.ts`：`TENDER_RESEARCH_TREE_ENABLED` + `TENDER_RESEARCH_TREE_ORG_ALLOWLIST`。
- **TREE-0**：`openspec/config.yaml` 第 7 条「例外二」与两条范围反转；TASKFLOW 新节登记 TREE-0 ～ TREE-8；任务书入库；交接文档新建。

## 2. 改了哪些文件

- 新增：`src/lib/web-reader/{index,read-page,transport,pure,types}.ts`、`src/lib/text/html-to-text.ts`、`src/lib/tender-research-tree/flags.ts`；测试 `src/lib/web-reader/__tests__/{web-reader,web-reader-pure}.test.ts`、`web-reader-context-db.isolated.test.ts`、`src/lib/text/__tests__/html-to-text.test.ts`。
- 修改：`src/lib/trade/email-forward-parse.ts`（改为调用公共模块）、`scripts/test-all.sh`、`scripts/test-ci-unit.sh`（只新增注册）、`openspec/config.yaml`、`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`。
- 新增文档：`docs/QINGYAN_TREE_RESEARCH_TREE_TASKBRIEF.md`、`docs/QINGYAN_TREE_HANDOFF.md`、本报告。
- 没动：`prisma/**`、`vercel.json`、`src/lib/workforce-runtime/**`、`src/app/**`、`src/lib/tender-intel/**`、`src/lib/tender-workforce/**`。

## 3. 测试

（门禁结果见 §4）

## 4. 门禁

（待填）

## 5. 多维审查与交叉验证

（待填）

## 6. 没验证到的地方

- 真实网络（政府站、gzip / br、真实 PDF、慢速响应）：本 change 没有调用方，生产上不会发出请求；真实读取在 TREE-2 接入后、预发验收时第一次发生。
- 同站 2 秒间隔只在同一进程内保证。

## 7. 回退办法

revert 本 PR 的合并提交即可：没有调用方、没有数据、没有迁移；`email-forward-parse.ts` 恢复原样。
