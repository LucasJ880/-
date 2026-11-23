# Tasks：读公开网页（TREE-1，含 TREE-0）

## 1. TREE-0 登记

- [ ] 1.1 `openspec/config.yaml` 硬纪律第 7 条补「例外二（TREE-0）」与两条范围反转、文件头来源注释加一行；任务书放进 `docs/QINGYAN_TREE_RESEARCH_TREE_TASKBRIEF.md`；`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 新增「Phase F（续）— 情报调研树」并登记 TREE-0 ～ TREE-8；新建 `docs/QINGYAN_TREE_HANDOFF.md`（verify：`openspec update` 无 diff、`openspec validate public-page-reader --strict` 通过；`git diff origin/main -- openspec/config.yaml` 只有新增行与文件头一行；TASKFLOW 新节有 9 行）

## 2. 公共模块与开关

- [ ] 2.1 HTML 转文本挪到 `src/lib/text/html-to-text.ts`（输入上限做参数），`trade/email-forward-parse.ts` 改为调用（传 200 000）；新增 `src/lib/text/__tests__/html-to-text.test.ts`；新增 `src/lib/tender-research-tree/flags.ts`；测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（verify：`npx tsx src/lib/trade/__tests__/email-forward-parse.test.ts` 与 `npx tsx src/lib/text/__tests__/html-to-text.test.ts` 通过；`bash scripts/check-test-registry.sh` 通过）

## 3. 读网页的纯函数

- [ ] 3.1 `src/lib/web-reader/` 的纯函数：内网地址判断、网址校验（协议 / 端口 / 凭证）、站点名单与组织覆盖合并、robots 解析与匹配、登录页 / 验证码识别、`Retry-After` 解析、网址归一；新增 `web-reader-pure.test.ts` 并注册（verify：`npx tsx src/lib/web-reader/__tests__/web-reader-pure.test.ts` 通过，含开关真值表）

## 4. 读网页入口

- [ ] 4.1 读页上下文（Job 校验、定时任务拒绝、开关）、树级缓存与站点节拍器、额度、真实传输（`http` / `https.request` + 连接时校验地址 + 解压与 2 MB 截断 + 15 秒）、重试与被挡规则、HTML / PDF / 文本抽取、审计；新增 `web-reader.test.ts`（全部假网络）并注册（verify：`npx tsx src/lib/web-reader/__tests__/web-reader.test.ts` 通过，覆盖 spec 里 `web-reader.test.ts` 的全部场景）
- [ ] 4.2 新增 `web-reader-context-db.isolated.test.ts`（隔离库：调研 Job / 一键分析 Job / 别的组织的 Job / 缺发起人；审计落库且不含正文）并注册（verify：`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/web-reader/__tests__/web-reader-context-db.isolated.test.ts` 通过）

## 5. 门禁与报告

- [ ] 5.1 全量门禁与零变化核对（verify：`npm test` 只有 main 基线上同样的失败；`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/test-runtime-architecture.sh` 通过；`git grep -n "web-reader" -- src/app src/lib/tender-intel src/lib/tender-workforce src/lib/workforce-runtime` 为空；`git diff origin/main -- prisma/ vercel.json src/lib/workforce-runtime/` 为空）
- [ ] 5.2 写 `docs/QINGYAN_TREE-1_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含门禁结果、多维审查与交叉验证结论、没验证到的地方与回退办法；TASKFLOW 的 TREE-0、TREE-1 两行为 `[~]`；交接文档更新）
