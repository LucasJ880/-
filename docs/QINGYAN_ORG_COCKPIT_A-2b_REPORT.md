# A-2b 完成报告：company.log 时间线审计中文摘要与来源（openspec change `org-cockpit-timeline-labels`）

任务来源：A-2 HANDOFF"记录的改进点"（审计摘要是原始动作代码）与 B-5 报告 GATE 注意项（系统 / FDE 以负责人名义写的审计显示成负责人本人）。用户 2026-10-26 第二轮"改进项按推荐顺序做"。不是任务书新编号，状态沿用 A-2 行。
分支：`claude/org-cockpit-timeline-labels`。叠在 B-6 `claude/fde-v2-readiness` 之上，PR base = B-6 分支，依次合并后改回 `main`。
OpenSpec change：`openspec/changes/org-cockpit-timeline-labels/`（proposal / `specs/cockpit/company-log-labels/spec.md`（新增）/ `specs/cockpit/company-log/spec.md`（修改 A-2 的「统一信封」「来源范围有界」）/ design / tasks，`openspec validate --strict` 通过）。

---

## 1. 做了什么

| 文件 | 内容 |
|---|---|
| `src/lib/cockpit/audit-labels.ts`（新，纯函数） | 动作 / 目标类型中文标签（精确匹配、只认自有键，未知动作回退原始代码）；来源判定（FDE 固定动作 → ai；作废 / 配额守卫 / 询价邮件自动录入 / 外发镜像 → system；商机阶段变更按流转来源；FDE 发起的审批 → ai）；商机阶段变更白名单解析（只出来源、是否按策略、前后阶段三项枚举） |
| `src/lib/cockpit/timeline.ts`（改） | `TimelineEntry.source`；审计摘要与来源接入；AI 运行事件 `ai`、自动化运行 `system` |
| `src/lib/cockpit/posts-read-model.ts`（改） | 本页有商机阶段变更时，按"组织 + 动作 + 本页 id"再查一次变更数据，只经枚举解析 |
| `src/lib/cockpit/presentation.ts`（改） | `entryActorLabel`：AI / 系统来源的审计显示"AI"/"系统"，提示"以 X 名义记录" |
| `src/components/cockpit/org-cockpit-view.tsx`（改） | 操作者列改用 `ActorCell`（`title` + 读屏文字） |
| 测试 | 新 `audit-labels.test.ts`（10 条，已注册进两个测试脚本）；`timeline` / `posts-read-model` / `presentation` / `home-state` / `org-cockpit-view` 补断言与 `source` 字段 |

示例：
- `APPROVAL_REJECTED · pending_action` → "驳回 · 审批"
- 自动搁置 → "商机阶段：跟进中 → 搁置（按策略自动）"，操作者列"系统"（悬停"以 <负责人> 名义记录"）
- FDE 草稿留底 → "FDE 草稿留底 · 审批"，操作者列"AI"
- 未知动作 `supplier_intel.run.created · supplier_intel_run` 原样显示

## 2. 怎么验的

门禁在独立 worktree 的 `5ff5ee06`（含审查修正；之后只合入了上游文档）上跑。

| # | 验证 | 结果 |
|---|---|---|
| 1 | 6 个相关测试单独运行 | audit-labels 10、timeline 53、posts-read-model 136、presentation 64、home-state 21、org-cockpit-view 79，全过 |
| 2 | 标签与写入方对照 | 标签表里的审批 / 配额 / 询价邮件 / Revenue Spine 动作逐条对照写入方源码；写入方实际用的目标类型都有中文名 |
| 3 | 来源 | FDE 三个固定动作 → ai；系统固定动作 → system；阶段变更 human / fde / system 映射；发起审批按载荷发起方（agent → ai，user / 缺失 → human）；批准 / 驳回始终人工 |
| 4 | 白名单与脱敏 | 阶段值只认已知阶段（含 Sunny 旧阶段归一）；自由文本、坏 JSON、原型链键都不显示；带原因、金额、策略键的审计序列化后不含这些值；主查询不读变更数据（源码断言） |
| 5 | 变异检查 | 来源映射、按策略、接线、操作者列、发起方接线、自有键查表：各至少 1 条断言失败 |
| 6 | `npm run typecheck`（全量） | 退出 0 |
| 7 | `npm run lint:baseline` | PASS（无新增 error fingerprint；相对基线减少 14 处） |
| 8 | `npm test` 对比基线 | 436 / 450；14 项失败与基线逐条一致（本 change 新增 1 项，全过） |
| 9 | `npm run test:ci` | 退出 0，`CI unit subset PASS`（含 `schedule.test.ts`、`waiting.test.ts`） |
| 10 | `bash scripts/check-test-registry.sh` | 本 change 测试已注册；仍有 `main` 上既有的 2 个 trade 测试未注册（不是本 change 引入） |
| 11 | `git diff --stat claude/fde-v2-readiness -- prisma/ vercel.json` | 空 |
| 12 | `openspec validate org-cockpit-timeline-labels --strict`；`/opsx:verify` | valid（INFO：MODIFIED 需 A-2 归档后才能归档，tasks 已写明顺序）。verify：tasks 6 / 6；新增 5 条 + 修改 2 条 requirement / 15 个 scenario 均有测试断言（「来源范围有界」原有 3 个场景由 A-2 既有测试覆盖）；design D1–D4 与实现一致；无 CRITICAL / WARNING。未验证：真实 DB 下的第二次查询（容器无 DB），留 staging |

## 3. 与任务书的偏差（请 GATE 逐条确认，详见 proposal）

1. **不是任务书条目**：A-2 改进点与 B-5 GATE 注意项。
2. **A-2"审计不读变更前后数据"开一个窄口子**：只对商机阶段变更读变更数据、只解析 3 个枚举；A-2「来源范围有界」同步修改，写明这是唯一例外。
3. **不改时间线收录范围**：草稿留底等高频审计仍进时间线，只是有了中文标签与 AI 来源。

## 4. 交叉审查（独立审查代理，只给代码与规格）

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| 1 | 应修 | A-2「来源范围有界」写"变更前后数据 SHALL NOT 出现在条目里"，与本 change 矛盾，归档后主 spec 自相矛盾 | delta 增加 MODIFIED「来源范围有界」，写明白名单枚举是唯一例外，并加场景 |
| 2 | 应修 | 几类 AI / 系统写入仍显示为负责人本人：FDE 发起的 `APPROVAL_CREATED`、`rfq_inbound:*`、配额守卫三档、外发镜像 | 发起审批按审批载荷里的发起方（读模型本就读了载荷）；其余进系统固定表并配标签；混合来源的 `inquiry.intake` 写进 design Risks |
| 3 | 应修 | 有标签的动作遇到写入方实际目标类型没中文名（`revenue_spine_policy`、`product_content_approval`），半中半英 | 补目标中文名（另补 `quota`、`rfq_inbound_message`）并加断言 |
| — | 可选 | 原型链键查找；spec "额外读取三项"措辞与场景指向的测试；"未知动作 + 已知目标"行为没写；测试名与旧阶段值；常见 Revenue Spine 动作标签；文档不一致；名义提示的可达性；两处挂名语义小偏差 | 改为只认自有键并测试；措辞改"只解析并使用三项"、场景指向两份测试；spec 补一句；补 Sunny 旧阶段用例；补询盘录入 / 回复发送 / 驳回 AI 草稿标签；proposal 动词开头、测试数量更正、design D2 改正；可达性与挂名偏差写进 design Risks |

## 5. GATE 注意项与 staging 待验

- 混合来源：网站询盘录入挂名负责人，显示为人工；入驻测试关闭询盘、人工回复触发的作废，挂名的是触发者。
- "以 X 名义记录"只在悬停与读屏文字里，触屏用户看不到（操作者列"AI / 系统"已可区分）。
- staging：在 sunny-home-deco 打开首页时间线：
  1. 自动搁置显示"商机阶段：… → 搁置（按策略自动）"，操作者列"系统"；
  2. FDE 起草的询盘显示"AI · 发起审批 · 审批"与"AI · FDE 草稿留底 · 审批"；人工批准显示批准人姓名；
  3. 时间线接口响应每条都带 `source`。
