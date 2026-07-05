#!/bin/bash
# ═══════════════════════════════════════════════════════════
# 青砚 全量测试入口
#
# 用法:
#   ./scripts/test-all.sh              # 仅运行纯逻辑测试
#   ./scripts/test-all.sh --api        # 同时运行 API 集成测试
#
# API 集成测试需要环境变量:
#   BASE_URL=http://localhost:3000
#   COOKIE="sid=xxx"                   # 从浏览器复制
#   CRON_SECRET=xxx                    # 可选
# ═══════════════════════════════════════════════════════════

set -e

echo ""
echo "═══════════════════════════════════════════════════"
echo "  青砚 自动化测试"
echo "═══════════════════════════════════════════════════"
echo ""

TOTAL=0
PASS=0
FAIL=0

run_test() {
  local name="$1"
  local cmd="$2"
  echo "▶ $name"
  TOTAL=$((TOTAL + 1))
  if eval "$cmd"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "  ⚠️  $name 失败"
  fi
  echo ""
}

# ── 第一组：纯逻辑测试（无需服务运行） ──

echo "━━━ 第一组：纯逻辑单元测试 ━━━"
echo ""

run_test "阶段推进规则" "npx tsx src/lib/tender/__tests__/stage-transition.test.ts"
run_test "阶段→任务联动" "npx tsx src/lib/tender/__tests__/stage-tasks.test.ts"
run_test "AI 调用监控" "npx tsx src/lib/ai/__tests__/monitor.test.ts"
run_test "i18n 文案完整性" "npx tsx src/lib/i18n/__tests__/zh.test.ts"
run_test "报价计算引擎" "npx tsx src/lib/blinds/__tests__/pricing-engine.test.ts"
run_test "商机生命周期状态机" "npx tsx src/lib/sales/__tests__/opportunity-lifecycle.test.ts"
run_test "Coaching 归因评分" "npx tsx src/lib/sales/__tests__/coaching-scoring.test.ts"
run_test "iLink 媒体纯函数" "npx tsx src/lib/messaging/adapters/__tests__/ilink-media.test.ts"
run_test "iLink 报文解析" "npx tsx src/lib/messaging/adapters/__tests__/ilink-parse.test.ts"
run_test "iLink 出站报文构造" "npx tsx src/lib/messaging/adapters/__tests__/ilink-send-payload.test.ts"
run_test "企业微信回调加解密/验签" "npx tsx src/lib/messaging/adapters/__tests__/wecom-crypto.test.ts"
run_test "外贸受理路由/幂等" "npx tsx src/lib/trade/__tests__/service-intake-correlation.test.ts"
run_test "产品视觉素材 prompt 防错" "npx tsx src/lib/skills/product-visual-builder/__tests__/prompt.test.ts"
run_test "产品视觉素材 dry-run service" "npx tsx src/lib/skills/product-visual-builder/__tests__/service.test.ts"
run_test "产品视觉素材 API 鉴权壳" "npx tsx src/app/api/skills/product-visual-builder/__tests__/route.test.ts"
run_test "产品视觉素材 storage 存储约定" "npx tsx src/lib/skills/product-visual-builder/__tests__/storage.test.ts"
run_test "产品视觉素材 source 上传 API" "npx tsx src/app/api/skills/product-visual-builder/upload/__tests__/route.test.ts"
run_test "产品视觉素材 image-client 封装" "npx tsx src/lib/skills/product-visual-builder/__tests__/image-client.test.ts"

# ── 第二组：TypeScript 编译检查 ──

echo "━━━ TypeScript 编译检查 ━━━"
echo ""

run_test "TypeScript 类型检查" "npx tsc --noEmit"

# ── 第三组：AI 分类测试（如果 scripts/test-work-json.py 存在） ──

if [ -f "scripts/test-work-json.py" ]; then
  echo "━━━ AI 分类基线测试 ━━━"
  echo ""
  run_test "AI 工作事项分类" "python3 scripts/test-work-json.py"
fi

# ── 第四组：API 集成测试（需要 --api 参数） ──

if [ "$1" = "--api" ]; then
  echo "━━━ API 集成测试 ━━━"
  echo ""
  run_test "API 集成测试" "npx tsx scripts/test-api-integration.ts"
fi

# ── 结果汇总 ──

echo "═══════════════════════════════════════════════════"
echo "  测试结果: $PASS/$TOTAL 通过, $FAIL 失败"
echo "═══════════════════════════════════════════════════"
echo ""

if [ $FAIL -gt 0 ]; then
  echo "❌ 有测试失败"
  exit 1
else
  echo "✅ 全部通过"
fi
