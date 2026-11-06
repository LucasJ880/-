# P2-0 报告：结果表单「中标方（选填）」+ 竞争对手域排除我方

| 项 | 值 |
|---|---|
| TASKFLOW | P2-0（Phase 2 标讯雷达的前置数据修补） |
| OpenSpec change | `openspec/changes/tender-outcome-winner/` |
| 来源 | `docs/QINGYAN_TENDER_INTEL_SLOTS_P1P2_REPORT.md` §5 遗留两条："Outcome 表单补「中标方（选填）」"、"我方组织名会出现在「竞争对手」域" |
| 分支 | `claude/tender-outcome-winner`（基于 main `05090b0`） |

## 1. 改了什么

- **结果表单**（`submission-tab.tsx`）：选「未中标」时出现「中标方（选填）」输入框（≤ 200 字）。保存后按接口返回说明结果：已进入竞争对手情报 / 本项目已记录过别的中标方（未覆盖）/ 授标情报未开启（已写进结果备注）/ 其他原因。
- **接口** `POST /api/projects/[id]/tender-result`：新增可选 `winnerName`。
  - `parseOutcomeWinner`（纯）：只在 `result=lost` 时接受，其他结果填了回 400；合并多余空白，空串视为未填；超过 200 字回 400。
  - 中标方与我方组织名按授标记录同一规范化相同时，回 400「未中标时，中标方不能填我方组织」，项目状态不变。
  - 响应新增 `winner: { name, recorded, reason }`；审计 afterData 记 `winnerName`。
- **保存**（`tender-result.ts` + `own-result-backfill.ts`）：
  - 结果备注追加 `[中标方 YYYY-MM-DD] 名称`（授标情报关闭时也不会丢）。
  - 授标情报开启时，走既有人工确认写路径 `materializeWinnerConfirmation`：`HUMAN_CONFIRMED` / `USER_ENTRY` / 幂等键 `tender-result-winner:{projectId}` / confidence `MEDIUM`，带买家、招标编号、中标价与币种。
  - 每项目一条：同名（大小写 / 标点不同）再标记幂等；换名不覆盖，原因 `winner_already_recorded`；未填中标方 → `lost_without_winner`，不写对手事实；开关关闭 → `t4_schema_not_ready`。
- **投影**（`award-intelligence.ts`）：`deriveAwardIntelligence(rows, { ownWinnerNames })` 把我方中标从「竞争对手」的已确认与线索两处排除，新增 `competitorSignals.ownAwardCount`。不传时与改动前完全一致；历史授标与买家中标方列表不变（语义为中标方，含我方）。
- `/api/org/tender-awards` 传入组织名；「历史中标」页在有排除时显示"已排除我方自己的中标记录 N 条"。

不变：我方中标回灌（`own-result:{projectId}`）、买家入 T3、复盘草稿生成；没有 schema 变更、没有出站、没有 LLM 调用、没有新队列。授标事实只来自用户在结果表单的人工动作。

## 2. 测试与门禁（实际运行）

| 检查 | 结果 |
|---|---|
| `npx tsx src/lib/projects/__tests__/tender-result.test.ts`（新增 `parseOutcomeWinner` / `isOwnOrgWinner` 10 例） | 17 passed |
| `npx tsx src/lib/tender-intel/__tests__/award-semantics.test.ts`（新增 SEM-T4-09a–d） | 16 passed |
| `npx tsx src/lib/tender-intel/__tests__/intel-slots-p1p2.test.ts` | 13 通过 |
| `npx tsx src/lib/tender-intel/__tests__/awards.test.ts` | 20 passed |
| `outcome-winner-db.isolated.test.ts`（新增，隔离库，虚构企业） | 18 passed；无隔离库时跳过 |
| `awards-db.test.ts`（既有，隔离库） | 16 passed / 2 failed——T4-DB-08/09 需要库里有一行真实调查室（生产快照前置），空的隔离库没有；与本次改动无关 |
| `bash scripts/check-test-registry.sh` | OK，已注册 536 |
| `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npm run lint:baseline` | PASS（无新增 error fingerprint） |
| `openspec validate tender-outcome-winner --strict` | valid |

隔离库测试覆盖：写入（中标方 / 人工确认 / 中标价 / 币种 / 买家 / 来源与幂等键）、结果备注、同名幂等、换名不覆盖、填我方被拒且状态不变、未填不写、开关关闭只写备注、我方中标回灌后投影排除我方。新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（无隔离库自动跳过）。

表单改动（输入框与保存说明）只做了类型检查与 lint，没有起应用截图验证。

以上全部是测试数据（虚构企业名，隔离库），不是真实业务证据；生产效果要等用户在真实项目上标记结果后才能看到。

## 3. 已知局限

- 没有更正 / 撤回已记录中标方的界面：换名只提示、不覆盖。填错时要人工处理授标记录。
- 组织改名后，用旧名写入的我方中标记录不会被排除；需要时可加组织别名。
- 竞争对手只靠用户手填；不从公告或合同披露自动推断。

## 4. 上线

无迁移、无新 env；写授标记录沿用既有开关 `T4_AWARD_INTELLIGENCE_SCHEMA_READY`（关闭时只写备注）。合并即生效，回滚 = 还原上述文件；已写入的授标记录与普通人工确认记录同构，回滚后仍可读。
