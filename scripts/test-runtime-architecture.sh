#!/bin/bash
# QYANE_RUNTIME_CONVERGENCE_T3_5 — R1 architecture guard suite.
# 运行：npm run test:runtime-architecture
# 纯静态：不触 DB / 模型 / 网络 / 生产环境。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "━━━ Runtime Architecture Guards (R1 boundary freeze) ━━━"
npx tsx src/lib/runtime-architecture/__tests__/manifest.test.ts
npx tsx src/lib/runtime-architecture/__tests__/risk.test.ts
npx tsx src/lib/runtime-architecture/__tests__/tool-descriptor.test.ts
npx tsx src/lib/runtime-architecture/__tests__/run-status-inventory.test.ts
npx tsx src/lib/runtime-architecture/__tests__/guards-negative.test.ts
npx tsx src/lib/approval/__tests__/request-facade.test.ts
npx tsx src/lib/runtime-architecture/__tests__/repo-conformance.test.ts
echo "runtime-architecture guards PASS"
