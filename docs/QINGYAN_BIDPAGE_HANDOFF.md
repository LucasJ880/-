# BIDPAGE 交接（「标书与报价」页改版，BIDPAGE-1 ～ 8）

> 只写核对过的事实；没核对的写「未核实」。每合并一个 PR 更新一次。

## 0. 接手的人从这里开始

1. 先读本文件 §1 ～ §3，再读任务书 `docs/QINGYAN_BIDPAGE_BID_QUOTE_REDESIGN_TASKBRIEF.md`（尤其「合并授权、交叉验证与交接」与附录 C）。
2. 第一条命令：`git fetch origin && git log --oneline -5 origin/main && openspec list`（看 main 走到哪、有没有进行中的 change）。
3. 正在做的那个 change 用 `/opsx:continue <change>` 或 `/opsx:apply <change>` 接着做，不要重开。

## 1. 当前状态（2026-11-22）

| 项 | 值 |
|---|---|
| 当前 main | `13c7ed33`（#546 合并后；2026-11-22 核对） |
| 工作分支 | `claude/laughing-curie-2b9s1v`（每个 PR 合并后从最新 main 重开同名分支做下一个） |
| 正在做 | BIDPAGE-1 `bid-page-v2-shell`：四件套已写（`openspec validate --strict` valid），开工前审查子代理在跑，实现中 |
| 下一步 | 实现 BIDPAGE-1 的 tasks 1.1 ～ 3.2 → 全量门禁 → 六维审查 + 交叉验证 → PR → 合并 → 看部署状态 |

| change | ID | 状态 | PR | 分支 |
|---|---|---|---|---|
| `bid-page-v2-shell` | BIDPAGE-1 | 实现中 | — | `claude/laughing-curie-2b9s1v` |
| `quote-line-mode-persist` | BIDPAGE-3 | 未开始 | — | — |
| `quote-lump-sum-mode` | BIDPAGE-4 | 未开始 | — | — |
| `quote-one-step-confirm` | BIDPAGE-6 | 未开始 | — | — |
| `quote-margin-advice-market` | BIDPAGE-5 | 未开始 | — | — |
| `bid-page-sourcing-step` | BIDPAGE-2 | 未开始 | — | — |
| `bid-page-documents-step` | BIDPAGE-7 | 未开始 | — | — |
| `bid-page-zh-copy` | BIDPAGE-8 | 未开始 | — | — |

上线顺序：1 → 3 → 4 → 6 → 5 → 2 → 7 → 8。

## 2. 授权与拍板（原话与日期）

- Evan 2026-11-22 18:01：八个 PR 由实现者自行合并，条件见任务书「合并授权、交叉验证与交接」六条；改环境变量、打开开关、对外发东西不在授权内。
- Lucas 2026-11-22：合并后「GitHub 上合并提交的部署状态，确认是部署了就行」。
- Lucas 2026-11-22：附录 C 的 A、B、C「都按你推荐」。
- Lucas 2026-11-22：「现在起，这个项目交给你全权负责，都按照你的推荐来，合并也交给你做，PR 的审查需要用子agent多方面交叉审查，记得做好hand off」。据此：每个 change 的归档小 PR 也由实现者合并。

## 3. 判断点与不确定处的结论

| 项 | 结论 | 落在哪 |
|---|---|---|
| 判断点 1 ～ 6 | 按任务书默认 | 各 change 的 design |
| 附录 C 的 A / B / C | 拍板按推荐（共用代码按开关分流 / 入口改 `page.tsx` / 金额门 = 内部成本 ∧ 财务查看权） | 任务书附录 C |
| 附录 C 的 D ～ K | 按默认 | 任务书附录 C |
| 不确定处 2 | `engineConfigSchema` 非严格、`engineOf` 用 `safeParse`，加可选字段不会让旧数据失败 | 任务书附录 C；BIDPAGE-3 design（待写） |
| 不确定处 1 / 4 | 逐行只用引擎一套算法，四个数取引擎；Σ行合计与引擎合计差 ≤ Σ(数量 × 0.005) | 任务书附录 C；BIDPAGE-3 design（待写） |
| 不确定处 3 | 未核实（BIDPAGE-2 时复现） | — |
| 不确定处 5 | 实现会话连不上生产库，未核实；用合成数据回归，只读查询留给 Lucas / Evan | BIDPAGE-6 时写出查询 |
| BIDPAGE-1「下一步」规则顺序 | 「已定」「有草稿」挪到招标要求之后、找供应商之前（否则不走询价的项目永远停在「添加供应商」） | `openspec/changes/bid-page-v2-shell/design.md` D3 |

## 4. 已知问题与没验证到的地方

- 预发验收、生产页面、Sunny 组织 id：实现会话访问不到（未核实）。
- 本地隔离库：容器里 Postgres 16 已起、`vector` 扩展可用（`postgresql-16-pgvector` 装不上但扩展已在），库 `qingyan_test` 已 `prisma migrate deploy`。容器重启后要 `service postgresql start`。

## 5. 上线时要设的环境变量（八个都合并、预发验收通过后，由 Evan / Lucas 设）

| 变量 | 值 | 说明 |
|---|---|---|
| `TENDER_BID_PAGE_V2_ENABLED` | `1` | 新页面总开关 |
| `TENDER_BID_PAGE_V2_ORG_ALLOWLIST` | `<Sunny 组织 id>`（未核实，待填） | **必须填，不能留空**（留空 = 所有组织） |

## 6. 本地跑测试

```bash
service postgresql start
export PATH=/opt/node24/bin:$PATH
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/qingyan_test" DIRECT_URL="$DATABASE_URL"
export NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET="test-secret-test-secret-test-secret-0123456789"
npm test   # 全量；与 main 基线比对失败名单
```
