#!/bin/bash
# CI 单元测试子集：不依赖生产库、不执行 migrate、不写业务数据。
# 全量 scripts/test-all.sh 仍可本地运行；CI 保持可观测与时限可控。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 与 .github/workflows/ci.yml 对齐：runtime-isolation 在非 test 环境默认禁 cron，
# 本地不设 NODE_ENV 会让鉴权契约测试被 503 淹没（CI 绿、本地红）。
export NODE_ENV=test

echo "═══════════════════════════════════════════════════"
echo "  青砚 CI unit subset"
echo "═══════════════════════════════════════════════════"

npx tsx scripts/check-release-safety.test.ts
npx tsx scripts/check-preview-db-isolation.test.ts
npx tsx src/lib/testing/__tests__/assert-safe-test-database.test.ts
npx tsx src/lib/db-safety/__tests__/production-operation-guard.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/enqueue-helpers.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/enqueue-outcome.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/package-ready.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/auto-flags.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/v2-map.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/executive-brief.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/chat-context.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/v2-persist-fence.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/v2-resumable.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/worker-budget-guards.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/tender-identity.test.ts
npx tsx src/lib/tender-analyst/__tests__/analyst-synthesis.test.ts
npx tsx src/lib/projects/generate/__tests__/tender-doc-html.test.ts
npx tsx src/lib/tender-intel/__tests__/canadabuys.test.ts
npx tsx src/lib/tender-intel/__tests__/canadabuys-auto.test.ts
npx tsx src/lib/tender-intel/__tests__/websearch.test.ts
npx tsx src/lib/tender-intel/__tests__/awards.test.ts
npx tsx src/lib/tender-intel/__tests__/award-semantics.test.ts
npx tsx src/lib/tender/__tests__/workbench-state.test.ts
npx tsx src/lib/workforce-runtime/read-model/__tests__/projection-golden.test.ts
npx tsx src/lib/workforce-runtime/read-model/__tests__/service-read-only.test.ts
npx tsx src/lib/workforce-runtime/read-model/__tests__/api-access.test.ts
npx tsx src/lib/workforce-runtime/read-model/__tests__/list-service.test.ts
npx tsx 'src/app/(main)/workforce/__tests__/operator-ux.test.ts'
npx tsx src/lib/tender-workforce/__tests__/t1b-pure.test.ts
npx tsx --test src/lib/corporate-memory/__tests__/t3-schema-contract.test.ts
npx tsx --test src/lib/corporate-memory/__tests__/t3-pure.test.ts
npx tsx --test src/lib/project-finance/__tests__/p15-pure.test.ts
npx tsx --test src/lib/project-finance/__tests__/p15-authz-contract.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/package-fingerprint.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/extract-core.test.ts
npx tsx src/lib/tender-eval/__tests__/eval-harness.test.ts
npx tsx src/lib/tender-understanding/__tests__/v2-generic.test.ts
npx tsx src/lib/tender-understanding/__tests__/v2-hallucination.test.ts
npx tsx src/lib/tender-understanding/__tests__/v2-evidence.test.ts
npx tsx src/lib/common/__tests__/with-auth-schema-drift.test.ts
npx tsx src/lib/env/__tests__/runtime-isolation.test.ts
npx tsx src/lib/env/__tests__/runtime-isolation-entrypoints.test.ts
npx tsx src/lib/env/__tests__/wave15-seed-target-guard.test.ts
npx tsx scripts/public-route-auth-contracts.test.ts
npx tsx scripts/check-swc-nullish-logical.test.ts
npx tsx src/lib/navigation/__tests__/nav-active-matcher.test.ts
npx tsx src/lib/navigation/__tests__/navigation-ia.test.ts
npx tsx src/lib/navigation/__tests__/navigation-workspace.test.ts
npx tsx src/lib/autopilot/__tests__/access.test.ts
npx tsx src/lib/autopilot/__tests__/sanitize.test.ts
npx tsx src/lib/autopilot/__tests__/repository-org.test.ts
npx tsx src/lib/autopilot/__tests__/taxonomy.test.ts
npx tsx src/lib/autopilot/__tests__/instrumentation.test.ts
npx tsx src/lib/autopilot/__tests__/service-access.test.ts
npx tsx src/lib/autopilot/__tests__/security-layers.test.ts
npx tsx src/lib/autopilot/__tests__/durability-matrix.test.ts
npx tsx src/lib/autopilot/__tests__/durability-benchmark.test.ts
npx tsx src/lib/autopilot/__tests__/coverage.test.ts
npx tsx src/lib/autopilot/__tests__/human-signals.test.ts
npx tsx src/lib/agent-core/__tests__/run-hooks.test.ts
npx tsx src/lib/agent-runtime/__tests__/sequence-retry.test.ts
npx tsx src/lib/marketing/__tests__/sales-digital-employee-access.test.ts
npx tsx src/lib/marketing/__tests__/route-access.test.ts
npx tsx src/lib/marketing/__tests__/marketing-middleware-access.test.ts
npx tsx src/lib/marketing/__tests__/activepieces.test.ts
npx tsx src/lib/marketing/__tests__/growth-center.test.ts
npx tsx src/lib/marketing/__tests__/marketing-economics.test.ts
npx tsx --test src/lib/marketing/__tests__/crm-source-attribution.test.ts
npx tsx src/lib/sales/__tests__/archived-customer-visibility.test.ts
npx tsx src/lib/blinds/__tests__/discount-permissions.test.ts
npx tsx src/lib/bid-workflow/__tests__/bid-workflow-phase1.test.ts
npx tsx src/lib/bid-workflow/__tests__/schema-drift.test.ts
npx tsx src/lib/bid-workflow/__tests__/supplier-link-idempotency.test.ts
npx tsx src/lib/bid-workflow/__tests__/china-supplier-brief.test.ts
npx tsx src/lib/tender/__tests__/detail-tabs.test.ts
npx tsx src/components/project-detail/__tests__/tender-detail-ia.test.ts
npx tsx src/components/project-detail/__tests__/project-context-panel.test.ts
npx tsx scripts/wave15-smoke-readonly.ts --self-check-only

echo ""
echo "CI unit subset PASS"
