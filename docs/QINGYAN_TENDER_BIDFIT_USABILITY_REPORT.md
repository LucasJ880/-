# 合规矩阵可用性批次实施报告（中文化 + 分组收敛 + 批量标注）

日期：2026-08-20 · 分支 `feature/tender-bidfit-usability` · base = main `fc7e9a29` · SCHEMA_CHANGE = NONE

## 1. 用户痛点与诊断

1. **矩阵全英文**：结构性 bug——`v2-map.ts` 把抽取 statement（随标书语言）同时填进
   `originalRequirement` 与 `chineseTranslation`，后者名不副实。矩阵/备忘录输入/报告
   全部展示该字段。隔离快照实证：最新真实 run 的 200 条要求 **200 条全英文**。
2. **太多太杂**：矩阵平铺 300 条，仅「强制/全部」开关；40+ 条 mandatory 里程序类
   模板条款（英文投标/签名/有效期…）淹没真正要拍板的技术/资质项。抽取层已有
   `category` 字段但展示层未用。
3. **缺「全部同意」**：POST 一次一条，40 条 common 条款要点 40 次。

## 2. 改动

- **新 `requirement-translate.ts`** — 中文化服务（纯格式转换，不是判定）：
  - CJK 占比 <15% 判英文（`requirement-lang.ts` 零依赖纯函数，server/client 共用防漂移）
  - **50 条/批**分批调用（真实 E2E 教训：200 条单批必超时/截断——gpt-5.6 reasoning
    计入 max_completion_tokens）；批间独立失败；总预算 deadline 裁剪
  - 反向守卫：译文仍非中文（模型照抄）→ 该条回退，绝不写假译文
  - 只改 `chineseTranslation`；`mandatory/complianceStatus` 等语义字段零触碰；
    原文保留在 `originalRequirement` 可对照
- **管线挂点**（`v2-resumable.ts` PERSIST 组装后、canonical 事务外、租约内）：
  新分析入库前自动翻译；复用 `args.invoker` 注入面（RESUME parity 探针可观测）；
  telemetry 按真实调用数累计；失败回退英文不阻塞终态化
- **存量补翻端点** `POST /api/projects/[id]/bid-fit/translate`：写权限门 + 60s 频控
  （频控戳先落，零更新也占窗防反复烧模型）+ 事务批量写回
- **新 `bid-fit-groups.ts`** — 分组契约：21 个 category 收敛 5 组（技术与产品/资质与保障/
  商务与价格/程序与提交/其他），**仅程序类默认折叠**；未知值兜底「其他」
- **`bid-fit` 路由** — GET 返回 category；POST 支持 `requirementIds[]` 批量（≤300，
  全量归属校验 fail-closed，任一无效整体拒绝）
- **矩阵卡重构** — 分组折叠渲染（组头带计数/未标数/「本组全部已有」）；
  「未标 N 条全部设为已有」总按钮（window.confirm 确认）；检测到英文条目时显示
  「翻译成中文（N 条英文）」按钮；「需证据」徽标 + 组内证据条置顶。
  五态语义与单条标注不变；AI 仍不代填判定——批量是**人工动作**的省力化。

## 3. 测试证据

- 纯平面 **bid-fit-usability 14/14**（已注册 test-all + test-ci-unit）：分组全覆盖
  反例守卫（枚举扩容漏配即红）/语言启发式两向/翻译回退与反向守卫/**分批反例守卫
  （单批全量写法不得回归）**/批间独立失败/路由 fail-closed/挂点在事务外
- 回归：**v2-resumable 42/42**（翻译挂点接入 telemetry 后 parity 无漏计）；
  CI 子集全 PASS；tsc 零错；eslint 变更文件零告警
- **真实 E2E 6/6**（隔离生产快照 + 真实模型，`scripts/bid-fit-usability-e2e.ts`）：
  - 生产形态复现：真实 run 200 条全英文
  - 真翻 **199/200**（73s，4 批），数字/金额/标准号逐字保留抽查 5/5
  - 写回后英文 200 → 1；语义字段零触碰；幂等重跑已翻条目**零模型花费**
  - 第一版单批实现在真数据上 0/200 全超时——分批版即由该失败驱动（红→修→绿）

## 4. 上线后行为

- 新分析：入库即中文（管线自动翻译，中文标书零额外花费）
- 存量项目（含 Halifax）：矩阵卡点「翻译成中文」一次补翻
- 无新 env / 无 schema / 无 cron；回滚 = revert PR

## 5. Gate

```
BIDFIT_SCHEMA_CHANGE     = NONE
BIDFIT_TRANSLATE         = 管线自动 + 存量按钮；语义字段零触碰；假译文反向守卫
BIDFIT_GROUPS            = 5 组契约全覆盖（21 category，仅程序类默认折叠）
BIDFIT_BULK              = requirementIds ≤300 全量归属校验 fail-closed + UI 确认
BIDFIT_PURE_SUITES       = bid-fit-usability 14/14 + v2-resumable 42/42 + CI 子集 PASS
BIDFIT_REAL_E2E          = PASS 6/6（隔离快照 + 真模型；199/200 真翻；幂等零花费）
BIDFIT_ISOLATED_BRANCHES = 0（e2e-bidfit-usability / -2 已删）
BIDFIT_STATUS            = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
