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

# A-P4 清理：移除 7 个历史虚挂条目（对应测试文件从未提交，见架构升级计划）
# 阶段推进规则 / 阶段→任务联动 / AI 调用监控 / i18n 文案完整性 /
# 报价计算引擎 / 商机生命周期状态机 / Coaching 归因评分
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
run_test "Blob 统一访问层 URL 转换" "npx tsx src/lib/files/__tests__/blob-access.test.ts"
run_test "发布内容规则拦截" "npx tsx src/lib/operations/__tests__/content-rules.test.ts"
run_test "青砚营销分析 Skill 接入" "npx tsx src/lib/agent-core/skills/__tests__/qingyan-marketing-analysis.test.ts"
run_test "市场情报竞品监听规则" "npx tsx src/lib/market-intelligence/__tests__/rules.test.ts"
run_test "销售可视化产品参考资产" "npx tsx src/lib/visualizer/__tests__/catalog-assets.test.ts"

# ── 第二组：TypeScript 编译检查 ──

echo "━━━ TypeScript 编译检查 ━━━"
echo ""

run_test "TypeScript 类型检查" "npx tsc --noEmit"

# ── 第三组：AI 分类测试（如果 scripts/test-work-json.py 存在） ──

if [ -f "scripts/test-work-json.py" ]; then
  echo "━━━ AI 分类基线测试 ━━━"
  echo ""
  # 需要本地服务在跑（BASE_URL 或 localhost:3000），否则跳过而非误报失败
  if curl -s -o /dev/null --max-time 2 "${BASE_URL:-http://localhost:3000}"; then
    run_test "AI 工作事项分类" "python3 scripts/test-work-json.py"
  else
    echo "⏭  跳过 AI 工作事项分类（本地服务未运行，启动 dev server 后重跑）"
    echo ""
  fi
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
