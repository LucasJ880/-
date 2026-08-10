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
npx tsx src/lib/workforce-runtime/read-model/__tests__/projection-golden.test.ts
npx tsx src/lib/workforce-runtime/read-model/__tests__/service-read-only.test.ts
npx tsx src/lib/workforce-runtime/read-model/__tests__/api-access.test.ts
npx tsx src/lib/workforce-runtime/read-model/__tests__/list-service.test.ts
npx tsx 'src/app/(main)/workforce/__tests__/operator-ux.test.ts'
npx tsx src/lib/tender-auto-analysis/__tests__/package-fingerprint.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/extract-core.test.ts
npx tsx src/lib/common/__tests__/with-auth-schema-drift.test.ts
npx tsx src/lib/env/__tests__/runtime-isolation.test.ts
npx tsx src/lib/env/__tests__/runtime-isolation-entrypoints.test.ts
npx tsx src/lib/env/__tests__/wave15-seed-target-guard.test.ts
npx tsx scripts/public-route-auth-contracts.test.ts
npx tsx scripts/check-swc-nullish-logical.test.ts
npx tsx src/lib/navigation/__tests__/nav-active-matcher.test.ts
npx tsx src/lib/navigation/__tests__/navigation-ia.test.ts
npx tsx src/lib/navigation/__tests__/navigation-workspace.test.ts
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
npx tsx scripts/wave15-smoke-readonly.ts --self-check-only

echo ""
echo "CI unit subset PASS"
