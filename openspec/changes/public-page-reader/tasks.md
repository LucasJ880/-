# Tasks：读公开网页（TREE-1，含 TREE-0）

## 1. TREE-0 登记

- [x] 1.1 `openspec/config.yaml` 硬纪律第 7 条补「例外二（TREE-0）」与两条范围反转、文件头来源注释加一行；任务书放进 `docs/QINGYAN_TREE_RESEARCH_TREE_TASKBRIEF.md`；`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 新增「Phase F（续）— 情报调研树」并登记 TREE-0 ～ TREE-8；新建 `docs/QINGYAN_TREE_HANDOFF.md`（verify：`openspec update` 无 diff、`openspec validate public-page-reader --strict` 通过；`git diff origin/main -- openspec/config.yaml` 只有文件头新增一行与第 7 条那一行（「唯一例外」改「例外一」并补例外二）；TASKFLOW 新节有 9 行）

## 2. 公共模块与开关

- [x] 2.1 HTML 转文本挪到 `src/lib/text/html-to-text.ts`（输入上限做参数），`trade/email-forward-parse.ts` 改为调用（传 200000）；新增 `src/lib/text/__tests__/html-to-text.test.ts`；新增 `src/lib/tender-research-tree/flags.ts`；测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（verify：`npx tsx src/lib/trade/__tests__/email-forward-parse.test.ts` 与 `npx tsx src/lib/text/__tests__/html-to-text.test.ts` 通过；`bash scripts/check-test-registry.sh` 通过）

## 3. 读网页的纯函数

- [x] 3.1 `src/lib/web-reader/` 的纯函数：内网地址判断、网址校验（协议 / 端口 / 凭证）、站点名单与组织覆盖合并、robots 解析与匹配、登录页 / 验证码识别、`Retry-After` 解析、网址归一；新增 `web-reader-pure.test.ts` 并注册（verify：`npx tsx src/lib/web-reader/__tests__/web-reader-pure.test.ts` 通过，含开关真值表）

## 4. 读网页入口

- [x] 4.1 读页会话（Job 校验、定时任务拒绝、开关）、会话缓存与站点节拍、额度、真实传输（`http` / `https.request` + 连接时校验地址 + 解压与 2 MB 截断 + 15 秒）、重试与被挡规则、HTML / 文本抽取（PDF 不解析）、网址检查、内部状态与审计历史、审计；新增 `web-reader.test.ts`、`web-reader-edges.test.ts`（假网络与虚拟时钟）、`web-reader-transport.test.ts`（本机服务）并注册（verify：三份都通过，覆盖 spec 里对应的全部场景）
- [x] 4.2 新增 `web-reader-context-db.isolated.test.ts`（隔离库：调研 Job / 一键分析 Job / 别的组织的 Job / 缺发起人；审计落库且不含正文）并注册（verify：`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/web-reader/__tests__/web-reader-context-db.isolated.test.ts` 通过）

## 5. 第三轮挑错修订

- [x] 5.0 第三轮挑错的 17 条（design D13）：抓取代理 / 快照 / 翻译代理预置不碰 + 网址里嵌着被挡站 / 不碰站的按被挡 / 不读；树账本（同一 Job 的会话共用额度、分支数、取 robots 次数、被挡站）；审计历史超过 2000 行不再读页；审计加 `robotsFetches` 与 `fromCache`，缓存被挡也写一条；每支被挡站上限 24；截断时销毁解压流；只读 HTML、`%PDF-` 字节不读；网址检查只认 true；被挡站归一；robots 组名与重复斜杠；meta refresh 引号；`robots_limit` 文案；缓存写失败照写审计；守卫扫 `.mts` / `.cts`；规格补「不经代理换地址」「其它状态码」（verify：`web-reader-edges.test.ts`、`web-reader-pure.test.ts`、`web-reader-transport.test.ts`（含 brotli 炸弹 CPU 用例，去掉修复时失败）、`web-reader-context-db.isolated.test.ts` 通过；`openspec validate public-page-reader --strict` 通过）

- [x] 5.1 第四轮挑错的 13 条（design D14）：robots 次数只计没读页的读页；被挡立刻记；额度上限取最小记进账本；被挡记主机、兄弟子域名不连带；嵌入主机名三层解码 / 认不清不读 / 全角句点；前缀式代理；账本上限 4096；嵌着不碰站与历史超限单独原因；robots「*bot」；规格补「分支上下文的入参」；被挡站归属；节拍表清理；`%PDF-` 跳过空白（verify：`web-reader-edges.test.ts` 新增 15 条在修前的代码上 14 条失败、修后全过；`web-reader-pure.test.ts`、`web-reader.test.ts`、`web-reader-transport.test.ts`、`web-reader-context-db.isolated.test.ts` 通过；`openspec validate public-page-reader --strict` 通过）

- [x] 5.2 第五轮挑错（design D15）：被挡匹配改回站点键 + 后缀、伞形政府域名例外；代理式主机名按被挡主机与站点键、以不碰站打头也不读；宽松解码；已扣额度后取 robots 不查不计、只退计上的；国际化域名归一（verify：`web-reader-edges.test.ts` 新增 18 条在修前的代码上 14 条失败、修后全过；其余 5 份测试与 `openspec validate public-page-reader --strict` 通过）

## 6. 门禁与报告

- [x] 6.1 全量门禁与零变化核对（verify：`npm test` 只有 main 基线上同样的失败；`npm run test:ci`（不连库，同 CI）、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/test-runtime-architecture.sh` 通过；全仓 `git grep -nE "web-reader|tender-research-tree|lib/text/html-to-text" -- src scripts` 除本模块、测试、注册行与 `trade/email-forward-parse.ts` 外为空；`git diff origin/main -- prisma/ vercel.json next.config.ts src/lib/workforce-runtime/` 为空）
- [x] 6.2 写 `docs/QINGYAN_TREE-1_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含门禁结果、多维审查与交叉验证结论、没验证到的地方与回退办法；TASKFLOW 的 TREE-0、TREE-1 两行为 `[~]`；交接文档更新）
