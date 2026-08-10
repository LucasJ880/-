#!/bin/bash
# ═══════════════════════════════════════════════════════════
# Workforce 测试批次（Test Isolation Hardening 验收入口）
#
# 在同一个隔离 DB 上按固定顺序连续执行全部 Workforce suites。
# 隔离契约：每个 suite 使用独立 org / users / 幂等键前缀，结束时
# 清理自己拥有的数据 —— 因此本批次可在同一 DB 上重复执行
# （RUN_1 = PASS 且 RUN_2 = PASS），也不要求执行前 DB 为空。
#
# 用法:
#   DATABASE_URL=<隔离分支> NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
#     ./scripts/test-workforce-batch.sh
# ═══════════════════════════════════════════════════════════

set -u

SUITES=(
  "src/lib/workforce-runtime/__tests__/phase2a-job-identity.test.ts"
  "src/lib/workforce-runtime/__tests__/phase2a-lease.test.ts"
  "src/lib/workforce-runtime/__tests__/phase2a-timeout.test.ts"
  "src/lib/workforce-runtime/__tests__/phase2a-approval-resume.test.ts"
  "src/lib/workforce-runtime/__tests__/phase2a-stale-worker.test.ts"
  "src/lib/workforce-runtime/__tests__/phase2a-normal-slices.test.ts"
  "src/lib/workforce-runtime/__tests__/phase2c1-pause-resume.test.ts"
  "src/lib/workforce-runtime/__tests__/phase2c1-expiry-races.test.ts"
  "src/lib/workforce-runtime/__tests__/phase2a-kill-switch.test.ts"
  "src/lib/workforce-runtime/__tests__/phase2b-test-isolation.test.ts"
)

TOTAL=0
FAIL=0
for suite in "${SUITES[@]}"; do
  name=$(basename "$suite" .test.ts)
  echo "▶ $name"
  TOTAL=$((TOTAL + 1))
  if npx tsx "$suite"; then
    echo "  ✅ $name"
  else
    FAIL=$((FAIL + 1))
    echo "  ⚠️  $name 失败"
  fi
  echo ""
done

echo "Workforce batch: $((TOTAL - FAIL))/$TOTAL passed"
[ "$FAIL" -eq 0 ] || exit 1
