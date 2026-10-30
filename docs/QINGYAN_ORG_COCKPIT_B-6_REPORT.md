# B-6 完成报告：FDE V2 启动条件只读就绪度（openspec change `fde-v2-readiness`）

任务书：`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` §B-6（决策项）。用户 2026-10-26 第二轮："A5和B-6开始"；本 change 只交只读就绪度指标，**不启动 V2 本身**，V2 是否启动仍由 Evan 按指标决定。
分支：`claude/fde-v2-readiness`。叠在 A-3b `claude/org-cockpit-proactive-notify` 之上，PR base = A-3b 分支，依次合并后改回 `main`。
OpenSpec change：`openspec/changes/fde-v2-readiness/`（proposal / `specs/revenue-spine/fde-v2-readiness/spec.md` / design / tasks，`openspec validate --strict` 通过）。

---

## 1. 做了什么

| 文件 | 内容 |
|---|---|
| `src/lib/revenue-spine/v2-readiness.ts`（新，纯函数，零 import） | 四条条件与依据文案、结论（只由可度量条件决定）、提案按桶与字段计数、来源（提案 / 手工）、首封草稿占比（只发目录单列）、V2 其余数据源 |
| `src/lib/revenue-spine/v2-readiness-read-model.ts`（新） | 6 个只读查询（都带服务端解析的 orgId）；提案终态复用 A-4 `pendingActionOutcome`；同一审批快照去重；读取上限 + 1 判截断 |
| `src/app/api/revenue/v2-readiness/route.ts`（新） | `GET`，`resolveRevenueAccess` + `force-dynamic`，不读请求参数 |
| `src/components/revenue/v2-readiness-panel.tsx`（新） | `/revenue` 评分校准下方的收起区块，点开才请求；状态图标 + 文字 |
| `src/app/(main)/revenue/page.tsx`（改） | 挂载区块 |
| 测试（新，已注册进两个测试脚本） | `v2-readiness.test.ts` 18 条；`v2-readiness-panel.test.tsx` 36 条 |

四条条件：

| # | 条件 | 判定 |
|---|---|---|
| 1 | 事实提案已运行满 30 天 | 本组织第一张事实提案创建满 30 天；没有提案 = 未满足（"尚无事实提案"） |
| 2 | MOQ 已可引用 | `getMOQ` 为 available（与草稿同源）；来源：经提案写入过 N 次 / 手工配置 |
| 3 | 生产周期已可引用 | `getLeadTime` 为 available；只配样品时效不算 |
| 4 | 至少 3 个类目的 MOQ / 生产周期 | **固定无法度量**：商务事实是组织级、不分类目；结论里提示"需人工判断" |

## 2. 怎么验的

门禁在独立 worktree 的 `a780d954`（含审查修正；之后只合入了上游文档）上跑。

| # | 验证 | 结果 |
|---|---|---|
| 1 | 两个测试单独运行 | 18 / 18、36 / 36 |
| 2 | 条件判定 | 10 天 / 29 天 / 30 天整 / 45 天 / 没有提案；手工 vs 提案来源；只配样品时效 → 条件 3 未满足 |
| 3 | 提案终态口径 | 与 A-4 一致：超时清理的 failed + 已过期 → 过期；未清理但过有效期 → 过期；取消 / 作废 / 执行失败 / 认领中 → 其他；执行完成（含值未变）→ 已批准 |
| 4 | 首封草稿占比 | 跟进不计；只发目录（待确认项为空）单列、不进分母；同一审批两份快照只算一份；中英两种"生产周期"文案都算，且与 `reply-draft.ts` 源码逐字对照 |
| 5 | 脱敏 | 配了 MOQ / 周期 / 最低毛利 / 港口 / 落款 / 目录、提案载荷与草稿正文含数量与买家邮箱，序列化响应一个都不出现 |
| 6 | 组织范围与只读 | 每个默认查询都经带 orgId 的条件构造函数（源码断言）；读模型 / 接口 / 纯函数无任何写入调用 |
| 7 | 客户端打包 | 纯函数文件零 import；区块不 import 任何服务端模块 |
| 8 | 变异检查 | 30 天边界、跟进过滤、过期桶、结论、来源、截断、只发目录、去重接线、组织条件、只配样品时效：各至少 1 条断言失败 |
| 9 | `npm run typecheck`（全量） | 退出 0 |
| 10 | `npm run lint:baseline` | PASS（无新增 error fingerprint；相对基线减少 14 处） |
| 11 | `npm test` 对比基线 | 435 / 449；14 项失败与基线逐条一致（本 change 新增 2 项，全过） |
| 12 | `npm run test:ci` | 退出 0，`CI unit subset PASS`，含本 change 两个测试 |
| 13 | `bash scripts/check-test-registry.sh` | 本 change 测试已注册；仍有 `main` 上既有的 2 个 trade 测试未注册（不是本 change 引入） |
| 14 | `git diff --stat claude/org-cockpit-proactive-notify -- prisma/ vercel.json` | 空 |
| 15 | `openspec validate fde-v2-readiness --strict`；`/opsx:verify` | valid。verify：tasks 5 / 5；7 条 requirement / 12 个 scenario 均有测试断言；design D1–D6 与实现一致；无 CRITICAL / WARNING。未验证：真实 DB 下的查询与 staging 数据（容器无 DB） |

## 3. 与任务书的偏差（请 GATE 逐条确认，详见 proposal）

1. **"至少 3 个类目"无法度量**：commercialFacts 是组织级单值；如实标"无法度量"，不拿组织级值冒充三个类目。是否另做类目级事实属于 V2 本身的范围。
2. **按"可引用"判定，不只认"由提案沉淀"**：手工配置的事实同样是已确认数据；来源作为依据列出，B-2 是否在运转看条件 1 与提案计数。

## 4. 交叉审查（独立审查代理，只给代码与规格）

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| 1 | 阻塞 | "已过期"口径错：`approval-timeout` 每 2 小时把过期提案改成 failed + "已过期"，"待审批且过有效期"只在清理前 2 小时内成立，实际过期全进了"其他" | 读模型多取 `failureReason` / `decidedById`，复用 A-4 `pendingActionOutcome` 归桶；spec / design 同步 |
| 2 | 应修 | 只发目录的首封（待确认项为空）拉低占比，与条件 2 的依据自相矛盾 | 单列"只发目录"，不进分母；补 spec 场景与测试 |
| 3 | 应修 | 组织范围测试只看条件构造函数，默认依赖换成不带 orgId 的字面量也测不出 | 源码断言每个默认查询都经条件构造函数，并锁定查询个数 |
| 4 | 应修 | "只配样品时效不算"无端到端测试 | 补"MOQ 已配、只有样品时效"的 policy |
| 5 | 应修 | 提案 / 写入审计读满时的截断提示没有 Requirement | spec 拆分出「其余数据源与读取上限」并补场景 |
| — | 可选 | "已写入"含值未变；同一审批可能两份快照；"首张提案 N 天前"挂在近 30 天标题下；"首封"只含进了审批的；快照读取量；design 上限措辞；平台 admin 打不开区块 | 改名"已批准"并注明；按 targetId 去重；首张提案天数移到标题之前；区块与 spec 注明"进了审批的"；读取量与平台 admin（与 B-4 相同）写进 design Risks；措辞修正 |

## 5. GATE 注意项与 staging 待验

- 条件 1 用"第一张事实提案"作为 B-2 开始运行的证据，比 B-2 上线日偏晚（偏保守）。
- 平台 admin 打开区块会显示加载失败（`resolveRevenueAccess` 要求显式 orgId，与 B-4 相同）。
- staging：在 sunny-home-deco 打开 `/revenue` → 展开"FDE V2 启动条件（只读）"：
  1. 四条条件与依据显示；MOQ 已配置时条件 2 为已满足、来源显示手工或经提案；
  2. 条件 4 显示"无法度量"与组织级说明；
  3. 首封草稿数与占比与审批中心近 30 天的首封审批数量级一致。

## 6. 任务书状态

B-6 状态列改为 `[~]`：只读就绪度指标已交；V2 是否启动待条件满足后由 Evan 决定。
