# FIX-8 报告：报价表助手保存不再冲掉报价引擎镜像的我方报价

| 项 | 值 |
|---|---|
| change | `pricing-helper-save-keeps-bid-mirror`（归档 `2026-11-15-pricing-helper-save-keeps-bid-mirror`） |
| TASKFLOW | FIX-8（Phase F 续） |
| 来源 | Lucas 2026-11-15 任务：报价表助手 save 整块替换 `pricingInputs` |
| PR | LucasJ880/-#478（2026-11-15 合并）；归档 LucasJ880/-#479（2026-11-15 合并） |
| 分支 | `claude/lucid-cray-kndw66`（从 main 开，直接指向 main） |
| 性质 | 修一个既有的错。零 schema、零模型调用、没有新增出站。**没有开关——合并即生效** |

## 1. 问题

`POST /api/projects/{id}/pricing-helper` 的 `action: "save"` 拼出三项人工输入（竞品价、我方成本、目标毛利）后，把 `BidIntelligenceRoom.summaryJson.pricingInputs` 整块换掉。可报价引擎（`src/lib/quote-engine/tender-bid.ts` 的 `writeBidMirrorsTx` / `clearRoomPriceMirrorsTx`）把权威报价也镜像在同一个对象里：`ourPriceCad`、`ourPrice`、`ourPriceCurrency`、`ourPriceSource`、`ourPriceStatus`、`ourPriceSupersededSource`。投标草稿（`src/lib/tender-bid-draft/gather.ts`）从这里读「我方报价」。

结果：报价表卡片上每保存一次，镜像的我方报价就没了，直到下一次报价同步；这期间投标草稿里没有我方报价，「改价待定」的状态也丢掉。

## 2. 做了什么

1. 保存时先展开原来的 `pricingInputs`，再只覆盖三项人工输入（`{ ...原 pricingInputs, ...inputs }`）；原值不是对象时当空对象。之后 FLOW-H2（#476）加的成本来源 `ourCostSource` 也走这条路，按本次结果设或去掉。
2. 返回形状不变：`inputs` 仍只有三项人工输入；GET 不变。
3. 新增隔离库测试 `src/lib/tender-pricing/__tests__/pricing-helper-save-db.isolated.test.ts`（17 项）：用报价引擎自己的 `writeBidMirrorsTx` / `writePendingMirrorsTx` 镜像报价，再调真实路由保存。

## 3. 需要你知道的取舍

- **选了「展开原对象」而不是「白名单保留报价引擎那六个键」**：以后谁再往这个对象里加键，白名单会再删一次。
- **并发没在这一项里修**：保存仍是不加锁的读改写，报价同步恰好落在读写之间时，保存会把旧报价写回。当时写进 design.md 的 Risks，随后由 FIX-9（`pricing-helper-write-lock`，#483）修掉。
- 已经被删掉镜像的房间不补：下一次报价同步（选标、改价、取消）时恢复，与改动前相同。

## 4. 与八条硬纪律的关系

| 纪律 | 情况 |
|---|---|
| 零 schema | 没有 schema 变更；仍写既有 JSON 位 |
| 出站先审批 | 没有新增出站 |
| 禁止第三套队列 | 不涉及 |
| 脱敏 | 不改 Muse 通道；保存的返回不带出报价引擎的键 |
| 不爬登录页 | 不涉及 |
| 邮箱分离 | 不涉及 |
| 确定性优先 | 不调模型 |
| 测试注册 | 新测试已注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` |

## 5. 验证

| 项 | 结果 |
|---|---|
| `pricing-helper-save-db.isolated.test.ts`（新，本地隔离库，CI 里跳过） | 17 项通过；在改动之前的代码上 5 项失败 |
| `pricing-helper.test.ts` | 13 项照旧通过 |
| `npm run typecheck` | 退出码 0 |
| `npm run lint:baseline` | PASS |
| `bash scripts/check-test-registry.sh` | OK |
| `openspec validate pricing-helper-save-keeps-bid-mirror --strict` | valid；`/opsx:verify` 无 CRITICAL / WARNING |
| `npm test`（本地隔离库） | 652/660；8 项失败与本次无关（7 项在 main 上同样失败，Autopilot A2-P0 单独重跑通过），见 FIX-9 报告 §5 的同一份清单 |
| PR CI（`validate-lint-typecheck-test-build`） | 通过 |

## 6. 没做的

- 保存与报价同步之间的并发：交给 FIX-9。
- 推导（`derive`）分支：本项不改（它不碰 `pricingInputs` 的内容，但同样是读改写，也在 FIX-9 里一起加锁）。
