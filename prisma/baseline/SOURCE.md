# pre-Phase-4 Baseline Schema Source

| 项 | 值 |
|---|---|
| 生成时间 | 2026-07-28 |
| Neon project | polished-thunder-16018212 |
| 源 branch | greenfield-baseline-source-pre-phase4 (`br-muddy-recipe-anfuy022`) |
| Parent | production (`br-green-boat-ann7k5yf`) |
| Endpoint（脱敏） | ep-proud-meadow-andg5asd |
| 命令 | `DATABASE_URL=<branch> npx prisma db pull --print` |
| 输出 | `prisma/baseline/schema.pre-phase4.prisma` |

## 切点确认

- `Project.workDomain` / `deliveryStage` / `sourceTenderProjectId`：**不存在**
- `ProjectHandoff`：**不存在**
- Phase 3 Task 字段 `blockedReason` / `waitingOn` / `waitingUntil`：**存在**
- Bid Data 表（`BidDataRevision` 等）：**存在**
- extension：`vector`、`plpgsql`

本 Schema **不是** Phase 5 最终态，也不是理想化 Git commit；是生产 pre-Phase-4 真实结构。
