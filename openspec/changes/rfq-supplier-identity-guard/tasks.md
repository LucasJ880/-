# Tasks：询价不再带出招标身份（CHAIN-4b）

开工前先跑一遍要触碰模块的已注册测试并记下基线通过数（`build.test.ts`、`web-entry-pure.test.ts`、`auto-draft-pure.test.ts`、`tender-doc-html.test.ts`、`china-supplier-brief.test.ts`、`cjk-pdf.test.ts`，隔离库 `stage-auto-db`、`followup-auto-db`、`auto-draft-db`），写进报告。

## 1. 禁出清单（纯函数与加载器）

- [x] 1.1 新增 `src/lib/bid-workflow/project-identity-deny.ts`：五类清单与派生词条、规整与整词比对、邮箱与电话格式检查（允许名单）、`authored` 分段扫描、命中说明（类别 · 位置，最多 3 处）、询价编号、城市级目的地、发出邮件复查；新增 `src/lib/bid-workflow/__tests__/project-identity-deny.test.ts`（含不误判样例与源码断言：不读环境变量、不引用模型客户端），同一步注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/bid-workflow/__tests__/project-identity-deny.test.ts` 全部通过，`bash scripts/check-test-registry.sh` 通过
- [x] 1.2 新增 `src/lib/bid-workflow/project-identity-sources.ts`（只读：项目字段、组织代码与时区、询价设置里的两个邮箱、当前可用分析的五个关键事实槽，`factId` 槽批量查）；verify：任务 3.1 的隔离库测试里，联邦标夹具读出的清单含 spec「派生的词条」场景列出的全部词条

## 2. 询价单与三个入口

- [x] 2.1 `build.ts`：必填 `identity` 入参，`RfqDocument` 去掉 `projectName`、加 `reference`，标题与介绍句改用询价编号，目的地按 D6，敏感词之后做身份扫描并返回 `IDENTITY_LEAK`；`build.test.ts` 原有用例改用新标题并补 spec 中 build 相关的场景；verify：新增的身份用例先在改前代码上跑一次并失败（先红），改后 `npx tsx src/lib/tender-rfq/__tests__/build.test.ts` 全部通过
- [x] 2.2 `service.ts`（读来源、传清单、渲染后逐家复查、载荷写 `identityGuard: 1`、新错误码）、`types.ts`、`web-entry.ts` / `web-entry-pure.ts`（`identity_leak` 原因与文案、`IDENTITY_LEAK` 转人话含人工栏目的说法）、`rounds/route.ts`（422）、`auto-draft-pure.ts` / `auto-draft-service.ts`（`IDENTITY_LEAK` 原因、送审返回的这个码原样映射）；verify：`npx tsx src/lib/tender-rfq/__tests__/web-entry-pure.test.ts` 与 `npx tsx src/lib/tender-rfq/__tests__/auto-draft-pure.test.ts` 通过（含八种原因优先级与新文案），`npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts` 不改断言即通过

## 3. 发送前复核与端到端

- [x] 3.1 `execute.ts`：哈希比对之后、发第一封之前按 D9 复核（无标记 → `RFQ_IDENTITY_UNGUARDED`；重扫命中 → `RFQ_IDENTITY_LEAK`，零发信、询价项状态不动）；新增 `src/lib/tender-rfq/__tests__/supplier-identity-guard-db.isolated.test.ts`（联邦标夹具经网页送审的标题与正文、要求含采购方 → 422 零轮次零卡、两轮同编号、两种拒发且假发信函数 0 次）并注册进 `scripts/test-all.sh`；`stage-auto-db.isolated.test.ts`、`followup-auto-db.isolated.test.ts` 构造的载荷补标记；verify：三个隔离库测试在本机隔离库全部通过（实施记录：`followup-auto-db` 不执行发询价卡，不需要补标记、未改；`supplier-groups-db` 有一条比较两个同名项目的邮件逐字相同，改为先把各自的询价编号换成同一占位再比）

## 4. 供应商侧生成文件

- [x] 4.1 `tender-doc-html.ts`（`audience` 与对外抬头）、`generate-docs.ts`（供应商侧三类不再拼 `ctx` / 项目名 / 描述，生成前整份扫描）、`china-supplier-brief.ts`（去掉三行、事实整行不收、编辑备注命中抛错；`SENSITIVE_PATTERNS` 与 `assertNoForbiddenLeak` 不改）、`generate-pdf/route.ts`（身份命中 422）；`tender-doc-html.test.ts` 加对外抬头、内部备忘录照旧、改前抬头夹具（先在改前代码上生成并存为夹具）被拦三类、旧路径源码断言；`china-supplier-brief.test.ts` 按新取材改写并注册进 `scripts/test-all.sh`、从 `ci/test-registry-baseline.txt` 删掉；verify：`npx tsx src/lib/projects/generate/__tests__/tender-doc-html.test.ts`、`npx tsx src/lib/bid-workflow/__tests__/china-supplier-brief.test.ts`、`npx tsx src/lib/pdf/__tests__/cjk-pdf.test.ts` 通过，`bash scripts/check-test-registry.sh` 通过

## 5. 全量门禁与实测

- [ ] 5.1 全量门禁与真实标包实测：`npm test`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate rfq-supplier-identity-guard --strict`；`git diff --stat main -- prisma/schema.prisma vercel.json` 为空；用联邦 TBS 24062-27-057 与一个 Alberta 标包（本机或 staging）各起草一次询价并生成一次「供应商询价与符合性确认表」，记下标题、正文与文件里有无编号 / 采购方 / 截标日期，以及整单失败的次数与命中类别（design Q7 的依据）；verify：命令输出与实测记录写进报告
- [ ] 5.2 写 `docs/QINGYAN_CHAIN-4b_REPORT.md`（基线与结束时的测试数、实测记录、已知限制、Q1–Q7 拍板结果）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`「Phase F（续）— 情报串联」CHAIN-4b 状态列；verify：两个文件在 PR diff 里

## Workflow follow-up

- `/opsx:verify rfq-supplier-identity-guard` → 开 PR（一个 change = 一个 PR）。
- PR 合并后 `/opsx:archive rfq-supplier-identity-guard --yes`（独立小 PR），同步 TASKFLOW 状态列；之后才开 CHAIN-0 第 7 项的三个询价开关。
