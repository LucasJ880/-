# Qyane GPT-6 Astra — Benchmark

## 目的

升级 production 前比较 **当前模型（gpt-5.6-sol / gpt-5.6-terra）vs gpt-6-astra**。  
不用纯合成题凑数：用例按脱敏后的真实 Qyane 任务形态编写。

## 本 PR 交付

| 产物 | 作用 |
|---|---|
| `src/lib/ai/model-policy/benchmark-fixtures.ts` | 40 条脱敏用例 |
| `src/lib/ai/model-policy/__tests__/benchmark-harness.test.ts` | CI：清单完整性、无密钥 |
| `scripts/gpt6-astra-benchmark.ts` | 打印对照表；live 需显式 env |
| 本文件 | 指标、跑法、**当前基线 = 未测 live** |

**CI 不打真实 OpenAI。** Live 对照必须在隔离环境、有密钥、可接受费用时执行。

## 套件构成

| Band | 条数 | 是否默认升 GPT-6 |
|---|---|---|
| simple | 10 | 否（Tier C） |
| medium | 10 | 否（Phase 3） |
| complex | 10 | Phase 1 角色才升 |
| tool-heavy | 5 | 仅当 Responses 路径可用 |
| failure/recovery | 5 | 行为契约，不只质量 |

完整条目见 fixture 文件（S01–S10, M01–M10, C01–C10, T01–T05, F01–F05）。优先域：

- Supervisor 规划 / 修复 / 仲裁
- Runtime V2 planner（FDE）
- Tender understanding（证据接地，UNKNOWN 纪律）
- Market research
- 工具环授权与取消
- Supplier intel：**明确不把 score-contract 交给模型**

## 指标

| Metric | Current | GPT-6 | 备注 |
|---|---|---|---|
| Success Rate | _pending live_ | _pending live_ | 结构化 schema pass + 人工可接受 |
| Tool Accuracy | _pending live_ | _pending live_ | 仅 tool-heavy |
| Structured Output Pass | _pending live_ | _pending live_ | JSON / Zod |
| Avg Latency | _pending live_ | _pending live_ | 含 reasoning tokens 墙钟 |
| Input Tokens | _pending live_ | _pending live_ | 含 cached |
| Output Tokens | _pending live_ | _pending live_ | Astra 官方称「更少 output」需验证 |
| Estimated Cost | _pending live_ | _pending live_ | Astra $10/$50 vs Sol $4/$20 vs Terra $2/$12 |
| Human Preference | _pending live_ | _pending live_ | 盲评，招标类不得放宽证据 |
| Retry Rate | _pending live_ | _pending live_ | 429/超时 |

## 怎么跑 live（人工）

```bash
ENABLE_GPT6_ASTRA=0 npx tsx scripts/gpt6-astra-benchmark.ts
GPT6_ASTRA_BENCHMARK=1 ENABLE_GPT6_ASTRA=1 ENABLE_GPT6_ASTRA_ROLLOUT_PCT=100 \
  npx tsx scripts/gpt6-astra-benchmark.ts
```

对每条 complex 用例：

1. 当前模型跑一遍（flag 关）
2. Astra + 对应 reasoning 跑一遍
3. 记录 usage / latency / schema / 是否 hallucinate 证据
4. 招标类：Evidence Verifier 失败则记 **失败**，即使文笔更好

## 通过门（Final Review 前）

至少：

- 10 complex 中 Astra 成功率 ≥ 当前，且招标 UNKNOWN 纪律不劣化
- tool-heavy 无越权工具
- failure 套件：无无限循环、无重复外部 mutation
- 估算成本：Phase 1 流量可接受（相对 terra/sol）

未完成 live 前，本表保持 pending。这 **不是** 生产全量切换的绿灯。

## 已知费用量级（list price，短上下文）

假设一条 complex 研究 20k in / 4k out：

| 模型 | 估算 USD |
|---|---|
| gpt-5.6-terra | 0.088 |
| gpt-5.6-sol | 0.16 |
| gpt-6-astra | 0.40 |

Astra 必须靠更高成功率或更少重试/更短 output 才能在该档打平。这就是为什么 simple 路径禁止升级。
