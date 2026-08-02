#!/bin/bash
# CI 单元测试子集：不依赖生产库、不执行 migrate、不写业务数据。
# 全量 scripts/test-all.sh 仍可本地运行；CI 保持可观测与时限可控。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "═══════════════════════════════════════════════════"
echo "  青砚 CI unit subset"
echo "═══════════════════════════════════════════════════"

npx tsx scripts/check-release-safety.test.ts
npx tsx src/lib/common/__tests__/with-auth-schema-drift.test.ts
npx tsx src/lib/env/__tests__/runtime-isolation.test.ts
npx tsx src/lib/env/__tests__/runtime-isolation-entrypoints.test.ts
npx tsx scripts/public-route-auth-contracts.test.ts
npx tsx scripts/check-swc-nullish-logical.test.ts
npx tsx scripts/wave15-smoke-readonly.ts --self-check-only

echo ""
echo "CI unit subset PASS"
