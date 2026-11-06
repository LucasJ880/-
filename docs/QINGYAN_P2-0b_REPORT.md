# P2-0b 报告：「竞争对手」「采购机构」接真实数据 + 收起「周期采购」

| 项 | 值 |
|---|---|
| TASKFLOW | P2-0b（接在 P2-0 后面） |
| OpenSpec change | `openspec/changes/tender-intel-org-profiles/` |
| 分支 | `claude/tender-intel-hub-pages`（基于 `claude/tender-outcome-winner`，即 #384；#384 合并前本 PR 的差异包含它） |
| 截图 | `docs/acceptance/p2-0b/01-competitors.png`、`02-agencies.png`、`03-agencies-phone.png`（虚构数据，隔离库） |

## 1. 改了什么

- **画像（纯函数）** `src/lib/tender-intel/org-profiles.ts`
  - 竞争对手：按中标方归集；我方排除并计数；每家给出已确认次数、线索条数、最近中标日期、中过标的采购机构（按次数）与每条授标记录。线索（AI 提取 / 疑似重复）不给金额；撤回不计。
  - 采购机构：授标事实与我方项目的采购方按同一规范化合并；给出授标条数、中标方（我方标「我方」）、采购周期（复用 `deriveBuyerCycle`），以及我方项目按结果计数（中标 / 未中标 / 未投 / 取消 / 进行中）和最近 5 个项目。
- **接口** `GET /api/org/tender-intel-profiles?orgId=`（只读）：非成员 403；项目经 `buildProjectVisibilityWhere` 过滤（待派发项目不计）；授标情报开关关闭时不碰授标表，竞争对手为空、机构只按项目显示。
- **页面**：两页去掉"尚未启用"，显示汇总、搜索框、卡片（可展开授标记录与项目）、空状态说明（数据从哪里来）。
- **导航**：「周期采购」从情报中枢页签与侧栏移除，页面保留。
- `deriveBuyerCycle` 改为导出（逻辑不变）。

零 schema、零出站、零 LLM、无新队列；不写任何数据。

## 2. 测试与门禁（实际运行）

| 检查 | 结果 |
|---|---|
| `npx tsx src/lib/tender-intel/__tests__/org-profiles.test.ts`（新增） | 30 passed |
| `org-profiles-db.isolated.test.ts`（新增，隔离库 + 真实路由 + 真实会话） | 12 passed；无库跳过 |
| navigation 六个测试（nav-active-matcher / navigation-ia / navigation-workspace / position-nav / trade-layout / wechat-entry-nav） | 21 / 63 / 34 / 86 / 5 / 19 passed |
| `bash scripts/check-test-registry.sh` | OK，已注册 538 |
| `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npm run lint:baseline` | PASS（无新增 error fingerprint） |
| `bash scripts/test-runtime-architecture.sh` | PASS |
| `openspec validate tender-intel-org-profiles --strict` | valid |
| 界面 | 隔离库 + `next dev` 实际打开两页截图；手机宽度（iPhone 13）无横向滚动 |

截图与测试全部是虚构企业的测试数据，不是真实业务证据。

## 3. 发现（不在本次改动范围）

截图数据里，同一对手在同一机构的第二次中标（不同招标编号）被标成「疑似重复」，只算线索。原因是 `awards.ts` 的弱信号规则：同中标方 + 同买家已有记录就标 NEEDS_REVIEW，不看招标编号；而系统里没有裁决疑似重复的界面，这些记录会一直停在线索。周期采购统计也会因此缺样本。

建议另开小改动：两条记录都有招标编号且编号不同时，不判疑似重复（编号缺失时保持现有规则）。这改的是授标事实写入规则，等确认后再做。

## 4. 上线

无迁移、无新 env；授标部分沿用 `T4_AWARD_INTELLIGENCE_SCHEMA_READY`。依赖 #384 先合并。回滚 = 还原文件。
