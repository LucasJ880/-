# FLOW-H5 报告：两道闸生效——No-Go 之后的提醒、未批准分析起草的标注

| 项 | 值 |
|---|---|
| change | `tender-decision-gates` |
| TASKFLOW | FLOW-H5（Phase F 续；方案 §7 的 H5，断点 G4、G5） |
| 来源 | 交接文档 §0.5d 第 3 项；方案 §9 第 6 条（推荐「只提醒」）；Lucas 2026-11-15「454已经合并，继续按照你推荐的做」 |
| 分支 | `claude/flow-h5-decision-gates`（从 main 开） |
| 性质 | 新功能，**只提醒，不拦**。开关 `TENDER_DECISION_GATES_ENABLED`（可配组织名单 `TENDER_DECISION_GATES_ORG_ALLOWLIST`），**默认关**。零 schema；没有新的模型调用（起草本身调模型，提示词不变）；没有对外动作 |

## 1. 问题

- **G4**：投标决定（工作台的「投 / 暂缓 / 不投」三个按钮，写在 `BidIntelligenceRoom.goDecision`）只是一条记录。定了不投之后，询价与投标文件起草照常可用，页面上什么都不说。
- **G5**：投标文件起草取最新的等待审核或已批准的分析，不按确认状态筛要求，也不记它用的是哪一份、批准了没有。基于还没批准的分析起草出来的草稿看不出来。

## 2. 做了什么

**No-Go 之后的提醒**（以情报室上的决定为准，记在这个项目的组织名下）：

- 询价入口（「问供应商要价」按钮旁与抽屉里）多一条不阻断的提醒：「投标决定是不投（No-Go，X 定的）：照常可以询价，请确认是否还要问供应商要价」。日期按组织时区。入口可用与否、原因、说明都不变。
- 「下一步」卡片指向询价时带上这一条（入口另外返回 `decisionNoGoZh`，卡片据此加，不靠匹配文字）。
- 投标文件起草卡片（工作台）与「标书与报价」页签生成菜单里的起草项，显示同类提醒。

**基于未批准分析起草的标注**：

- 起草前：当前分析还没批准时，卡片与生成菜单提示「当前分析还没批准，起草会基于未确认的要求」。
- 起草时：同一次取数拿到起草的输入与所用分析的标识、状态（状态不进模型的输入）。没批准的，草稿文件在 AI DRAFT 横幅下加一行「BASED ON UNCONFIRMED REQUIREMENTS …」；项目有情报室时，起草元信息里记下所用分析与是否已批准，卡片写明「这份草稿是基于还没批准的分析起草的」。
- 起草的那一段从 `generate-docs.ts` 原样移到 `src/lib/tender-bid-draft/generate.ts`，合成可以注入——测试用假的合成把整段走一遍。

## 3. 交付清单

| 位置 | 改动 |
|---|---|
| `src/lib/tender-decision-gates/gates.ts`（新） | 开关、No-Go 判断、文字、草稿横幅 |
| `src/lib/tender-rfq/web-entry.ts` | 开关开着、决定是 NO_GO 时多一条提醒，另外返回 `decisionNoGoZh` |
| `src/lib/tender-next-step/web-next-step.ts`、`service.ts` | 指向询价时带上那条提醒（`rfqEntryReasons` 导出供测试） |
| `src/lib/tender-bid-draft/gather.ts` | 新增 `gatherBidDraftInputsWithBasis`；原函数行为不变 |
| `src/lib/tender-bid-draft/generate.ts`（新）、`meta.ts`（新）、`render.ts`、`index.ts` | 起草整段（可注入合成）；元信息；横幅 |
| `src/lib/projects/generate/generate-docs.ts` | 起草分支改为调用 `buildBidDraftDocument` |
| `src/app/api/projects/[id]/bid-draft/route.ts` | 开关开着时多返回 `gates`（No-Go 提醒、当前分析是否已批准） |
| `src/components/tender/bid-draft-card.tsx`、`src/components/project-generate/project-generate-menu.tsx` | 显示提醒与标注 |
| `.env.example` | 新开关 |
| 两个测试（新） | 见 §4 |

## 4. 证据

**新测试**

| 测试 | 项数 | 内容 |
|---|---|---|
| `src/lib/tender-decision-gates/__tests__/decision-gates.test.tsx` | 27 | 文字、开关；草稿横幅（有 / 没有 / 转义 / 位置）；起草元信息（开关关时键与原来相同）；卡片提醒的呈现与位置；生成菜单；「下一步」卡片的理由；接线 |
| `src/lib/tender-decision-gates/__tests__/decision-gates-db.isolated.test.ts` | 21 | 真实路由 + 隔离库：开关关闭与原来相同；No-Go 的两处提醒（组织时区设成上海，核对日期按它算）、入口可用与否不变、单独返回给「下一步」；读取前后什么都没变；别的组织 403；改回 GO、HOLD、没决定、没情报室；情报室记在别的组织名下；名单；起草取数（所用分析、不进输入、换成已批准的新分析）；**起草整段（假的合成）**：开关开着时横幅与情报室元信息、开关关闭时都没有、分析已批准时没有横幅 |

隔离库测试在 main 上：第一版 15 项里 7 项失败后在取数处抛错（main 上没有 `gatherBidDraftInputsWithBasis`）。

**真实浏览器**（本机隔离库，`next dev`，开关开启；演示数据：决定是不投、分析等待审核）

| 截图 | 看到的 |
|---|---|
| `bid-draft-card.png` | 起草卡片：「投标决定是不投（No-Go，11 月 14 日定的）：照常可以起草…」与「当前分析还没批准，起草会基于未确认的要求」，起草按钮照常 |
| `rfq-entry.png` | 询价区「问供应商要价」旁的那条提醒 |

**既有测试**（不变地通过）：`bid-draft` 11、`b4-memory-gate-static` 17、`web-entry-pure` 151、`web-next-step` 141、`auto-draft-db.isolated` 76、`supplier-groups(-db)` 103 / 53、`tracking-notify-wiring` 67、`audience` 98、`cjk-pdf` 11、`rfi-export` 9、`memo-v2` 16、`analyst-memo-v1` 18、`tender-profile` 5。

**门禁**

| 门禁 | 结果 |
|---|---|
| `npm run test:ci` | `CI unit subset PASS`（本机，CI 的环境变量）。修复后第一次跑失败于既有的 `bid-draft.test.ts`「BD-07」：它断言生成文件从 `@/lib/tender-bid-draft` 动态引入，而起草那一段挪走后改成了从子路径引入；改回从包入口引入（`index.ts` 导出 `buildBidDraftDocument`）后通过，没有改那条测试 |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（无新增 error fingerprint） |
| `bash scripts/check-test-registry.sh` | OK |
| `bash scripts/test-runtime-architecture.sh` | PASS |
| `openspec validate tender-decision-gates --strict` | valid |

## 5. 独立审查

开 PR 前请了一个不带结论的独立审查（只给分支与四件套，它在自己的工作区里跑测试与 16 处变异）。没有高等级问题。处理：

| 编号 | 发现 | 处理 |
|---|---|---|
| M1 | design 说「下一步」卡片也会读到入口的提醒——不对，卡片只读可用与否与说明；No-Go 之后卡片照样说「去供应商询价」 | 修。入口另外返回 `decisionNoGoZh`，卡片指向询价时带上 |
| M2 | 「标书与报价」页签的生成菜单也能起草，那里没有任何提醒 | 修。起草项下面显示同样的提醒与「还没批准」的提示 |
| M3 | 起草之后的标注只有源码断言，spec 引用的隔离库测试其实没有起草；「开关开着却不写元信息」「开关关着也加横幅」两处变异存活 | 修。起草那一段移到 `tender-bid-draft/generate.ts`，合成可注入；隔离库测试用假的合成把整段走一遍（开关开、关、已批准） |
| L | 卡片提醒的位置只有源码断言（挪进「上一份草稿」那一块会让还没起草时看不到）；「按组织时区」没测到；两处查情报室的组织规则不同；proposal 写了「是谁定的」；没有情报室时不记元信息；`.env.example` 没有新开关；报告与截图 | 都修：断言收紧到那一行且只出现一次；组织时区设成上海核对；起草元信息接口也只认记在本组织名下的情报室；proposal 改正；spec 写明元信息记在情报室上；`.env.example` 补上；本报告与截图 |

## 6. 变异核对

修复之后 12 处变异（审查存活的 5 处 + 新改动的 7 处）：**全部被测试发现**。卡片提醒的位置、情报室的组织规则两处，是在第一轮存活后补了断言与场景才发现的。

脚本：`/tmp/claude-0/-home-user--/a7528e60-5f86-55e5-b1cc-747fa9fb90f5/scratchpad/h5mut.py`（会话临时目录，不入库）。

## 7. 已知限制

- **只提醒**：人可以无视。这是方案 §9 第 6 条推荐的取舍。
- **自动起草询价（RFQ-AUTO-2）在 No-Go 之后照样起草**（起草的卡要人批准）；**Muse 通道发起询价不加提醒**（Muse 口径不变）。
- **起草仍然不按确认状态筛要求**：已批准的分析里也可能有没确认的要求（批准时没勾「全部确认」），本次只按分析是否批准来标注。
- **没有情报室的项目**：草稿里有横幅，但不记元信息（元信息本来就写在情报室上）。
- **开关开着时询价入口多一次查询**。

## 8. 没做的

- 硬拦 No-Go 之后的询价与起草；改投标决定的写入；改起草的提示词与选要求的规则。

## 9. 上线

合并后照常 `vercel --prod`。默认关，线上无变化。要启用：设 `TENDER_DECISION_GATES_ENABLED=1`（可先用组织名单限定）——等 Owner 定。回滚 = 关开关；已写进起草元信息的标注留着，无人读取。
