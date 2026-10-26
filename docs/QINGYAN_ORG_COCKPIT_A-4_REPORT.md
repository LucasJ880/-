# A-4 完成报告：工作量 / 无用功面板（openspec change `org-cockpit-workload`）

任务书：`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` §A-4
分支：`claude/org-cockpit-workload`（叠在 A-3 `claude/org-cockpit-home` 之上；PR base = A-3 分支，A-3 合并后改回 `main`）
OpenSpec change：`openspec/changes/org-cockpit-workload/`（proposal / `specs/cockpit/workload/spec.md` / design / tasks，`openspec validate --strict` 通过）

---

## 1. 做了什么

| 文件 | 内容 |
|---|---|
| `src/lib/cockpit/workload.ts`（新） | 纯函数：阈值默认值与逐项校验；组织本地日分桶（每个时区缓存一个格式化器）；待审批结局规则表（10 条，见 design D5）；AI 运行 / 待审批 / 询盘 / 用量的岗位归属；按岗位 × 天汇总与近 7 天合计；四条疑似无用功规则与中文原因；"改过再批未接入 / 自动执行不适用 / 未入账"标记 |
| `src/lib/cockpit/workload-read-model.ts`（新） | 只读读模型，依赖可注入；查询条件全是导出的纯函数。读六类来源：AI 运行（直接复用岗位总览的两个条件函数）、平台自动化逐日计数、待审批、FDE 询盘、跟进护栏审计、AI 用量记账。每类来源上限 5000 行，触顶标 `truncated`。询盘判定直接用 `sla-metrics.ts` 的函数 |
| `src/app/api/cockpit/workload/route.ts`（新） | `GET /api/cockpit/workload?days=7..30`（缺省 14）：`withAuth` → `resolveCockpitViewer`（与岗位总览同一套）→ 参数校验 400 → 读模型 |
| `src/components/cockpit/org-cockpit-workload.tsx`（新） | 首页工作量区块：默认收起，点"查看近 14 天工作量"才请求，收起保留数据。区块宽 ≥ 896px 用表格，更窄时每岗位一张卡片。命中规则的行标红并给原因。走势小图为两条独立缩放的柱带（AI 运行 / 提出），每天有悬停数值 |
| `src/components/cockpit/org-cockpit-view.tsx` / `org-cockpit-home.tsx`（改） | 视图增加 `workloadSlot`（卡片与 company.log 之间）；首页容器把区块放进去。首页容器本身仍只引用两个接口 |
| 测试（新，均已注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`） | `workload.test.ts` 94 条、`workload-read-model.test.ts` 93 条、`org-cockpit-workload.test.tsx` 48 条 |

### 接口响应

`{ orgId, generatedAt, timezone, days[N], signalWindowDays: 7, thresholds, availability, truncated, rows[9] }`

- `rows`：七个岗位 + "询盘销售 · 展会" + "未归属"，每行字段为 `{ key, name, nav, daily[N]: Counts, last7: Counts, costRecorded, signals[] }`。
- `Counts`：`agentRuns`、`automationRuns`（平台级）、`proposed`、`approved`、`rejected`、`expired`、`cancelled`、`superseded`、`systemFailed`、`executionFailed`、`guardrailBlocked`、`inputTokens`、`outputTokens`、`cost`（USD）。
- 不含任何标题、载荷、失败原因原文、客户信息、金额（报价 / 毛利 / 估值）。

## 2. 怎么验的

| # | 验证 | 结果 |
|---|---|---|
| 1 | 三个新测试单独运行 | workload 94/94、read-model 93/93、区块渲染 48/48；A-3 渲染测试 78/78 不受影响 |
| 2 | 近 7 天 AI 运行与岗位卡片同口径 | 测试用一批跨组织、跨类型、跨工作域、跨 14 天的运行，分别喂给 A-2 的 `assemblePostsCockpit`（经 A-2 两个条件函数求值）与 A-4 读模型：七个岗位逐一相等 |
| 3 | 结局判定与写入方一致 | 10 条规则表驱动；测试读写入方源码，核对每个失败原因字面量（过期 / 取消 / 关联任务取消 / 作废码 / 批量准备失败 / 报价变化） |
| 4 | 分天 | 上海、多伦多；2026-11-01 夏令时结束日 25 小时；缓存格式化器与 `automation/local-time` 在四个时区（含 Lord Howe 半小时夏令时）逐点一致 |
| 5 | 性能 | 行数上限（AI 运行 25000、待审批 5000、用量 5000）汇总约 0.15 秒，测试断言 < 1.5 秒（修复前审查实测 3.4 秒） |
| 6 | 局部 `tsc`（驾驶舱全部文件 + 首页） | 0 错误 |
| 7 | `npm run typecheck`（全量） | GATE_TSC |
| 8 | `npm run lint:baseline`；新文件 `npx eslint` | GATE_LINT |
| 9 | `npm test` 对比 `origin/main` 基线 | GATE_NPM |
| 10 | `npm run test:ci` | GATE_CI |
| 11 | `git diff --stat origin/main -- prisma/ vercel.json` | 空 |
| 12 | `openspec validate org-cockpit-workload --strict`；`/opsx:verify` | GATE_VERIFY |
| 13 | 走势小图配色 | dataviz 校验脚本：浅色主题 AI 运行灰（≈ `muted` 60%）与强调色正常视力 ΔE 29.9、色盲 ΔE 28.1；灰对底色对比度 2.1 的 WARN 由数值表格兜底（表格是主信息，小图只给形状），并有图例与每天悬停数值。深色（glass）主题同样通过分辨度检查 |

## 3. 视觉核对

做法与 A-3 一样：离线渲染夹具，套项目自己编译的 `globals.css`，加上与 `AppShell` 一致的 240px 侧栏，用 Playwright 截图。截图在会话 scratch 目录，不入库。

| 视口 | 区块宽 | 形态 | 结论 |
|---|---|---|---|
| 1280 | 980px | 表格 | 一行一个岗位，九列数值 + 走势。命中行整行浅红底、岗位名红字、原因带图标。平台自动化列用次要色。无横向滚动 |
| 820 | 约 520px | 卡片 | 每岗位：名称 / 原因 / 走势在上，下面 4 × 2 个数值 |
| 390 | 约 346px | 卡片 | 同上。页面无横向滚动，最小点击高度 44px |

审查中修掉的视觉 / 交互问题：
- 第一版在窄屏把整张表放进横向滚动，手机上只看得到"岗位 + AI 运行"一列，改为窄区块用卡片；
- 展开 / 收起原来是两个不同按钮，切换时键盘焦点丢失，改为常驻的一个按钮（`aria-expanded` / `aria-controls`），加载、失败、加载完成都可被读屏播报。

## 4. 与任务书的偏差（请 GATE 逐条确认，详见 proposal）

1. **`edited`（改过再批）暂无数据**：PendingAction 没有任何编辑痕迹，任务书 B-1 写明 A-4 的这一项从 B-1 取，面板显示"未接入"。
2. **`auto_executed` 不存在**：所有执行都经人工批准，面板注明"不适用"。
3. **过期 / 取消 / 作废 / 系统失败的判定**：按失败原因与决策人的有序规则表判定（design D5），过期不计入驳回，批量准备失败不算批准。
4. **成本大部分岗位"未入账"**：
   - 用量账本只在对话接口和产品内容模块写入带组织的记账；FDE 与定时任务的 AI 调用目前不入账；
   - "每次批准成本"规则因此现阶段基本不会触发；
   - 补记账另开 change。
5. **平台级自动化只作参考列**，不参与规则。空转规则只看本组织 AI 运行，且只判能收到待审批的岗位：客服、运维与知识、内容不判。
6. **规则加最小样本**：已决策 ≥ 4 件才判驳回率 / 过期率；成本离群至少 3 个岗位有值才判。均可在组织设置覆盖。
7. **GATE-A2 对账口径改写**：`/ai-activity` 不显示运行计数（它按当前用户读审计日志）。改为两步：
   - 面板近 7 天 AI 运行 = 岗位卡片"7 天 AI x 次"，已由测试保证；
   - staging 再与 `AgentRun` 直接计数人工对账。
8. **首页按需加载**：区块默认收起、点击才请求，守住 A-3"首屏 ≤ 2 个 API 请求"。A-3 spec 措辞已同步（PR #246）。
9. **按组织本地日分桶**：时区取组织设置，缺省 America/Toronto。

## 5. 交叉审查（独立审查代理，只给代码与规格）

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| 1 | 应修（接近阻塞） | `compensateBatchPrepareFailure` 写 `failed` + `BATCH_PREPARE_FAILED` + 决策人，被"有决策人 → 批准后执行失败"误计为批准，抬高批准数、压低驳回率；测试夹具用了写入方不会产生的"无决策人"，所以没测出来 | 规则表在第 9 条前加批量准备失败 → 系统失败；夹具改为带决策人；测试读写入方源码确认它确实带决策人；spec 增补 scenario |
| 2 | 应修 | 跟进草稿（`no-reply-followup.ts`）建审批时不回写询盘，展会 / 测试判定落空，全计入询盘销售 | 没关联上询盘的回复动作取载荷里的商机，查商机与其最早一条 FDE 询盘，用同一组 SLA 函数判定；跟进护栏审计按 `targetId`（商机）同样判定 |
| 3 | 应修 | 空转规则结构性误报：运维与知识永远收不到待审批，却收到全部 `general` 作业运行；只有展会询盘的一周会把询盘销售判成空转 | 只判按 A-1 归属规则能收到待审批的行（测试穷举反证）；询盘销售的提出连同展会行 |
| 4 | 应修 | 每个事件都新建 `Intl.DateTimeFormat`，行数上限时同步占用 3.4 秒 CPU | 每时区缓存格式化器、每事件只分一次天：约 0.15 秒，测试断言 |
| 5 | 应修 | 展开按钮无 `aria-expanded`；展开 / 收起换按钮导致焦点丢失；状态不播报；收起丢弃数据、再展开重跑约 25 个查询 | 常驻单一按钮 + 状态播报 + 收起保留数据 |
| 6–9 | 小 | 询盘读取触顶时丢的是最新的；首封护栏少了"商机属于本组织"检查；spec 写跟进护栏"按询盘创建日"与实现不符；报价变化作废落到系统失败；行数上限判定只在假依赖里测；30 天时 31 个并发 `groupBy` | 全部修正：询盘按时间倒序取；补组织检查；spec 改为按审计时间；报价变化归作废；`capped` / `mergeAgentRunRows` 抽成纯函数并测；自动化逐日查询每批 6 个 |
| — | 记录 | SLA 指标对没有护栏标记的旧询盘会回读 `AgentRunEvent`，本 change 不做（14 天窗口内的询盘都已有标记）；`AgentRun` 无 `(orgId, createdAt)` 索引、`PendingAction` 无 `(orgId, updatedAt)` 索引 | 写入 design Risks；staging `EXPLAIN ANALYZE` |

审查同时独立确认了以下几点：
- 结局规则逐个对照了全部写入方；
- 近 7 天窗口与 A-2 相同，且不会重复计数；
- `updatedAt ≥ 窗口起点`覆盖窗口内创建 / 决策的全部动作（`updateMany` 也刷新 `@updatedAt`）；
- 夏令时分桶与自动化逐日区间对齐；
- 只读、路由只导出 `GET`；
- 响应不含业务内容；
- 规则数学与阈值校验正确；
- Tailwind 容器查询类正确生成；
- 首屏仍两个请求；客户端只 `import type`。

## 6. staging 待验项（GATE-A2）

- 以 `seed:org:sunny-home-deco` 管理员展开工作量区块：
  - 近 7 天 AI 运行与岗位卡片"7 天 AI x 次"一致，并与 `AgentRun` 直接计数对账；
  - 至少复现一个标红信号并解释原因（最可能是询盘销售的驳回率或过期率）。
- 对待审批（`orgId` + `updatedAt`）、AI 运行（`orgId` + `runType` + `createdAt`）、用量记账（`orgId` + `occurredAt`）三条查询跑 `EXPLAIN ANALYZE`；记录展开一次的总耗时。
- 组织设置写入 `cockpit.workloadThresholds` 后，规则与说明文案随之变化。

## 7. 已知限制

- 成本只覆盖已入账的用量：对话与产品内容。对话用量计入"未归属"。
- 平台自动化是平台级次数，不分组织。
- `edited` 要等 B-1。
- 跟进护栏审计找不到商机时计入询盘销售行。
- 首封护栏不回读旧询盘的运行事件。
