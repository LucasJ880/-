# CHAIN-1b 报告 — Alberta 授标的人工录入（`award-manual-entry-alberta`）

| 项 | 值 |
|---|---|
| TASKFLOW | CHAIN-1b（Phase F（续）— 情报串联；CHAIN-1 前置核查不通过后的人工路线） |
| 起因 | `docs/QINGYAN_CHAIN-1_PRECHECK.md`：APC 对匿名程序化访问返回 Cloudflare 人机验证，CHAIN-1 不能自动读取；交接文档第四十四次更正：现有授标历史面板做不了 Alberta 人工录入 |
| 拍板 | Lucas 2026-11-20：「CHAIN-1：做 Alberta 授标的人工录入表单。来源标成人工录入、带 APC 公告链接、信任级为待复核，不进 SYSTEM_VERIFIED，不碰 APC 网站。单独开一个 change。」 |
| OpenSpec change | `openspec/changes/award-manual-entry-alberta/`（新能力 `tender/award-manual-entry`，13 条要求；修改 `tender/award-records`：新增 1 条） |
| 基线 | origin/main `91d928e4` |
| 开关 | 没有新开关：跟随授标情报开关 `T4_AWARD_INTELLIGENCE_SCHEMA_READY`（关时页面不显示表单，接口 409 且不访问授标表） |

## 1. 做了什么

「历史中标」页（`/projects/intelligence/awards`）新增可展开的「录入 Alberta 授标（APC）」表单，接口 `POST /api/organizations/{组织}/tender-awards/manual`。

| 拍板的要求 | 怎么做的 |
|---|---|
| 来源标成人工录入 | `AwardRecordSource.sourceType = "USER_ENTRY"`，来源键 `manual:apc:` + sha256(规整链接 + 中标方规整名) 前 32 位（同一公告的同一中标方只算一次）；列表在中标方下写「人工录入 · APC 公告 ↗」 |
| 带 APC 公告链接 | 必填；只认 `https://purchasing.alberta.ca/posting/AB-年份-编号`（按 Lucas 2026-11-20 给的样例 `AB-2026-07664`；编号 4–6 位；拒端口、用户名密码、别的主机与别的路径）；统一存成一种写法（编号大写、去掉 `?` 与 `#`），同一条公告只有一个来源键；列表里是原生新窗口链接，复核的人自己点开 |
| 信任级为待复核 | `verificationStatus = "NEEDS_REVIEW"`、可信度中、不挂项目；组织管理员用既有「确认属实 / 撤回」处理，确认后为 `HUMAN_CONFIRMED` |
| 不进 SYSTEM_VERIFIED | 接口写死 `NEEDS_REVIEW`；挂到既有记录时那条的内容与信任级不变（隔离库核对 CanadaBuys 的仍是 `SYSTEM_VERIFIED`、AI 提取的仍是 `AI_EXTRACTED`）；没有改 `SYSTEM_VERIFIED` 的白名单（判断点 2 的授权仍未用上） |
| 不碰 APC 网站 | 录入、校验、列表都不发请求；源码断言四个新文件没有网络调用；隔离库全程替换 `globalThis.fetch` 计数为 0；本次开发与审查也没有访问任何 Alberta 网站 |

其余：

- **谁能录入**：本组织组织角色不低于 `org_member` 的有效成员（查看者不行），平台超级管理员按既有规则；复核仍只限组织管理员。
- **重复**：同一公告同一中标方再录 → 「已经录过了」，不新建、不写审计；两次同时提交 → 一条记录、两次都 200（P2002 重读）；被撤回过的可以重录（确定性后继键 `{键}:after:{撤回记录 id}`，与项目结果回灌同一做法）。
- **挂到既有**：同编号同中标方；或编号没对上而中标方、授标日期、金额都相同——**两边都有编号且不同时不挂、新记录标为疑似重复等组织管理员裁决**（Lucas 2026-11-20 GATE「收紧」；改了 `awards.ts` 的匹配，对所有写入方生效，主规格 `tender/award-records` 新增一条）→ 把来源挂上去，结果那句写明「那条记录原有的内容和可信度不变（你这次填的没有写进去）」。疑似重复照既有规则等组织管理员裁决。
- **审计**：新建、疑似重复、挂到既有在同一事务里写 `tender.award_manual_entry`（结果、提交的全部字段、链接、信任级，挂到既有时另记那条的信任级）。
- **表单**：分「公告信息」「这个中标方」两组；录完一条保留公告信息、只清空中标方与金额（一条公告常有几个中标方）；采购方候选（调用人看得到的、已分派的本组织招标项目 + 已有授标的写法，按规整名去重）与范围摘要候选；四句提示（采购方怎么写才对得上、编号建议填、金额填这个中标方自己的、范围写一句能反复用的）；错误指向那一格；刚录的那行高亮，被筛选挡住时照实说。
- **统计条**：「AI 待确认」改为「待确认（AI 提取 / 人工录入，不计入统计）」，「待复核（不计入统计）」（只数疑似重复）改为「疑似重复待裁决（不计入统计）」；组织管理员提示与空状态提到人工录入。

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/tender-intel/award-manual-entry.ts`（新） | 校验与规整、结果说法、固定文字（页面也用，不依赖 node 模块） |
| `src/lib/tender-intel/award-manual-entry-key.ts`（新） | 来源键（服务端，`node:crypto`） |
| `src/app/api/organizations/[orgId]/tender-awards/manual/route.ts`（新） | 录入接口：401 → 403 / 404 → 409 → 400（16 KB、边读边数、`{ error, code, field }`）→ 事务（写入服务 + 审计） |
| `src/components/tender-intel/award-manual-entry-form.tsx`（新） | 表单 |
| `src/app/api/org/tender-awards/route.ts` | 返回 `canEnterManual`、人工录入记录的 APC 链接（只认 `manual:apc:` 来源、再校验主机）、采购方候选 |
| `src/app/(main)/projects/intelligence/awards/page.tsx` | 表单、来源链接、范围摘要、统计条、提示、高亮 |
| 测试 | 新 `award-manual-entry.test.ts`（47）、隔离库 `award-manual-entry-db.isolated.test.ts`（21），都已注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` |

`src/lib/tender-intel/awards.ts` 只改一处：强匹配第二条路径（中标方 + 授标日期 + 金额）跳过两边编号都有且不同的记录（`isDistinctSolicitation`，与 P2-0c 同一个函数）；复核接口、项目里的授标历史面板、`award-intelligence.ts`、`sourcing-suggestions.ts`、`src/lib/tender-import-leads/**` 都没有改。

## 3. 测试

| 测试 | 结果 |
|---|---|
| `award-manual-entry.test.ts`（新） | 47 通过：每条校验与那句话（含 `1234,56` 拒、`$1,250,000.00` / 全角数字可以、1900 年以前拒、只写主机名补 `https://`）、出错带字段、来源键确定、五种结果、固定文字、提示说的匹配规则与 `normalizeBuyerName` 一致、源码没有网络调用、接线断言 |
| 隔离库 `award-manual-entry-db.isolated.test.ts`（新） | 21 通过（含成功响应 `record` 的形状、声明长度超限、平台超级管理员的采购方候选）：谁能录入（成员、超级管理员可以；查看者、别的组织的管理员 403；不存在的组织 404）；落库口径；重录；坏链接 / 坏日期 / 小数点逗号 / 17 KB / 不是 JSON 的 400 与字段；按编号挂到 CanadaBuys（仍 `SYSTEM_VERIFIED`）；按日期金额挂到 AI 提取的（仍 `AI_EXTRACTED`、来源 2 个）；编号不同（AB-2025-778 / AB-2025-777）而中标方日期金额相同：不挂上、新记录标为疑似重复指向那条；疑似重复；组织管理员确认成员的录入 → `HUMAN_CONFIRMED`；审计的条数与顺序；撤回后重录；并发；列表（链接只给人工录入的、采购方候选不带待分派与非招标项目、同一采购方的不同写法只留一个）；开关关 409；外部请求 0 |
| 既有：`awards.test.ts`、`award-semantics.test.ts`、隔离库 `award-dedupe-db` / `award-review-db` / `sourcing-suggestions-db` / `import-leads-db` | 33（新 T4-01h：同中标方同日期同金额，编号不同 → 新建；没编号或只差写法 → 挂上）/ 16 / 6 / 20 / 36 / 34 通过，不改期望 |
| 既有：`awards-db.test.ts`（「T4 授标情报真实 Postgres 矩阵」） | 16 / 18：T4-DB-08 / 09 的前置（库里没有调查室行）失败，把本次改动 stash 掉后同样失败，且在 main 的既有失败名单里 |

## 4. 门禁

| 项 | 结果 |
|---|---|
| `npm test`（本机，带隔离库） | 按 GATE 收紧与它的四维度审查修复之后（`2bb17259`）重跑：`704/714 通过, 10 失败`，10 项全是 main 上同样失败的既有项（跑之前删掉了测试库里 Mention Gateway M2-A 上次留下的那一行，它这次过了）；全量里授标相关的测试（含项目结果回灌、授标去重、授标复核、寻源建议、进口线索）都过。更早两次：`703/714`（11 项既有失败）、`704/714` |
| `npm run test:ci`（不带数据库，与 CI 相同） | PASS（注册校验：已注册 681 个，历史欠账 66 条；修复之后重跑） |
| `npm run typecheck` | 通过（修复之后重跑） |
| `npm run lint:baseline` | PASS（审查修复后一处 `prefer-const` 已改） |
| `openspec validate award-manual-entry-alberta --strict` | valid（两个能力共 14 条要求，都不超过 500 字） |
| `git diff origin/main -- prisma/ vercel.json` | 空 |

### 2026-11-23 合入 main `a8caa985` 后复跑（合并提交 `8aaf9676`）

合入的 main 含 FIX-12 / 13 / 17 / 21、CHAIN-4c / 2b / 3b / 3c 及各自归档、#544 RFQ-PDF-1（归档 #553）、BIDPAGE-1（#557）。无冲突自动合并：TASKFLOW 两边新增的行都在，`scripts/test-all.sh`、`scripts/test-ci-unit.sh` 两边的注册行都在。本分支改的源文件（`awards.ts`、`api/org/tender-awards/route.ts`、「历史中标」页与四个新文件）main 在分叉后都没有改过；本分支用到的模块（`auth/guards`、`audit/logger`、`projects/visibility`、`corporate-memory/normalize`、`award-flags`、`award-intelligence`、`api-fetch`、`intel-hub-shell`）main 也没有改过。main 新增的 CHAIN-3b / 3c 只读 `ACTIVE` 且有证据的授标中标方（`loadProjectWinners`），本分支「编号不同不挂上、新记录标为疑似重复」写出的是 `NEEDS_REVIEW`，不进那个读法；它们测试里直接建的 `USER_ENTRY` 来源键是 `adv:` / `manual:rc-`，不是 `manual:apc:`，列表不会给它们 APC 链接。本分支没有新增或改动 `src/app/api/projects/[id]/**`，FIX-21 目录守卫无需登记。

| 项 | 结果 |
|---|---|
| 本 change 单跑（隔离库 `qy_iso_b`，迁移已是最新） | `award-manual-entry.test.ts` 47 / 47；`award-manual-entry-db.isolated.test.ts` 21 / 21；`awards.test.ts` 33；`award-semantics.test.ts` 16；`award-dedupe-db` 6；`award-review-db` 20；`sourcing-suggestions-db` 36；`import-leads-db` 69；main 新增的 `alias-decisions-db` 39、`readiness-count-db` 19；`outcome-winner-db` 18；`org-profiles.test.ts` 30，全部通过 |
| FIX-21 目录守卫 `project-routes-guard.test.ts` | 98 通过、0 失败（本分支不改 `src/app/api/projects/[id]/**`） |
| `npm test`（新库 `qy_full_chain1b`，`migrate deploy`） | `720/730 通过, 10 失败`，10 项与既有失败名单逐条相同：来信观察 DB、Sunny 工艺单 DB、Phase3A-3 Approvals、Phase3A-4 Governance、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview、T4 授标情报真实 Postgres 矩阵（仍是 T4-DB-08 / 09 的前置，16 / 18）、客户报价 PDF 分页布局、招标询价自动起草 DB；Supplier Intel S1 审计脊柱 DB 这次通过 |
| `npm run test:ci`（不带数据库，与 CI 相同） | PASS（注册校验：已注册 696 个，历史欠账 66 条） |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（errors 38，基线 53） |
| `bash scripts/check-test-registry.sh` | 通过（已注册 696 个，欠账 66 条） |
| `bash scripts/test-runtime-architecture.sh` | PASS（9 / 9） |
| `openspec validate award-manual-entry-alberta --strict` | valid |
| `git diff origin/main -- prisma/ vercel.json package.json package-lock.json` | 空 |

### 2026-11-23 交叉验证修订后复跑（修订提交 `c9214776`，分支已含协调会话合入的 main `b717427f`）

| 项 | 结果 |
|---|---|
| 本 change 与相关测试单跑（隔离库 `qy_iso_b`，迁移已是最新） | `award-manual-entry.test.ts` 47 / 47；`award-manual-entry-db.isolated.test.ts` 30 / 30（原 21）；`awards.test.ts` 35 / 35（原 33）；`award-semantics` 16；`award-dedupe-db` 6；`award-review-db` 20；`outcome-winner-db` 18；`sourcing-suggestions-db` 36；`org-profiles` 30；`import-leads-db` 69；`alias-decisions-db` 39；`readiness-count-db` 19；`tender-result.test.ts` 17，全部通过；`awards-db.test.ts` 16 / 18（T4-DB-08 / 09 前置，既有） |
| 改前失败、改后通过 | 去掉 `awards.ts` 与 `own-result-backfill.ts` 的修订：隔离库 F1 两条失败（28 / 30），`awards.test.ts` T4-01i、T4-01j 失败（33 / 35） |
| 审查员的变异（`mutate.py`，22 个：匹配收紧、信任级、判定顺序 ×3、组织隔离 ×2、APC 校验 ×3、撤回上限 ×2、同一事务、开关、P2002 重读、`canEnterManual`、采购方候选 ×2、列表链接、后继键） | 22 / 22 被抓住；其中判定顺序、主机、撤回上限、同一事务、P2002 重读、跨组织候选、列表链接现在都有隔离库行为测试抓住（以前只靠源码断言或没抓住） |
| FIX-21 目录守卫 | 98 通过、0 失败（本分支不改 `src/app/api/projects/[id]/**`） |
| `npm test`（`qy_full_chain1b` 删掉重建、`migrate deploy`） | `719/730 通过, 11 失败`：10 项与既有失败名单逐条相同；多出的 1 项是「网站询盘异步入站 DB 端到端」的「两个并发认领 → 恰一个 claimed」（得到 `not_rerunnable`），是并发计时断言，本分支没有改 `src/lib/trade/**` 与网站询盘的任何文件；同一库单独重跑 3 次都是 58 / 58 通过 |
| `npm run test:ci`（不带数据库，与 CI 相同） | PASS（`awards.test.ts` 35、`award-manual-entry.test.ts` 47；隔离库用例按设计跳过；注册校验已注册 696 个、欠账 66 条） |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（errors 38，基线 53） |
| `bash scripts/check-test-registry.sh` | 通过（已注册 696 个，欠账 66 条） |
| `bash scripts/test-runtime-architecture.sh` | PASS（9 / 9） |
| `openspec validate award-manual-entry-alberta --strict` | valid |
| 归档演练（临时工作区 `openspec archive --yes`） | `tender/award-manual-entry` 新建（13 条）、`tender/award-records` + 2 条 ~ 1 条；归档后 `openspec validate --specs --strict` 152 / 152 → 153 / 153，不新增失败；每条要求 ≤ 500 字（最长 476，「落库口径」） |
| `git diff origin/main -- prisma/ vercel.json package.json package-lock.json` | 空 |

## 5. 多维审查

**开工前（一个子 agent，只给四件套与代码）**——逐条核实后全部并入四件套（`5d46fb2e`）：

| 意见 | 处理 |
|---|---|
| 被撤回的记录挡住重录（写入服务的幂等不看状态） | **已改**：确定性后继键（与 `own-result-backfill.ts` 同一做法），新增要求与场景 |
| Context 说 CHAIN-2 / 3 不看信任级，不对 | **已改**：它们只认 `ACTIVE` 且人工确认或权威的记录；表单写明确认后才计入 |
| 强匹配还有「中标方 + 日期 + 金额」一条路径 | **已改**：两种挂到既有分开说；审计记全部提交值与那条的信任级 |
| 双击提交撞唯一约束 | **已改**：P2002 重读；按钮禁用 |
| 链接：端口、先规整再判、长度、query 与大小写 | **已改** |
| 日期往返（`2023-02-29`） | **已改** |
| 统计条「AI 待确认」会把人工录入算进去；页面名是「历史中标」 | **已改** |
| 列表里的链接只给人工录入的 `manual:apc:` 来源、再校验主机 | **已改** |
| 采购方候选（照项目写法才对得上） | **已加** |
| 其余（409 文字、先鉴权再看开关、超级管理员 + 不存在的组织、请求字段、400 形状、回归用例清单、风险） | **已改** |

**实现后（四个维度；起初派了三个子 agent，其中一个同时审安全与规格一致性，不合「每个子 agent 只管一个维度」，开 PR 后补派一个只审规格—代码—测试一致性的，见表末）**——逐条核实后（`e6d35429`、`d8ff9c11`）：

| 维度 | 意见 | 处理 |
|---|---|---|
| 正确性与回归 | 「按日期金额挂到既有」也会挂上编号与采购方都不同的记录，规格却写「没有编号时」（已用假客户端复现） | **规格照实写**（编号没对上就看中标方、日期、金额，不看编号与采购方），加隔离库场景；结果那句写明那条的编号与采购方不变；要不要在 `awards.ts` 里收紧留给 Evan（§6 第 1 条） |
| | 逗号全删，`1234,56` 变成 123456（法语键盘的小数点） | **已修**：逗号只认千分位 |
| | 采购方候选的项目查询绕过项目可见性、不限招标项目 | **已修**：`buildProjectVisibilityWhere` + `workDomain = "tender"`；隔离库加待分派与非招标项目 |
| | 招标编号区分大小写（既有）；日期没有下限；数字字段被静默丢掉；`distinct` 在内存里做；撤回 10 次后裸 500；表单不按组织换、`orgId` 没编码、重录也清空；没声明长度的请求体整个读进来 | **已修**（大小写列入已知限制，表单不替人改） |
| 安全 / 隐私 / 硬纪律 + 规格一致性 | 没有越权、跨组织、XSS、外部请求、模型调用、schema 改动；落不进 `SYSTEM_VERIFIED` | — |
| | 采购方候选越权可见（同上） | **已修** |
| | 规格说「不晚于今天」，代码放行 UTC 明天 | **规格照实写**（留一天时区余量） |
| | 规格没覆盖的对外行为：16 KB、400 形状与各 code、判定顺序、四句超长文字、成功响应形状、`manualApcUrl` 取最早一条、`buyerSuggestions` 规则、404 文字、千分位、币种大小写、`:443`、开关关不显示表单、表单兜底文字与按钮 | **已补**：规格从 8 条改为 12 条（新增「表单的说明」「请求有误时的回答」「录入表单」「采购方候选」） |
| | 挂到既有的测试目标是人工确认，「不变」平凡成立 | **已修**：目标改为 AI 提取的记录，断言仍是 `AI_EXTRACTED`、来源 2 个 |
| | 场景说确认成员的录入，测试确认的是超级管理员那条；审计没断言条数；「原来的」变更语气；表单说明「组织管理员确认后才计入」不总成立（项目里人工确认同编号同中标方会直接提升）；强匹配优先；proposal Impact 漏两个文件；tasks 漏 `award-semantics` | **已改** |
| | 组织管理员可以录入后自己确认 | 不改：与既有「项目里人工确认」一致，写进 Risks |
| 使用流畅与文案 | 录完一条公告级字段全清空，连续录多个中标方很费事 | **已修**：保留公告信息、只清中标方与金额、焦点回中标方；「换一条公告（清空）」；字段分两组 |
| | 多中标方的金额没有说明、`$` 与全角逗号被拒、范围提示照做也对不上、采购方提示前后矛盾、编号留空会被当疑似重复 | **已修**：四句提示重写；金额接受 `$`、全角 |
| | 说明「系统不会打开这个链接」易误解、「历史中标者」是别处的词；挂到既有时没说填的内容没写进去 | **已修** |
| | 统计条两项用词冲突；管理员提示与空状态没提人工录入 | **已修** |
| | 入口像小标题、刚录的行找不到、读屏不播报结果、错误不指向字段 | **已修** |
| | 403 显示角色代码、日期没有 `max`、补 `https://`、成功句带中标方名、提示放进 label、币种没填金额也可选、外链提示 | **已修** |
| | 「买家」与「采购方」同页不统一 | 不改：「买家」遍布本页既有统计与画像，只改表单附近会更不一致（design D6 备选 C） |
| | 管理员复核看不到录入人与录入时间、没有「只看待确认」筛选；同一公告同一中标方多个标段只能合成一条 | 范围摘要已显示；其余列为后续 |

**补派：规格—代码—测试一致性（一个子 agent，只审这一个维度）**——逐条核实后：

| 意见 | 处理 |
|---|---|
| 平台超级管理员的可见性条件为空，采购方候选会带出待分派项目的客户名，违反规格的 SHALL NOT（阻塞） | **已修**：候选另排除 `intakeStatus = pending_dispatch`；隔离库加平台超级管理员的用例 |
| 规格写「撤回超过 10 次后」，代码是撤回满 10 次后就 409 | **规格照实写**「满 10 次」；单测断言常量与循环 |
| 规格说其余失败写兜底句，表单其实显示接口返回的那句话 | **规格照实写**（403 换白话、接口没有说明时才用兜底句） |
| 规格没写五种 `outcome`、400 的各个 `code`、409 的 `RETRACTED_TOO_MANY`、列表字段 `manualApcUrl` | **已补** |
| 「表单」与「说明逐字」场景的 THEN 没断言全（两组、成功句、按钮文字、兜底句、币种不可选、收起 / 展开）；成功响应的 `record` 形状没有测试 | **已补**：单测 43 → 47、隔离库 18 → 21 |
| 1899 年与小数点逗号的那句话、404 文字、声明长度超限、「审计」场景漏了超级管理员那次、c6b 的审计与信任级、几句固定文字的值没有断言；design 一处「历史授标」 | **已补 / 已改** |

**按 GATE 收紧之后（四个子 agent，各审一个维度，只看这次改动）**——逐条核实后：

| 维度 | 意见 | 处理 |
|---|---|---|
| 正确性与回归 | 同一笔授标常有两套编号（开放数据把 `referenceNumber` 存成招标编号；项目结果回灌用项目自己的编号），收紧后会写成两条都计入统计的记录，没有疑似重复提示（已复现：authoritative 1 → 2） | **已修**：不挂上时新记录标为疑似重复、指向那条（design D8 备选 D 写明为什么不直接 `ACTIVE`） |
| | 同采购方、编号不同的情况没有测试 | **已补**（T4-01h 加同采购方一支） |
| | `take: 10` 没有排序（既有）；APC 编号前导零不规整；不带 https 的 `:443` 写法被拒 | 不改：前两项列入已知限制，第三项无害 |
| 安全 / 隐私 / 硬纪律 | 同上「两套编号算两次」 | **已修**（同上） |
| | 37 种 URL 绕过输入都被拒或收敛；没有出站、没有预取；信任级与组织隔离不变 | — |
| 规格—代码—测试一致性 | **阻塞**：「审计」场景还写着两次按日期金额挂到既有 | **已改** |
| | 坏链接的测试多用旧的 `/x` 路径，http / 端口 / 用户名密码 / 末尾带点几项没有被单独测到；design D6 / D5 / Context、proposal、TASKFLOW、报告几处还是旧说法 | **已补 / 已改** |
| 使用流畅与文案 | 招标编号提示叫人填 AB 编号，和收紧互相矛盾（填了反而对不上） | **已改**：照公告原样填、找不到留空、不要填 AB 编号 |
| | 链接格子没有提示去哪复制；报错只给样子 | **已改**：加提示，报错写明「这不是一条 APC 公告的链接……搜索结果页、附件链接都不行」 |
| | 占位像已填好的值；「采购机构」与「采购方」混用；编号只差写法时结果说成按日期金额 | **已改** |
| | 不挂上时用户只看到「已录入」 | **已改**：现在结果是「已录入；和已有的一条记录可能重复，等组织管理员裁决。」 |

## 6. 留给 GATE 的问题（Lucas 2026-11-20 已答三条；第 1 条里的「疑似重复」Evan 2026-11-22 已答）

1. **按日期金额挂到既有不看编号**——**收紧**：已做（design D8，主规格 `tender/award-records` 新增一条；对所有写入方生效）。收紧后多维审查三个维度都指出：同一笔授标常有两套编号（开放数据参考号与项目自己的招标编号），直接各写一条 `ACTIVE` 会算两次、没有提示；所以不挂上时新记录标为**疑似重复**（指向那条），由组织管理员在「历史中标」页裁决一次。这是我在「收紧」之内的选择；**Evan 2026-11-22 已答：同意**——挂不上既有记录时新记录标为疑似重复，由组织管理员确认。代码不变。
2. **APC 公告链接要不要收紧**——Lucas 给了样例 `https://purchasing.alberta.ca/posting/AB-2026-07664`：已收紧为只认 `/posting/AB-年份-编号`（编号 4–6 位），统一一种写法。招标编号的提示改为照公告原样填、找不到就留空、不要填链接里的 AB-… 编号（填了和已有记录对不上会变成疑似重复）；链接格子加了一句去哪复制的提示。没有打开这个链接，也没有访问 APC。
3. 组织管理员可以录入后自己确认（没有职责分离）——Lucas 2026-11-20：**不要限制**，照旧。

## 7. 已知限制

- 招标编号区分大小写（写入服务既有规则）：手打的 `ab-1` 与 CanadaBuys 的 `AB-1` 对不上。
- 项目里有人按编号人工确认了同一条授标时，写入服务会把这条人工录入直接提升为人工确认，不经组织管理员（既有规则）；表单说明写「经人工确认属实后才计入（一般由组织管理员在下表确认）」。（2026-11-23 起：这条若是疑似重复，只升信任级、状态不变，仍由组织管理员裁决，见 §8 F1。）
- 只做 Alberta APC；批量导入与其它省份另立 change。

## 8. 2026-11-23 交叉验证后修订

交叉验证结论：可以合并、没有阻断项；有一条相对 main 的回归（F1）与一处规格矛盾（F2），协调会话定为合并前修，另有 F3、F4。修订提交 `c9214776`。

| 编号 | 问题 | 去向 |
|---|---|---|
| F1（中，回归） | 疑似重复会被既有的「提升」路径悄悄转正：CanadaBuys 记录 E（编号 S1）→ 人工录入 N（编号 S2，中标方日期金额同 E，成为疑似重复）→ 再以人工确认写入编号 S2（项目里的授标历史确认、项目结果回灌）→ N 变为 `ACTIVE + HUMAN_CONFIRMED`，`possibleDuplicateOfId` 仍指向 E，同一笔算两次，待裁决里看不到 | **已修**（协调会话定的做法）：`awards.ts` 挂到既有时，目标是 `NEEDS_REVIEW` 且带 `possibleDuplicateOfId` → 只升信任级、挂来源，不改状态，仍待组织管理员裁决；对既有「同中标方同买家」的疑似重复同样生效。附带：`own-result-backfill.ts` 未中标回灌按记录状态给 `needs_review`，页面提示「与已有授标记录疑似重复，请在历史中标页核对」，不再说「会出现在竞争对手情报里」。规格：`tender/award-records` 新增「人工确认的写入不让疑似重复转正」，`tender/award-manual-entry`「落库口径」补例外与场景；design D9。测试：审查员的复现脚本变成隔离库三条（挂上后仍疑似重复、统计不变；回灌 `needs_review`；组织管理员确认后才计入）与 `awards.test.ts` T4-01j，改前失败、改后通过 |
| F2（规格矛盾） | 归档后「不同招标编号不判疑似重复」（同中标方同买家、编号不同 → `ACTIVE`）与新增的「同中标方同日期同金额、编号不同 → `NEEDS_REVIEW`」对「同买家、同日期、同金额、编号不同」结论相反 | **已改**：delta 改为 MODIFIED 那一条，写明例外（日期与金额也都相同时仍标为疑似重复），原有三个场景照留（第一个补「授标日期或金额与原记录不同」），另加一个例外场景；ADDED 两条（按日期金额挂到既有时不跨不同的编号、人工确认的写入不让疑似重复转正）。归档演练见 §4 |
| F3（测试） | P2002 重读、APC 主机校验、判定顺序（M3）、撤回上限（M6）、同一事务（M7）、跨组织候选（M11b）只靠源码断言或没被抓住 | **已补行为测试**：8 路同时提交（一条记录、一条审计、8 次都 200）；`www.alberta.ca`、`alberta.ca`、`notalberta.ca`、`evil.purchasing.alberta.ca` 等 7 种主机拒绝，列表里非 APC 主机的人工录入链接不给；开关关时未登录 401、查看者 403、不存在的组织 404 先于 409，坏链接也是 409；撤回 1–9 次后能重录、满 10 次 409 且不写库；事务在写完审计后被迫回滚（替换 `db.$transaction`）→ 记录与审计都不留；别的组织的招标项目不进采购方候选（成员与平台超级管理员）。审查员的 22 个变异全部被抓住。仍只靠源码断言的：「开关关时不访问授标表」（行为上只能看到不写库，读没有可见效果）、页面与表单的文字和接线（没有浏览器测试）；源码断言保留 |
| F4 | `awards.ts` 按日期金额找候选的 `take: 10` 没有排序，`possibleDuplicateOfId` 指向哪条不确定 | **已修**：`orderBy: [{ createdAt: "asc" }, { id: "asc" }]`（授标日期已在条件里取等，日期差都是 0），指向最早建档的那条；`awards.test.ts` T4-01i（假客户端照 `orderBy` 排、没给时按新到旧），改前失败、改后通过；规格「按日期金额挂到既有时不跨不同的招标编号」补「指向最早建档的一条」与场景 |

**独立复核（2026-11-23）后补的两个测试缺口**（只加测试、不改源码；同时合入 main `d94e4323`（#562 FIX-23），无冲突）：

| 变异 | 补的用例 | 改前（变异下） | 改后（还原） |
|---|---|---|---|
| M1c：F1 的判断缩窄成「只管有招标编号的疑似重复」（加 `&& !!target.solicitationNumber`） | `awards.test.ts` T4-01k：没有编号的「同中标方同买家」疑似重复被人工确认写入按日期金额挂上 → 仍 `NEEDS_REVIEW`、仍指向原记录、来源 2 条；隔离库 §6e：同样的疑似重复（人工录入两条、日期金额不同）**只**被项目结果回灌按日期金额挂上（回灌自己的提升分支：挂上前信任级还是 `NEEDS_REVIEW`）→ 信任级升为人工确认、状态仍疑似重复、来源 2 条、回灌结果 `needs_review` | `awards.test.ts` 35 / 36（T4-01k 失败）；隔离库 31 / 32（§6e 失败） | 36 / 36；32 / 32 |
| M8b：采购方候选里「已有授标」那半边去掉 `orgId` 过滤 | 隔离库 §9：别的组织有一条采购方写作 `Other Org Award Buyer {stamp}` 的授标 → 本组织成员与平台超级管理员的候选里都没有 | 隔离库 31 / 32 | 32 / 32 |

复跑（库 `qy_iso_b`）：`award-manual-entry.test.ts` 47 / 47、`awards.test.ts` 36 / 36、`award-manual-entry-db.isolated.test.ts` 32 / 32；`check-test-registry.sh` 通过（合入 FIX-23 后已注册 698 个、欠账 66 条）；`npm run typecheck` 通过；`npm run lint:baseline` PASS（errors 38，基线 53）；`npm run test:ci` PASS（`awards.test.ts` 36、`award-manual-entry.test.ts` 47，隔离库用例按设计跳过）；FIX-21 目录守卫 98 / 0。没有改源码，全量不重跑。

## 9. 合并后要人做的事

1. **确认生产上 `T4_AWARD_INTELLIGENCE_SCHEMA_READY` 开没开**（`docs/QINGYAN_CHAIN-0_ENV_CHECK.md` 第 4 项没有填实际值）。开着时，表单与接口、收紧的匹配（编号不同不再挂到一起、标为疑似重复）和 F1（疑似重复不被人工确认写入转正）**合并即对所有写入方生效**（CanadaBuys 观察、项目结果回灌、授标历史面板的确认、人工录入）；关着时页面不显示表单、接口 409，写入服务也不被调用。
2. **跑一次审查员给的只读查询**，看过去有多少条记录被不同的 CanadaBuys 参考号合并成了一条（同样的情况以后会成为疑似重复，等组织管理员裁决）：
   ```sql
   SELECT count(*) FROM "AwardRecord" r WHERE (SELECT count(DISTINCT s."sourceKey") FROM "AwardRecordSource" s WHERE s."awardRecordId"=r.id AND s."sourceType"='CANADABUYS_OPEN_DATA')>1;
   ```
   只读，不改数据；数字大时告诉组织管理员「历史中标」页的「疑似重复待裁决」会变多。
3. PR 合并后 `/opsx:archive award-manual-entry-alberta --yes`（独立小 PR）：`tender/award-manual-entry` 新建、`tender/award-records` 改一条加两条；TASKFLOW CHAIN-1b 改为 `[x]`。
