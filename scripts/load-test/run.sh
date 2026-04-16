#!/bin/bash
# 青砚压力测试快速启动脚本
#
# 使用方式：
#   1. 安装 k6: brew install k6
#   2. 获取 session token（登录后从浏览器 Cookie 复制 qy_session 的值）
#   3. 运行：
#      export BASE_URL="http://localhost:3000"
#      export SESSION_TOKEN="你的token"
#      bash scripts/load-test/run.sh [phase]
#
# phase 可选：public | read | write | ai | auth | all

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PHASE="${1:-public}"

if ! command -v k6 &> /dev/null; then
  echo "❌ k6 未安装。请运行: brew install k6"
  exit 1
fi

if [ -z "$BASE_URL" ]; then
  echo "⚠️  BASE_URL 未设置，使用默认 http://localhost:3000"
  export BASE_URL="http://localhost:3000"
fi

run_phase() {
  local name="$1"
  local script="$2"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  运行: $name"
  echo "  目标: $BASE_URL"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  k6 run "$script"
}

case "$PHASE" in
  public)
    run_phase "Phase 1b: 公开页面" "$SCRIPT_DIR/phase1-public.js"
    ;;
  read)
    if [ -z "$SESSION_TOKEN" ]; then
      echo "❌ SESSION_TOKEN 未设置（read 阶段需要登录态）"
      exit 1
    fi
    run_phase "Phase 1: 读接口" "$SCRIPT_DIR/phase1-read.js"
    ;;
  write)
    if [ -z "$SESSION_TOKEN" ]; then
      echo "❌ SESSION_TOKEN 未设置（write 阶段需要登录态）"
      exit 1
    fi
    run_phase "Phase 2: 写接口" "$SCRIPT_DIR/phase2-write.js"
    ;;
  ai)
    if [ -z "$SESSION_TOKEN" ]; then
      echo "❌ SESSION_TOKEN 未设置（AI 阶段需要登录态）"
      exit 1
    fi
    echo "⚠️  AI 压测会消耗 OpenAI token，确认继续？(y/n)"
    read -r confirm
    if [ "$confirm" != "y" ]; then
      echo "已取消"
      exit 0
    fi
    run_phase "Phase 3: AI 接口" "$SCRIPT_DIR/phase3-ai.js"
    ;;
  auth)
    run_phase "Phase 4: 登录限流" "$SCRIPT_DIR/phase4-auth.js"
    ;;
  all)
    run_phase "Phase 1b: 公开页面" "$SCRIPT_DIR/phase1-public.js"
    if [ -n "$SESSION_TOKEN" ]; then
      run_phase "Phase 1: 读接口" "$SCRIPT_DIR/phase1-read.js"
      run_phase "Phase 2: 写接口" "$SCRIPT_DIR/phase2-write.js"
    fi
    run_phase "Phase 4: 登录限流" "$SCRIPT_DIR/phase4-auth.js"
    echo ""
    echo "⚠️  AI 压测已跳过（消耗 token），单独运行: bash scripts/load-test/run.sh ai"
    ;;
  *)
    echo "用法: bash scripts/load-test/run.sh [public|read|write|ai|auth|all]"
    exit 1
    ;;
esac

echo ""
echo "✅ 压测完成"
