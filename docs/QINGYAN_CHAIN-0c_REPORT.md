# CHAIN-0c 报告 — 招标分析失败立刻告诉人（`tender-job-failure-surfacing`）

| 项 | 值 |
|---|---|
| TASKFLOW | CHAIN-0c（Phase F（续）— 情报串联） |
| 任务书 | `docs/QINGYAN_CHAIN_TENDER_INTEL_CHAIN_TASKBRIEF.md`（2026-11-19 13:05 修订版） |
| OpenSpec change | `openspec/changes/tender-job-failure-surfacing/`（新能力 `tender/analysis-failure-surfacing`） |
| 基线 | main `a764c06`（CHAIN-4b 已合并并归档之后） |
| 拍板 | 判断点 8 取 A；design Q1–Q3 按推荐（Lucas 2026-11-19「全权负责……按照你推荐的去做」） |
| 开关 | 没有。合并即生效 |

## 1. 做了什么

| 场景 | 以前 | 现在 |
|---|---|---|
| 招投标 Job 被处理器写成「失败」 | 项目上的分析记录停在「AI 数字员工分析中」，没有通知 | 同一次处理器调用里把分析记录改为「AI 分析未完成」，原因「卡在第 N 步〈步骤名〉：〈原因〉」；发起人与项目负责人各一条站内通知 |
| 写成「需要人工处理」（判断点 8 A） | 同上 | 同上 |
| 租约超时且重试耗尽的清扫 | 同上 | 同上 |
| 通知摘要 | 只按错误码查表，Job 的错误码都落「分析未能完成」 | 「{项目}的 AI 分析已停止：卡在第 3 步〈…〉：…。可在项目里重新发起分析。」 |
| AI 任务详情「需要你处理」框（泛泛的「需要人工处理 / 未知」两类） | 没有说明 | 显示停在哪一步；连步骤都没有时「系统未记录原因」 |
| AI 任务详情（失败的 Job） | 没有原因卡 | 「任务未能完成」卡，写同一句 |
| 项目页「AI 数字员工 · 投标分析」卡片 | 「上次 AI 分析未完成」 | 下一行写原因；按钮仍是「重新分析」 |

原因只用确定性的中文：停在的那一步（第一个失败的，没有则第一个没完成的）+ 原因。原因先认招投标工具的已知标记（`ANALYSIS_EMPTY` → 模型调用全部失败，未产出有效分析；429 / rate limit → 模型调用被限流；timeout → 单次调用超时），再按错误码查表，都不认识写「执行出错」。不复述原始错误文本、英文堆栈、内部错误码（design D3，Q1）。详情页只按错误码，所以可能比项目卡片粗一档（「工具执行失败」vs「模型调用全部失败」）——读模型「不读错误原文」的既有纪律。

## 2. 复现段（任务书要求）

生产上「12-01 21C31-254242」那个 Job 的 AgentRun / 事件记录本会话看不到（没有生产库与 Vercel 日志权限）。代码里能确认的是：既有测试 `t1b-integration.test.ts` 的 T1B-11 就是同一条路径——**必需任务失败后 Job 停在 `needs_human`（执行器返回，事件标题「需要人工处理」、`humanRequirement.type = CONFLICT_REQUIRES_HUMAN`、无说明），分析记录停在 `AGENT_ANALYZING`**。这与事件现象（详情页出现「需要人工处理」框但没有原因、项目页一直「分析中」、没有通知）完全一致，所以最可能就是这条。本次把 T1B-11 的期望从「停在分析中」改为「AI 分析未完成，原因以『卡在第』开头」（这是本次要改的行为，不是回归）。

拿到生产记录后，把实际的 `errorCode` 与事件补到这里。第 3 步失败本身的原因（模型侧？限流？超时？）本次不修。

## 3. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/workforce-runtime/domain-hooks.ts`（新） | `onWorkforceJobStopped`：按 `workDomain` 动态加载域收尾（与 `scope.ts` 同一做法，避免成环）；整体 try/catch |
| `src/lib/workforce-runtime/processor.ts` | 每次认领处理完（心跳停止后）调用钩子，钩子按库里状态判断；清扫写 failed 后对每个 Job 调用 |
| `src/lib/workforce-runtime/read-model/stop-reason.ts`（新） | 停在哪一步、错误码 → 中文、整句拼装（域无关，不读 errorMessage） |
| `src/lib/workforce-runtime/read-model/{types,projection,service}.ts` | 步骤快照带 `errorCode`；视图 `stopReason`；needs_you 兜底只给「需要人工处理 / 未知」两类 |
| `src/lib/tender-workforce/job-failure-surfacing.ts`（新） | 招投标已知标记 + 收尾服务 `surfaceTenderJobStopped`（既有 `failWorkforceTenderAnalysisRun` → 改到了才写审计） |
| `src/lib/tender-auto-analysis/alerts.ts` | 摘要带「卡在第 N 步」；错误码表补 Job 码 |
| `src/lib/tender-workforce/trigger-service.ts`、`src/components/tender-analysis/agent-card.tsx` | 项目卡片的原因（用户主动取消的不给） |
| `src/app/(main)/workforce/[id]/page.tsx` | 「任务未能完成」卡 |
| 测试 | 新 `read-model/__tests__/stop-reason.test.ts`（22）、`tender-workforce/__tests__/job-failure-surfacing.test.ts`（27）、隔离库 `job-failure-surfacing-db.isolated.test.ts`（15），均已注册；改 `t1b-integration.test.ts` T1B-11 |

## 4. 测试（开工前 → 结束）

| 测试 | 开工前 | 结束 |
|---|---|---|
| `read-model/__tests__/stop-reason.test.ts`（新） | — | 22 |
| `tender-workforce/__tests__/job-failure-surfacing.test.ts`（新） | — | 27 |
| 隔离库 `job-failure-surfacing-db`（新） | — | 15 |
| `read-model` projection-golden / service-read-only / api-access / list-service | 74 / 37 / 13 / 36 | 74 / 40 / 13 / 36 |
| `operator-ux` | 95 | 95 |
| `tender-workforce` t1b-pure / t1b-integration / t5-seg2 / t5-seg3 / t5-p11 | 36 / 40 / 44 / 40 / 44 | 36 / 40（T1B-11 改期望）/ 44 / 40 / 44 |
| `tender-auto-analysis/alerts` | 30 | 30 |
| `workforce-runtime/__tests__` 23 个（含处理器、租约、清扫、并行、恢复） | — | 全过 |

## 5. 门禁

| 项 | 结果 |
|---|---|
| `npm test`（本机，带隔离库） | `692/704 通过, 12 失败`，逐项见下 |
| `npm run test:ci` | `CI unit subset PASS`（审查修正之后重跑） |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（无新增指纹） |
| 运行时架构守卫 | 全过（含 run status inventory 134、repo conformance 9） |
| `bash scripts/check-test-registry.sh` | 已注册 671 个，历史欠账 66 条 |
| `openspec validate tender-job-failure-surfacing --strict` | valid |
| `git diff origin/main -- prisma/ vercel.json` | 空 |

全量 12 项失败：
- **Tender T1B Workforce 集成**：全量是在改 T1B-11 期望之前开跑的；改后单独跑 40 / 40（本次要改的行为，见 §2）。
- **既有 / 环境**（与 CHAIN-4b 报告同一批，main 上同样失败）：来信观察 DB、Sunny 工艺单 DB、Phase3A-3 / 3A-4 Governance / 3A-4 Acceptance / 3A-5、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草 DB（75 / 76）。
- **Autopilot A2-P0**：与执行顺序有关（单独跑通过，CHAIN-4b 报告已记）。
- **Mention Gateway M2-A Identity DB**：唯一约束冲突，没改过的 main 上单独跑同样失败——是本会话早先并行跑测试留在隔离库里的数据，与本次无关。

## 5a. 交叉审查（独立代理，只给 diff 与规格）

8 条，已修 6 条：
1. **钩子只信处理器内存里的结果**：执行器 / 验证器自己写了终态后，若后面再抛错，处理器返回 `lost_lease`，钩子被跳过，而 Job 已不活跃、清扫也碰不到——会重现原问题。改为每次认领处理完都调钩子，由钩子读**库里的**状态判断（`domain-hooks.ts`）；钩子挪到心跳停止之后。
2. **每一步都完成时没有原因**（如验证器最后判 needs_human）：改为算在最后一步、原因按 Job 错误码。
3. **用户取消后卡片出现「系统未记录原因」**：卡片只在记有原因时显示那一行。
4. **已知标记误认**（「第 429 页」→ 限流、`Transaction … timeout` → 超时；还认了 Job 层的错误）：只认停住那一步自己的错误文本，模式收紧。
5. **needs_human 时卡片两句原因**：有 `failureReason` 时不再显示「需要你处理」的说明。
6. **发起人为空时审计被跳过**：改用项目负责人作审计主体。

另 2 条：补测试（每一步都完成、发起人为空、非招投标不发通知，隔离库 14 → 15、纯函数 22 → 27、读模型 21 → 22）；「钩子抛错不影响结果」仍是源码断言（钩子整体 try/catch、只记日志）。修正之后 workforce-runtime 23 个既有测试、读模型、operator-ux、t1b-integration 重跑全过。

## 6. 已知限制

- needs_human 收尾为「AI 分析未完成」后，若有人在 AI 任务详情里手动恢复这个 Job，Job 跑完时分析记录已不在「分析中」，第 9 步写不进去——判断点 8 A 的代价，处理方式是「重新发起分析」。
- 详情页原因比项目卡片粗一档（见 §1）。
- 已经卡在「分析中」的历史记录不回补（不加扫描，Q3）；用户点「重新分析」即可。
- 第 3 步失败本身的原因未查明。
