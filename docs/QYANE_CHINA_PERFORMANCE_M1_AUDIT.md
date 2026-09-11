# QYANE_CHINA_PERFORMANCE_M1_AUDIT

**Mission:** Mainland China Performance & Latency Audit  
**Mode:** `AUDIT ONLY`  
**Date:** 2026-09-10  
**Baseline commit:** `4070d6d83842427e6318ab92ad7d19f0cc76fbae` (`origin/main`, PR #190 Supplier Intelligence M1-S2)  
**Audit branch:** `audit/qyane-china-performance-m1`  
**Worktree:** `/Users/user/Desktop/青砚-china-perf-m1`  

本轮**没有**迁移 Neon、没有改 Vercel region、没有改 Production env/secrets、没有 merge、没有接中国模型。  
目标是：**先测量、再优化。**

---

## 1. Executive Summary

青砚主应用是 **Next.js 16 App Router 单体**，托管在 **Vercel**，数据在 **Neon PostgreSQL（仓库证据：aws-us-east-1）**，LLM **运行时只有 OpenAI**。仓库里**没有** `preferredRegion` / `iad1` / `hkg1` / `sin1`，因此 **Vercel Function 实际 region = UNKNOWN**（本轮已在 `/api/health` 暴露平台注入的 `VERCEL_REGION`，部署后可确认）。

从中国访问慢，**最像「每一次点击都要跨太平洋打多轮 HTTP」再叠加「页面自己偷偷打 OpenAI」**，而不是先假设「Vercel 和 Neon 不在一个区」。

证据优先级（代码 + 配置，**不是**中国现场 RUM；Sentry `tracesSampleRate: 0`）：

1. **中国 Browser ↔ 美国 Origin 的往返次数过多**（Dashboard / Tender Detail 一次打开 7–11 个 client fetch）。
2. **Tender Detail 打开后 800ms 自动 GET/POST `progress-summary` + `checklist`，空数据时会同步调用 OpenAI**（用户没点「分析」也会等）。
3. **LLM 串行链**（Tender 分窗抽取 + 澄清串行 + Analyst Pass A→B；Trade 研究 Serper→Firecrawl→GPT×2）。
4. **Firecrawl 同步阻塞**（单次研究 map + 3–5 scrape，超时默认 25s）。
5. **绝大多数业务页是 Client Component + `useEffect` 拉数**（先转圈，再 JSON），首屏没有 RSC 数据。
6. **Auth/tenancy 每 API 4–7 次串行 DB**（若 Function 与 Neon 同在 us-east-1，这不是中国慢的主因；若 Function 不在 us-east-1，它会放大）。
7. **Vercel ↔ Neon 跨区：未证实。** Neon 区域证据强（us-east-1）；Vercel 区域未知。

**最终状态：** `READY_FOR_P0_OPTIMIZATION`  
P0 全是低风险代码层（减少往返、去掉静默 LLM、并行、流式、去重），**不需要迁库**。P2 的香港/新加坡节点值得设计，但本轮禁止执行。

---

## 2. Repository State

```text
START_HEAD (user dirty workspace /Users/user/Desktop/青砚)
  branch: feature/sales-quote-cost-foundation
  HEAD:   9f9a43bbdb5e6af61cf56acbfdb7cd7c42c17d94
  status: dirty (vinyl/blinds/sales WIP + untracked docs/incident)
  drift vs origin/main: 72 behind, 0 ahead

ORIGIN_MAIN
  4070d6d83842427e6318ab92ad7d19f0cc76fbae
  Merge pull request #190 from LucasJ880/feature/supplier-intelligence-m1-s2

MAIN_DRIFT
  User working branch is 72 commits behind origin/main and is not this audit branch.

WORKTREE_STATUS
  Did NOT touch the dirty workspace.
  Created git worktree from origin/main:
    /Users/user/Desktop/青砚-china-perf-m1
    branch audit/qyane-china-performance-m1
```

---

## 3. Current Runtime Topology

```text
QYANE_RUNTIME_TOPOLOGY

China / Canada Browser
  → (possible Vercel Edge POP, region UNKNOWN)
  → Vercel Serverless Functions (Node.js; region UNKNOWN — no preferredRegion in repo)
  → Neon PostgreSQL pooled (DATABASE_URL)  region: aws-us-east-1 (docs + hostname fixtures)
  → OpenAI / Firecrawl / Serper / Tavily / Blob / Resend / Google APIs
  → Function → Browser
```

### Frontend

| Item | Finding | Evidence |
|------|---------|----------|
| Next.js | **16.2.0** | `package.json` |
| React | **19.2.4** | `package.json` |
| Router | **App Router only** (151 `page.tsx`, 0 `src/pages`) | `src/app/**/page.tsx` |
| Client pages | **130 / 151** `"use client"` | largest: quote-sheet 2222 lines, trade prospect 2027, assistant 948, projects 933 |
| Server pages | **21** (home gate, bids gate, ops/capabilities, some project intelligence) | e.g. `src/app/(main)/page.tsx` |
| Server Actions | **NONE** | no `"use server"` |
| Middleware | JWT cookie `qy_session`; no explicit runtime export (framework Edge) | `src/middleware.ts` |
| Edge Runtime routes | **NONE** (`runtime = "edge"` not found) | grep |
| Explicit Node runtime | 6 routes (health, tts, transcribe, quote advise, analyst-memo, trade webhook) | `export const runtime = "nodejs"` |
| API Route Handlers | **622** `src/app/api/**/route.ts` | |
| Streaming / SSE | Assistant + `/api/ai/chat` + dispatch/retry | `text/event-stream` |
| AI SDK `streamText` | **NONE** | custom OpenAI SDK streams |

### Hosting

| Item | Finding |
|------|---------|
| Vercel | Yes (`docs/DEPLOY_VERCEL.md`, `vercel.json`, `VERCEL_*` usage) |
| `vercel.json` | **Only `crons` (22 jobs)** — no `regions`, no `functions` |
| `preferredRegion` | **not in repo** |
| Function region codes (`iad1`/`hkg1`/`sin1`/`hnd1`/`sfo1`) | **not in repo → UNKNOWN until live `VERCEL_REGION`** |
| Cron | Vercel crons (agent-runs / tender-auto-analysis every 2 min, etc.) |
| Background workers | `scripts/wechat-worker.ts`; `deploy/postiz`, `deploy/postflow-worker`, `deploy/activepieces`, `deploy/meridian-worker` (旁路，非 Vercel 请求路径) |
| Dockerfile / Fly / Railway | **none** for the main app |

---

## 4. Vercel Region Findings

```text
VERCEL_FUNCTION_REGION = UNKNOWN (static config)
```

**How to confirm safely (no env mutation):**

1. Vercel Dashboard → Project → Settings → Functions → Regions.
2. After this PR deploys: `GET /api/health` → `checks.vercelRegion` (reads platform-injected `VERCEL_REGION` only).
3. Vercel function logs: `VERCEL_REGION`.

**Inference that is NOT a confirmation:** Vercel 默认新项目常见 `iad1`（华盛顿 / us-east-1）。本仓库**没有**写死，不能当生产事实。

Sentry traces 采样为 **0**（`src/instrumentation.ts`），现有 APM **无法**回答中国 RTT。

---

## 5. Database Region Findings

```text
Production DB:
  Provider: Neon PostgreSQL
  Region: aws-us-east-1          (docs + hostname fixtures; live still re-check)
  Connection: pooled (DATABASE_URL) + direct (DIRECT_URL)
  ORM: Prisma 6.19.2
  Accelerate / Data Proxy: not used

Staging DB:
  Provider: Neon
  Region: aws-us-east-1
  Endpoint prefix (docs/fixtures): ep-floral-sea-au07ycff
  Connection: pooled/direct split same as prod
```

证据（脱敏）：

- `prisma/schema.prisma`：`provider = postgresql`, `url = env("DATABASE_URL")`, `directUrl = env("DIRECT_URL")`
- `.env.example`：Pooled → `DATABASE_URL`，Direct → `DIRECT_URL`
- `docs/PHASE5D_STEP_A_PREFLIGHT_REPORT.md`：Region `aws-us-east-1`
- `docs/QINGYAN_WAVE15_STAGING_ISOLATION.md`：staging `aws-us-east-1`
- Host 夹具形态：`*.us-east-1.aws.neon.tech`（测试与运维文档；本报告不打印完整连接串）

Client：`src/lib/db.ts` 模块单例；生产不挂 `globalThis`。

`DB_REGION` 若 live hostname 区段变化：以 Neon Console / `/api/health` `checks.dbRegion` 为准。

**Cold connection：** Serverless + Neon pooler 是已知风险；本轮无生产连接样本，标为 **SUSPECTED, UNMEASURED**。

---

## 6. External Dependency Map

```text
EXTERNAL_DEPENDENCY_MAP
```

| Service | Used By | Request Type | Blocking? | Typical Critical Path? |
| ------- | ------- | ------------ | --------- | ---------------------- |
| OpenAI | `src/lib/ai/client.ts`, agent-core, tender-understanding, trade, visualizer, TTS/STT, embeddings | HTTPS chat/embed/image/audio | Yes | Yes |
| Neon / Postgres | Prisma `src/lib/db.ts` | SQL pooled+direct | Yes | Yes |
| Vercel Blob | files, visualizer, brochures | PUT/GET | Media paths | Media / 画册 |
| Firecrawl | trade research, intelligence scrape, market monitor | POST map/scrape/monitor | Sync on research; async monitor | Trade / intel |
| Serper | trade tools / research | POST search | Yes | Trade research |
| Tavily | tender-intel, supplier-intel, quote advisors (duplicate client) | POST search | Yes | Tender intel when dual-gated |
| Resend | trade email | send | On send | Outreach |
| Gmail / Google Calendar | OAuth + drafts/events | HTTPS | On confirm | Assistant scenarios |
| Upstash Redis | rate-limit only | REST | Short | Not UX critical |
| Sentry | instrumentation | ingest | No | Observability; traces=0 |
| Puppeteer + Chromium | PDF HTML render | local | PDF generate | Quote/project PDF |
| unpdf / mammoth | local parse | local | Tender ingest | No cloud OCR |
| pgvector | Neon | SQL | Search | Knowledge |
| Postiz / Aivora / Activepieces | optional ops/growth | HTTPS | Those products | Off main bid path |
| **Apify** | **not in repo** | — | — | **No** |
| Anthropic / Stripe / Clerk / Pinecone / Cloudflare / AWS S3 / R2 | not used | — | — | — |

**用户一次点击 ≥2 个外部服务：**

| Action | Chain |
|--------|--------|
| Trade 线索「研究」 | Serper → Firecrawl map+3–5 scrape → OpenAI report → OpenAI score |
| Trade 情报调查 | Serper ×N → Firecrawl ≤5 → OpenAI 120s |
| Quote duty advisor | Tavily ×2 → OpenAI |
| Visualizer HD | Blob → OpenAI image → Blob |
| Tender Analyze | 多窗 OpenAI（并发 3）→ 澄清串行 OpenAI → Analyst A→B；默认路径 **无** Firecrawl/Apify |
| Tender Detail 首次打开且无缓存摘要 | 可能 **OpenAI ×2**（progress-summary POST + checklist POST） |

---

## 7. Critical User Journeys

| # | Journey | Actual route | Render | Data loading |
|---|---------|--------------|--------|--------------|
| 1 | Login | `/login` | Client | `POST /api/auth/login` |
| 2 | Dashboard | `/` RSC gate → `ManagementDashboardClient` | Client body | 5–11 parallel/fan-out fetches |
| 3 | Project List | `/projects` | Client | `Promise.all` projects+orgs |
| 4 | Project Detail | `/projects/[id]` | Client | 7 fetches + delayed auto-AI |
| 5 | Tender List | `/bids` RSC gate + `/projects?bidListFilter=` | Mixed | client `/api/projects` |
| 6 | Tender Detail | **same as Project Detail** (5 tabs) | Client | see §10 / Q5 |
| 7 | Supplier Intelligence | `/projects/intelligence` + `/api/supplier-intel/*` (no dedicated intel page component) | Client + API | |
| 8 | Supplier Search | `/suppliers` | Client | **CLIENT_WATERFALL** orgs → suppliers |
| 9 | Quote / Budget | `/projects/[id]/quotes/*`, `/sales/quote-sheet`, `/trade/quotes` | Mostly client | |
| 10 | Company Profile | `/organizations/[orgId]` | Client | org+members+me |
| 11 | AI Chat | `/assistant` SSE; legacy `/api/ai/chat`; `/api/agent-core/chat` JSON | Client | |
| 12 | Agent Run | `/workforce`, `/capabilities/runs`, supervisor APIs | Client | poll/JSON |
| 13 | Tender Analyze | nested in `/projects/[id]` Requirements tab | Client | JSON + 8s poll |
| 14 | Report | `/reports` | Client | `POST /api/reports/weekly` **await full JSON** |
| 15 | PDF | no page; `POST /api/projects/:id/generate-pdf` (`maxDuration=800`) | Server | |

---

## 8. API Latency Analysis

**Measured production p50/p95 from China: UNKNOWN**（本环境无 `.env`、禁止打生产库、Sentry traces=0）。  
下表是 **代码结构预期瓶颈**，不是编造的 42ms。

部署本 PR 后用：

```bash
npm run perf:api -- --base-url http://127.0.0.1:3000
# staging git Preview only, or production with explicit flag:
# npm run perf:api -- --allow-production --base-url https://qingyan.ca
```

浏览器 Network + `Server-Timing` + `x-request-id` 才是中国基线。

| Endpoint | Runtime | Region | DB queries (auth+payload) | External | Sequential | Cache | Expected bottleneck |
|----------|---------|--------|---------------------------|----------|------------|-------|---------------------|
| `GET /api/health` | nodejs | UNKNOWN | 1 (`SELECT 1`) | 0 | n | no-store | China↔origin RTT |
| `GET /api/auth/me` | default node | UNKNOWN | 1 user | 0 | n | **client module cache** + **duplicate callers** | RTT × duplicate |
| `GET /api/projects` | default | UNKNOWN | auth 1–4 + findMany include | 0 | n | none | RTT + list size |
| `GET /api/projects/:id` | default | UNKNOWN | read-access ~4 then fat include | 0 | serial auth then payload | none | payload size + RTT |
| `GET /api/projects/:id/members` | default | UNKNOWN | ~4+ | 0 | | none | extra round trip |
| `GET /api/projects/:id/overview` | default | UNKNOWN | ~4+ | 0 | | none | extra round trip |
| `GET /api/tender-analysis/runs` | default | UNKNOWN | ~4+ | 0 | | none | extra round trip |
| `POST .../tender-analysis/agent` | default | UNKNOWN | many | OpenAI N | windows+clarify+A/B | none | **LLM_SERIAL_CHAIN** |
| `POST /api/reports/weekly` | default | UNKNOWN | per-project | OpenAI × projects | **for-await serial** | none | SERIAL_WATERFALL |
| `POST /api/ai/chat` | default SSE | UNKNOWN | auth+quota | OpenAI stream | 1 | none | TTFT China |
| `POST /api/agent-core/chat` | default JSON | UNKNOWN | tenant chain | OpenAI + tools | tool loop | none | **await fullResult** |
| `POST /api/supplier-intel/runs` | default | UNKNOWN | org + run | Tavily if dual-gated | | none | Tavily |
| Trade `.../research` | default | UNKNOWN | many writes | Serper+Firecrawl+OpenAI×2 | yes | **no crawl cache** | Firecrawl 8–60s |

`GET /api/tenders` **不存在**；招标列表走 `/api/projects`。  
`GET /api/quotes` 不是单门面；报价在 project/sales/trade 多套 API。

---

## 9. Database Query Analysis

Auth 本身：**JWT 无 DB**；随后几乎每个 API `getCurrentUser` → `user.findUnique` **整行**。

| Pattern | Typical serial DB round-trips | Evidence |
|---------|-------------------------------|----------|
| `withAuth` only | 1 | `src/lib/auth/index.ts` |
| `requireOrgRole` | 2 | user + orgMembership |
| `requireProjectReadAccess` | ~4 | user + project + orgM + projectM |
| `withAuth` **then** `requireProject*` (~20 routes) | ~5 | **duplicate getCurrentUser** |
| Capabilities / tenant | ~5–7 | membership/org 再读 |

`$transaction` 在 `src` 约 123 处。交互式事务在跨区 RTT 下会放大；**若 Function 与 Neon 同区，影响远小于中国 HTTP 往返。**

Projects/suppliers list 已 `include`/`_count`，**不是经典 N+1**。  
语义 N+1：`/api/reports/weekly` 按项目循环 `generateProgressSummary`；supplier `classifier` 按 ID 循环 LLM。

**Request-scope cache（不降权限）候选：** `AuthUser`、`orgMembership(orgId,userId)`、`organization` meta。跨请求缓存授权 = `REJECTED`。

---

## 10. Frontend Waterfall Analysis

### SERIAL_WATERFALL（服务端）

1. **`POST /api/reports/weekly`** `for (const project of projects) await generateProgressSummary` — `src/app/api/reports/weekly/route.ts`
2. **Tender clarifications** `for (const item of plan) await resolveClarificationItem` — `clarify.ts`
3. **Analyst synthesis Pass A → Pass B** — `src/lib/tender-analyst/synthesize.ts`
4. **Trade research** Serper → Firecrawl → report LLM → score LLM — `research-service.ts` / `agents.ts`
5. **Trade `processChat`** first completion → tools → final completion
6. **Supervisor engine** one pending step at a time — `agent-supervisor/engine.ts`
7. **Supplier classifier batch** `for id of ids await classifySupplier`
8. **agent-core stream tool loop** `for (const tc of pendingToolCalls) await execute`（非流式路径已 `Promise.all`）
9. **legacy `lib/runtime/agent-runtime.ts`** serial tool_calls
10. **Auth inside each project sub-API**（7 个并行 HTTP，每个内部 4 次串行 DB——服务端瀑布，被 HTTP 扇出放大）

### CLIENT_WATERFALL / UNNECESSARY_CLIENT_FETCH

| Tag | Where |
|-----|--------|
| CLIENT_WATERFALL | `/suppliers`：等 `useOrganizations` 再拉 `/api/suppliers` |
| CLIENT_WATERFALL | Quote editor 页先拉 project name，子组件再拉 quote |
| CLIENT_WATERFALL | Assistant retry 路径 messages → 再 runs |
| UNNECESSARY_CLIENT_FETCH | `/` RSC 已有 session，仍 client 拉 `/api/auth/me`、stats、calendar… |
| UNNECESSARY_CLIENT_FETCH | `/bids` RSC 已鉴权，shell 再拉 projects |
| DUPLICATE_REQUEST | Dashboard `useCurrentUser` **和** `useDashboardData.loadUser` 都打 `/api/auth/me` |
| DUPLICATE_REQUEST | Tender `runs?latest=1` 主载已拉；Requirements tab 的 Panel/Banner 再拉；agent-card 8s poll |
| HIDDEN_LLM_ON_NAVIGATION | `AutoAiPanelsRunner` 打开详情 800ms 后 GET summary+checklist，没有则 **POST（OpenAI）** |

最大的 client 页几乎整页 `"use client"`，`next/dynamic` **几乎只用在 Visualizer**。

---

## 11. LLM Call Analysis

```text
QYANE_LLM_CALL_MAP
```

统一客户端：`src/lib/ai/client.ts`（OpenAI SDK）。  
默认模型（`model-registry/openai.ts`）：chat `gpt-5.6-sol`，reasoning `gpt-5.6-terra`，image `gpt-image-2`。  
ProviderRouter **拒绝非 openai**（`qwen`/`anthropic` 仅类型预留）。

| Feature | Model | Provider | Stream | Timeout | Retry | Tools | Sequential |
|---------|-------|----------|--------|---------|-------|-------|------------|
| `/api/ai/chat` | chat preset | OpenAI | Yes | request signal | none | no | 1 |
| Assistant threads | chat | OpenAI | SSE | | | operator tools | tool rounds |
| Agent core | chat | OpenAI | stream helper unused on HTTP JSON | per-round + total | none | yes | **LLM_SERIAL_CHAIN** rounds |
| Trade research | normal then fast | OpenAI | no | default | none | no | report→score |
| Trade intel | structured | OpenAI | no | 120s | none | no | after crawl |
| Tender windows | reasoning structured | OpenAI | no | 180s/window | 2 attempts | no | concurrency 3, then serial clarify |
| Analyst A/B | structured | OpenAI | no | 240s | 2 | no | A then B |
| Market intel skill | env models | OpenAI | no | 150s/180s | fallback model | skill | primary→fallback |
| Supervisor planner | reasoning→chat | OpenAI | no | ≥45s fallback | JSON repair | plan | planner→steps→summary |
| Embeddings | `text-embedding-3-small` | OpenAI | no | | process LRU | | |
| Image / TTS / STT | image / whisper | OpenAI | no | | | | |

**LLM_SERIAL_CHAIN（用户一动作多次 GPT）：** Tender analyze；Analyst A→B；Trade research；Trade chat；Agent core rounds；Supervisor；Market research fallback；Weekly report × N projects；**Tender detail auto checklist+summary**。

**TTFT：** 本轮 `createChatStream` 对首个可见 `delta.content` 打 `ai.ttft` 日志。SSE 响应头无法带最终 TTFT（流已开始）。非流式路径没有 TTFT，只有 total。

---

## 12. Firecrawl / Apify Analysis

| Feature | Provider | Call count | Timeout | Retry | Sync/Async | Cache | Dedup |
|---------|----------|------------|---------|-------|------------|-------|-------|
| Trade research | Firecrawl | 1 map + 3–5 scrape | 8–60s, default 25s | none | **Sync** | **none** | URL `seen` Set in-request |
| Trade intel pages | Firecrawl | ≤5 scrape | same | none | Sync | none | serper `seenLinks` |
| Market monitor | Firecrawl monitor API | CRUD + webhook | 30s | — | **Async** | Firecrawl-side | product records |

```text
CRAWL_CACHE_CANDIDATE
```

同一 `prospect.website` / 同一供应商根域再次「研究」、batch-research、pipeline 会 **重新 map+scrape**。

**Apify：仓库零引用。**

---

## 13. Agent Runtime Analysis

```text
AGENT_PARALLELIZATION_CANDIDATES
```

| Path | Today | Class |
|------|-------|-------|
| agent-core **non-stream** same-round tools | `Promise.all` | SAFE_TO_PARALLELIZE（已做） |
| agent-core **stream** same-round tools | serial `await` | SAFE_TO_PARALLELIZE for read-only; MUST_BE_SERIAL for writes/approvals |
| legacy project runtime tools | serial | same |
| Supervisor steps | one step + `dependsOn` + approval | REQUIRES_DEPENDENCY / MUST_BE_SERIAL |
| Workforce `parallel.ts` | policy exists; **default MAX_PARALLEL=1** | SAFE_PARALLEL tools can wait for flag; approvals MUST_BE_SERIAL |
| Tender windows | concurrency 3 | already bounded parallel |
| Tender clarifications | serial per ambiguity | REQUIRES_DEPENDENCY (corpus resolve) — limited parallel possible |
| Trade Firecrawl scrapes | sequential skip-on-fail | SAFE_TO_PARALLELIZE with cap |
| Memory / finance / approval tools | — | MUST_BE_SERIAL |

---

## 14. Streaming Readiness

```text
STREAMING_CANDIDATES
```

| Feature | Today | Verdict |
|---------|-------|---------|
| AI Chat (assistant) | SSE | Keep; measure TTFT |
| `/api/ai/chat` | SSE | Keep |
| `/api/agent-core/chat` | **await JSON** | **Must stream** for China TTFT |
| Tender Analyze | JSON + 8s poll | **Must show progress** (SSE or job events) |
| Supplier Search / intel runs | JSON | Stream or job progress |
| Weekly report | full JSON | Stream per-project |
| PDF | long POST | Job + progress, not token stream |
| WebSocket | unused | not required for P0 |

「点击后无反馈」与非流式长任务、以及 Tender 页静默 POST AI **高度吻合**。

---

## 15. Cache Opportunities

现状：无 `unstable_cache` / `revalidateTag`；Upstash **只限流**；embedding 进程内 LRU；`useCurrentUser` 模块缓存。

```text
CACHE_CANDIDATE_MATRIX
```

| Candidate | Cache? | Notes |
|-----------|--------|-------|
| Firecrawl/Serper page by URL hash | Yes | CRAWL_CACHE_CANDIDATE |
| Tender analysis run snapshot | Short TTL per project+user | don't cache approvals |
| Company / org brand context | Yes (already TTL pattern) | |
| Industry taxonomy / static config / province lists | Yes | |
| Embedding vectors | Redis later | |
| Supplier profile (non-financial) | Short TTL | |
| Navigation registry | Yes | |
| **Auth / membership / RBAC** | **No** | REJECTED if shared |
| **Finance / quotes / awards** | **No** or private only | |
| **Approval / pending / locks** | **No** | |
| **Agent run state** | **No cross-user** | |

---

## 16. China Cross-Region Hop Analysis

```text
CROSS_REGION_HOPS  (sorted by hop count, architecture not live traceroute)
```

### Load Dashboard（高）

```text
China → Vercel origin (UNKNOWN, likely US)
  × 8–11 HTTP (stats, me×2, calendar×2, schedule, reminders, briefing, proactive POST, agent tasks, orgs)
each: Function → Neon us-east-1 → Function → China
```

Hop 特征：国际往返次数最多。DB 在服务端，不直连中国。

### Load Tender Detail（很高）

```text
China → Vercel × ~7 GET (project, members, overview, handoff, runs, activity, pending)
+ 800ms later × 2 GET (summary, checklist)
+ if empty: × 2 POST OpenAI  (hidden)
Function → Neon (per API 4–6 queries)
optional Function → OpenAI ×2
→ China
```

### Tender AI Analyze（最高复杂度）

```text
China → Vercel POST agent
Function → Neon (job + docs)
Function → OpenAI × (windows/3 + clarifications + PassA + PassB)
[intel path only] → Tavily / Firecrawl
Function → Neon persist
UI poll every 8s: China → Vercel → Neon → China
```

Firecrawl/Apify 不在默认 Tender Analyze 主链。Trade 研究才是 Firecrawl 主链。

### AI Chat

```text
China → Vercel → (quota DB) → OpenAI stream → Vercel → China
TTFT = China RTT + origin queue + OpenAI first token
```

若未来 `hkg1`/`sin1` Function 仍写 **us-east-1 Neon**，会把 **DB 变成跨区**，可能改善 TTFB、恶化每个查询。P2 必须 **canonical data + regional acceleration**，禁止两套业务库。

---

## 17. Top 10 Performance Bottlenecks

```text
TOP_PERFORMANCE_BOTTLENECKS
```

| Rank | Bottleneck | Impact | Evidence | Fix Difficulty |
| ---- | ---------- | ------ | -------- | -------------- |
| 1 | China↔US HTTP fan-out on Dashboard / Tender Detail | Critical | 7–11 client fetches; 130/151 pages CSR | Low–Med |
| 2 | Hidden LLM on Tender Detail (`AutoAiPanelsRunner`) | Critical | POST summary+checklist if empty after 800ms | Low |
| 3 | LLM serial chains (tender windows+clarify+A/B; trade research; weekly ×N) | High | analyzer/clarify/synthesize/research/weekly | Med |
| 4 | Firecrawl sync in trade research (25s timeout, no cache) | High | `research-fetch-provider.ts` | Med |
| 5 | Non-streaming agent-core / tender poll / weekly JSON | High | `agent-core/chat` JSON; 8s poll | Med |
| 6 | Duplicate `/api/auth/me` and `runs?latest=1` | Med | dashboard hooks; analysis panel | Low |
| 7 | Large client pages, almost no `next/dynamic` | Med | quote-sheet 2k+ lines; lucide everywhere | Med |
| 8 | Auth 4–7 serial DB per API (amplified if region mismatch) | Med | `projects/access.ts`, duplicate `getCurrentUser` | Low (request cache) |
| 9 | Vercel region UNKNOWN; Sentry traces=0 | Med | no preferredRegion; tracesSampleRate 0 | Low (this PR starts probes) |
| 10 | Neon serverless pool / cold start | Low–Med unmeasured | pooler in docs; no live samples | Med |

**不是**本轮证据里的第一名：Apify（不存在）、「必须先迁 Neon」。

---

## 18. P0 Recommendations

不改基础设施、低风险、可立即做（**本轮未做，只建议**）：

1. **禁止导航时静默 POST LLM**（`AutoAiPanelsRunner` 改为可见按钮或明确 progress）。
2. **合并 Tender Detail 首包**（一个 BFF：project+members+overview+handoff+latest run+activity+pending）。
3. **Dashboard 去重 `/api/auth/me`**，RSC 预取 stats 或并行保持但减少重复。
4. **agent-core HTTP 接 `runAgentStream`**；Tender agent 用事件代替纯 8s poll。
5. **Weekly report `Promise.all` 限流并发**（例如 3），不要 10 次串行 GPT。
6. **Request-scope memo `getCurrentUser` / membership**（不跳过授权）。
7. **Firecrawl/Serper URL 缓存**（短 TTL，按 org）。
8. **Bundle：业务页拆分；PDF/konva 保持动态 import。**
9. **部署本 PR 后从中国打 `/api/health` + Server-Timing**，建立 p50/p95 基线。
10. **点击后 200ms 内必须有 UI 反馈**（skeleton / progress），即使后端仍慢。

---

## 19. P1 Recommendations

1. **用 health `vercelRegion` 确认 Function 区；若 ≠ us-east-1，再讨论对齐**（不要先迁库）。
2. 读模型短 TTL 缓存（org 品牌、tender summary、crawl）。
3. 长任务进入现有 Workforce/cron，而不是用户请求内同步 Firecrawl+GPT。
4. 把直连 OpenAI 的旁路（cockpit weekly-report 等）收回 `createCompletion*`。
5. Sentry `tracesSampleRate` 在 staging 开很小采样（例如 0.05），**不要**为了快关掉授权。
6. Model Gateway 接口冻结（见 §22），仍不接 Qwen。

---

## 20. P2 Asia Fast Lane Architecture

```text
                QYANE
                  │
          Global Control Plane
          Auth / Tenant / Approvals / Billing / Agent policy
                  │
       ┌──────────┴──────────┐
       │                     │
 Global Runtime         Asia Fast Lane
 Vercel (confirm live     hkg1 or sin1
  region first)           for TTFB + SSE
       │                     │
       └──── Canonical Data ─┘
            Neon us-east-1 (single truth)
                  │
           Model Gateway
            ┌─────┴─────┐
            │           │
         Global       China lane
         OpenAI       Qwen/Doubao
                      (design only)
```

**香港 vs 新加坡（只设计）：**

| | Hong Kong `hkg1` | Singapore `sin1` |
|--|------------------|------------------|
| 中国大陆 RTT | 通常更好 | 略差于 HK，仍远好于美东 |
| 合规/运营 | 更靠近粤港业务 | 更常见的「亚太合规中立」落点 |
| 与 Neon us-east-1 | **都会增加 DB RTT** | 同左 |
| 建议 | 若用户几乎全在大陆/华南，HK 优先做 **edge/SSE/静态** | 若还服务东南亚买家，sin1 更均衡 |

P2 合理顺序：**先确认 Vercel 现状 → 亚太 Function 只跑只读加速/流式 → 热数据缓存 → 最后才考虑 DB 副本（仍是 replica，不是第二套真相）。**

---

## 21. P3 Mainland China Architecture

允许讨论、本轮不执行：

- 大陆入口 / ICP / 本地模型
- **禁止**「加拿大青砚库」+「中国青砚库」双写分裂
- 必须：`Canonical source of truth + regional acceleration`
- 中国模型只通过 Model Gateway，权限/审批/财务锁仍走全球控制面

---

## 22. Model Gateway Readiness

```text
MODEL_GATEWAY_READINESS = MODERATE_REFACTOR
```

**已有：** `ProviderRouter` + `ModelRegistry` + `AiProviderId` 含 `qwen`；运行时强制 OpenAI。  
**没有：** 按功能选路、中国策略、failover、统一计费探针。  
**耦合点：** 大量 `createCompletion*` / `getClient()`；个别路由直连 OpenAI SDK（cockpit weekly-report）；image-engine 另有 router；quote-engine 重复 Tavily 客户端。

**不是 HIGH_COUPLING**（已有注册表），**不是 READY**（接 Qwen 仍要收口调用点 + policy）。  
本轮 **禁止接 API**。

---

## 23. Risks

| Risk | Mitigation |
|------|------------|
| 为了快而缓存权限 | **REJECTED** |
| 双区双真相 | **REJECTED** |
| 未测就把 Neon 迁亚太 | 可能打乱北美主路径；先测 health |
| Server-Timing 泄漏 | allowlist metric 名 only |
| 基准脚本打到生产 | 默认拒绝；需 `--allow-production` |
| 静默 LLM 费用 | P0 关掉导航自动 POST |
| 本环境无中国 RUM | 状态仍允许 P0，因代码证据足够；p50 数字待部署后补 |

---

## 24. Changes Made

非侵入观测 + 文档 + 只读脚本：

| File | Change |
|------|--------|
| `src/lib/performance/*` | timer, Server-Timing, TTFT, region probe, benchmark policy |
| `src/lib/common/api-helpers.ts` | `withAuth` 增加 `x-request-id`（已有）+ `Server-Timing` + staging perf log |
| `src/app/api/health/route.ts` | `vercelRegion` / `dbRegion` / `dbHostCategory` / `dbPooled`（无连接串） |
| `src/lib/ai/client.ts` | stream TTFT log `ai.ttft` |
| `scripts/performance/benchmark-*.ts` | localhost/staging 默认；生产需显式 flag；不写数据、不跑 LLM |
| `package.json` | `perf:api` / `perf:db` / `perf:external` |
| `.env.example` | `QYANE_PERF_TELEMETRY` 注释（不改生产 env） |
| tests + `test-all.sh` / `test-ci-unit.sh` | 接入 |
| `docs/QYANE_CHINA_PERFORMANCE_M1_AUDIT.md` | 本文件 |

**未改：** Neon、Vercel region、DNS、AuthZ、Agent 行为、Billing、Production secrets。

---

## 25. Tests

本 worktree 无 `.env` / 无隔离测试库。结果：

| Command | Result |
|---------|--------|
| `npx tsx src/lib/performance/__tests__/timing.test.ts` | **40 passed** |
| `npx tsx src/lib/common/__tests__/with-auth-schema-drift.test.ts` | **26 passed**（含 Server-Timing / x-request-id） |
| `npm run lint` | 既有 41 errors / 137 warnings（CI `continue-on-error`）；**本 PR 改动文件 eslint 0 error** |
| `npm run lint:baseline` | **PASS**（无新增 error fingerprint） |
| `npm run typecheck` | **PASS** |
| `npm run test:ci` | **PASS**（含本轮 timing 测试） |
| `npm test` (`test-all.sh`) | **350/362**；失败 12 项全部是 `MISSING_DATABASE_URL` 的隔离 DB 套件（环境无库，非本 PR 引入） |
| `npm run build` | **PASS**（Next.js 16.2.0 webpack） |
| `npm run perf:api -- --base-url http://qingyan.ca` | **exit 2** 拒绝生产（符合设计） |
| `npm run perf:external` | 清单-only，无网络 |

中国现场 p50/p95：**未采集**（AUDIT 禁止打生产写路径；本环境无 staging cookie）。部署 Draft PR 后用国内网络访问 `/api/health` 与带 `Server-Timing` 的 API。

---

## 26. Final Verdict

```text
READY_FOR_P0_OPTIMIZATION
```

不进入 `QYANE_CHINA_PERFORMANCE_M2`，等待人工 review。

理由：代码已经足以确定 **P0 不碰基础设施也能减轻中国体感**（减少跨洋 HTTP、去掉静默 LLM、流式、去重）。Vercel/Neon 是否跨区仍 UNKNOWN，**不能**作为迁库理由。

---

### Q1 — 中国慢主要是什么？

按证据排序：**(1) 前端多次跨洋 fetch + CSR 瀑布** → **(2) 页面/动作触发的 OpenAI 串行与静默调用** → **(3) Trade 路径 Firecrawl** → **(4) 代码 waterfall** → **(5) Vercel 区 UNKNOWN** → **(6) Neon 区已在美东，跨区 DB 未证实**。  
**不是 Apify。** 现场 p50 仍待本 PR 部署后从中国采集。

### Q2 — Vercel Functions 实际 Region？

```text
UNKNOWN
```

仓库无 `preferredRegion`。确认：Dashboard 或 `GET /api/health` → `checks.vercelRegion`。

### Q3 — Production Neon Region？

```text
aws-us-east-1
```

来源：运维文档 + hostname 夹具。Live 以 Console / health `dbRegion` 复核。

### Q4 — Vercel Region ≠ Neon Region？

```text
UNKNOWN
```

Neon 美东证据强。若 live `VERCEL_REGION=iad1`，则 **对齐，不是主因**。若 Function 在 `sfo1`/`hnd1`/`hkg1` 而 DB 在 us-east-1，才会有跨区 DB。

### Q5 — 打开 Tender Detail 实际多少调用？

**HTTP（代码路径，默认 workbench tab）：**

- 并行 7：`GET` project, members, overview, handoff, `tender-analysis/runs?latest=1`, activity, `ai/pending-actions`
- ~800ms 后 2：`GET` progress-summary, checklist
- 若两者皆空：**再 2× POST（OpenAI）**
- 切到 Requirements：再 `runs`、run detail、bid-fit、agent poll（8s）

**DB：** 每个 API 约 4–6 次 tenancy + 1 次业务；粗算首屏 **≥30 次**服务端查询（在 Function↔Neon，不在浏览器直连）。

**External：** 默认 0；无缓存摘要/清单时 **OpenAI ×2**。Firecrawl/Apify：0。

### Q6 — 一次 Tender Analyze？

| Kind | Count (architecture) |
|------|----------------------|
| LLM | windows（并发 3，总数=窗数）+ **串行 clarifications** + Analyst **Pass A + Pass B** + callStructured 最多 2 attempts |
| Firecrawl | 0 on default workforce analyze |
| Apify | 0 |
| DB | job/run/sections/facts/requirements persist — dozens, not 1 |
| HTTP from UI | start POST + status poll 8s |

### Q7 — 最严重 10 个 SERIAL_WATERFALL？

见 §10 列表 1–10。

### Q8 — 最值得 `Promise.all` 的？

1. Weekly report 项目摘要（限流并发）  
2. agent-core **stream** 同轮只读 tools（对齐非流式）  
3. Trade Firecrawl scrape 有上限并行  
4. Tender Detail 不要 7 个 HTTP，而要 1 个聚合  
5. Clarifications 仅在无依赖时有限并行（需小心证据一致性）

### Q9 — 最值得缓存的 10 项？

1. Crawl 页（URL hash）2. Serper 查询 3. Tender run 只读快照 4. Org brand 5. Embeddings 6. 静态地理/税则参考 7. Supplier 非财务档案 8. 导航/枚举 9. PDF 模板资产 10. Market monitor 已抓内容  
禁止：auth、membership、finance、approval、agent lock。

### Q10 — 哪些 Agent Tool 可并行？

**SAFE_TO_PARALLELIZE：** 只读 search / fetch / 同轮无共享写的 tools（agent-core 非流式已做）。  
**REQUIRES_DEPENDENCY：** Supervisor `dependsOn`、clarify-after-extract、report-after-windows。  
**MUST_BE_SERIAL：** approvals、finance、memory writes、job exclusive resources。

### Q11 — 哪些必须 Streaming？

Chat（含 agent-core HTTP）、Tender Analyze 进度、长 Agent run、Weekly report 进度。PDF 用 job 进度即可。

### Q12 — HK / SG / China AI Lane 哪个最合理？

**现在不要迁 DB。**  
1) 先用 health 确认 Vercel region；2) P0 减往返；3) P2 用 **hkg1（大陆体感）或 sin1（亚太平衡）做 Fast Lane + 缓存**；4) China 模型只经 Gateway。  
**China AI Lane 有价值，但排在减少跨洋 HTTP 与静默 LLM 之后。**

---

## QYANE_PERFORMANCE_BUDGET（baseline）

| Class | Target |
|-------|--------|
| Interaction feedback | < 200ms |
| Page shell | < 1s |
| Useful content | < 2s |
| Normal API p50 / p95 | < 300ms / < 800ms |
| DB-only | < 400ms |
| AI UI feedback | < 300ms |
| TTFT | < 2s |
| Long agent | must show progress |

当前架构（中国→美东、多 fetch、同步 LLM）**明显可能达不到** Useful content < 2s。**不要为了达标改真相源。** 先测再改。

---

## CEO SUMMARY

1. **国内慢，首先是「人在中国、系统在美国，而且打开一个页面要来回跑很多趟」。**  
2. **不是「必须先把数据库搬到中国」。** 现有证据里数据库已经在美东；应用跑在哪一栋美国机房还没在仓库里写死。  
3. **最伤体验的产品问题：点进招标详情，页面自己还可能悄悄找 AI 写摘要和清单**——用户没点分析，也会空等、像卡住。  
4. **Dashboard、招标详情用浏览器拼很多接口。** 在加拿大这些接口各自很快；在中国每一趟都要漂太平洋，加起来就慢。  
5. **真要等 AI 时，很多能力会把整篇结果算完才一次性吐出**，所以「首字慢、进度看不见」。聊天其实已经能边生成边出字。  
6. **外贸「研究客户」会搜网页再爬站再写报告，爬虫默认能卡到几十秒，而且同样网址会重复爬。** 招标分析主路径目前不靠 Apify（系统里没有 Apify）。  
7. **代码确实有「一件事做完再做下一件」**（周报逐个项目问 AI、招标澄清逐条问 AI）。这些改并发或合并请求，不必搬服务器。  
8. **地理位置问题是中国到北美的距离；代码问题是把这段距离乘了 7–11 遍，有时再乘上 OpenAI。**  
9. **一两周内最值得做的：合并招标详情请求、禁止打开页面就偷偷跑 AI、聊天/分析要有进度、重复接口去重。**  
10. **不需要为了这次审计迁数据库。** 迁库解决不了「一次打开打十个接口」。  
11. **香港或新加坡节点以后有用**，用来让第一字节更快、AI 文字流回来更顺；但若节点在亚洲、库仍在美东，查库会变慢，所以只能做加速层，不能做成第二套青砚。  
12. **中国模型（通义/豆包）值得作为「国内 AI 车道」设计，现在不要接。** 先把调用收进统一网关，权限和审批不能换一条捷径。  
13. **最优先：先部署这次的计时探针，用国内真实网络看慢在哪一截；同时做上面那些不用搬家的改动。**  
14. **安全底线不变：** 不能为了快缓存登录权限、不能削弱企业隔离、不能绕过审批和财务锁。  
15. **本轮结论：可以开始 P0 优化；不要自动开下一阶段，等你们看过报告。**
