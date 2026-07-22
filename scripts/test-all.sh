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
run_test "Agent Runtime Phase-1" "npx tsx src/lib/agent-runtime/__tests__/runtime.test.ts"
run_test "记忆 org 隔离与 Session 摘要" "npx tsx src/lib/ai/__tests__/memory-org.test.ts"
run_test "记忆 Supersede 时间线" "npx tsx src/lib/ai/__tests__/memory-supersede.test.ts"
run_test "AgentPlan 结构化路由" "npx tsx src/lib/agent-runtime/__tests__/plan.test.ts"
run_test "Agent Phase-B 调度与队列" "npx tsx src/lib/agent-runtime/__tests__/phase-b.test.ts"
run_test "Agent Trace 只读查询" "npx tsx src/lib/agent-runtime/__tests__/trace.test.ts"
run_test "Agent 工作台深链" "npx tsx src/lib/agent-runtime/__tests__/workbench-link.test.ts"
run_test "项目价格差距计算" "npx tsx src/lib/projects/__tests__/price-gap.test.ts"
run_test "项目复盘终态映射" "npx tsx src/lib/projects/__tests__/review-outcome.test.ts"
run_test "企业规则标签分类" "npx tsx src/lib/projects/__tests__/org-rules-categorize.test.ts"
run_test "招标结果标记与价格样例" "npx tsx src/lib/projects/__tests__/tender-result.test.ts"
run_test "文档元数据日期归类" "npx tsx src/lib/projects/__tests__/apply-document-metadata.test.ts"
run_test "外贸受理路由/幂等" "npx tsx src/lib/trade/__tests__/service-intake-correlation.test.ts"
run_test "产品视觉素材 prompt 防错" "npx tsx src/lib/skills/product-visual-builder/__tests__/prompt.test.ts"
run_test "产品视觉素材 dry-run service" "npx tsx src/lib/skills/product-visual-builder/__tests__/service.test.ts"
run_test "产品视觉素材 API 鉴权壳" "npx tsx src/app/api/skills/product-visual-builder/__tests__/route.test.ts"
run_test "产品视觉素材 storage 存储约定" "npx tsx src/lib/skills/product-visual-builder/__tests__/storage.test.ts"
run_test "产品视觉素材 source 上传 API" "npx tsx src/app/api/skills/product-visual-builder/upload/__tests__/route.test.ts"
run_test "产品视觉素材 image-client 封装" "npx tsx src/lib/skills/product-visual-builder/__tests__/image-client.test.ts"
run_test "Blob 统一访问层 URL 转换" "npx tsx src/lib/files/__tests__/blob-access.test.ts"
run_test "多租户 TenantContext/模块" "npx tsx src/lib/tenancy/__tests__/tenant-context.test.ts"
run_test "多租户数据隔离断言" "npx tsx src/lib/tenancy/__tests__/tenant-isolation.test.ts"
run_test "多租户文件 pathname 声明" "npx tsx src/lib/tenancy/__tests__/tenant-file-access.test.ts"
run_test "Phase2A 规则/Pack/工具权限" "npx tsx src/lib/tenancy/__tests__/phase2a-rules-tools.test.ts"
run_test "解锁码 bcrypt 与跨租户隔离" "npx tsx src/lib/blinds/__tests__/unlock-code.test.ts"
run_test "Phase2B 企业语义隔离" "npx tsx src/lib/tenancy/__tests__/phase2b-semantics.test.ts"
run_test "Phase3A-1 Trace Read Model" "npx tsx src/lib/capabilities/__tests__/phase3a1-trace-read-model.test.ts"
run_test "Phase3A-2 Runs and Usage Ledger" "npx tsx src/lib/capabilities/__tests__/phase3a2-runs-and-usage.test.ts"
run_test "Phase3A-2 Ledger DB" "npx tsx src/lib/capabilities/__tests__/phase3a2-ledger-db.test.ts"
run_test "Phase3A-2 Smoke Access" "npx tsx src/lib/capabilities/__tests__/phase3a2-smoke-access.test.ts"
run_test "Phase3A-3 Approvals RBAC" "npx tsx src/lib/capabilities/__tests__/phase3a3-approvals-rbac.test.ts"
run_test "Phase3A-3 Approvals Smoke" "npx tsx src/lib/capabilities/__tests__/phase3a3-approvals-smoke.test.ts"
run_test "Phase3A-4 Governance Logic" "npx tsx src/lib/capabilities/__tests__/phase3a4-governance.test.ts"
run_test "Phase3A-4 Governance Smoke" "npx tsx src/lib/capabilities/__tests__/phase3a4-governance-smoke.test.ts"
run_test "Phase3A-4 Acceptance" "npx tsx src/lib/capabilities/__tests__/phase3a4-acceptance.test.ts"
run_test "Navigation IA" "npx tsx src/lib/navigation/__tests__/navigation-ia.test.ts"
run_test "Phase3A-5 Stream/Settle Unit" "npx tsx src/lib/capabilities/__tests__/phase3a5-stream-settle.test.ts"
run_test "Phase3A-5 Settle DB" "npx tsx src/lib/capabilities/__tests__/phase3a5-settle-db.test.ts"
run_test "Phase3A-5 Catalog/Health" "npx tsx src/lib/capabilities/__tests__/phase3a5-catalog-health.test.ts"
run_test "发布内容规则拦截" "npx tsx src/lib/operations/__tests__/content-rules.test.ts"
run_test "Postiz Cloud 自动发布" "npx tsx src/lib/operations/__tests__/postiz.test.ts"
run_test "青砚营销分析 Skill 接入" "npx tsx src/lib/agent-core/skills/__tests__/qingyan-marketing-analysis.test.ts"
run_test "企业数字员工技能结构/安全" "npx tsx src/lib/agent-core/skills/__tests__/enterprise-skills.test.ts"
run_test "技能PendingAction提案桥" "npx tsx src/lib/agent-core/skills/__tests__/pending-action-bridge.test.ts"
run_test "销售数字员工技能" "npx tsx src/lib/agent-core/skills/__tests__/sales-skills.test.ts"
run_test "投标数字员工技能" "npx tsx src/lib/agent-core/skills/__tests__/tender-skills.test.ts"
run_test "营销增长数字员工技能" "npx tsx src/lib/agent-core/skills/__tests__/marketing-growth-skills.test.ts"
run_test "营销 Phase2 技能结构/路由" "npx tsx src/lib/agent-core/skills/__tests__/marketing-phase2-skills.test.ts"
run_test "Product Marketing Context" "npx tsx src/lib/marketing/__tests__/product-marketing-context.test.ts"
run_test "营销工具 org 隔离" "npx tsx src/lib/agent-core/tools/__tests__/marketing-tools-org-isolation.test.ts"
run_test "营销 PendingAction 提案桥" "npx tsx src/lib/pending-actions/__tests__/marketing-proposal-bridge.test.ts"
run_test "Supervisor 复杂度路由" "npx tsx src/lib/agent-supervisor/__tests__/complexity-router.test.ts"
run_test "Supervisor Worker 白名单" "npx tsx src/lib/agent-supervisor/__tests__/worker-registry.test.ts"
run_test "Supervisor 计划校验" "npx tsx src/lib/agent-supervisor/__tests__/plan-validator.test.ts"
run_test "Supervisor Graph 路由" "npx tsx src/lib/agent-supervisor/__tests__/graph-routing.test.ts"
run_test "Supervisor 预算限制" "npx tsx src/lib/agent-supervisor/__tests__/limits.test.ts"
run_test "Supervisor 组织隔离约定" "npx tsx src/lib/agent-supervisor/__tests__/org-isolation.test.ts"
run_test "Supervisor 审批恢复约定" "npx tsx src/lib/agent-supervisor/__tests__/approval-resume.test.ts"
run_test "Supervisor Schema" "npx tsx src/lib/agent-supervisor/__tests__/state.test.ts"
run_test "Supervisor Replanner" "npx tsx src/lib/agent-supervisor/__tests__/replanner.test.ts"
run_test "Supervisor Feature Flag" "npx tsx src/lib/agent-supervisor/__tests__/feature-flags.test.ts"
run_test "Supervisor Fake Model E2E" "npx tsx src/lib/agent-supervisor/__tests__/fake-model-e2e.test.ts"
run_test "Supervisor Model Resolution" "npx tsx src/lib/agent-supervisor/__tests__/model-resolution.test.ts"
run_test "Supervisor Model Fallback" "npx tsx src/lib/agent-supervisor/__tests__/model-fallback.test.ts"
run_test "Supervisor Summary Schema" "npx tsx src/lib/agent-supervisor/__tests__/summary-schema.test.ts"
run_test "Supervisor Summary Validator" "npx tsx src/lib/agent-supervisor/__tests__/summary-validator.test.ts"
run_test "Supervisor Summary Pending" "npx tsx src/lib/agent-supervisor/__tests__/summary-pending-action.test.ts"
run_test "Supervisor Summary Rejected" "npx tsx src/lib/agent-supervisor/__tests__/summary-rejected-action.test.ts"
run_test "Supervisor Summary Knowledge" "npx tsx src/lib/agent-supervisor/__tests__/summary-degraded-knowledge.test.ts"
run_test "Supervisor Dynamic Replan" "npx tsx src/lib/agent-supervisor/__tests__/dynamic-replan.test.ts"
run_test "Employee AI Feature Flag" "npx tsx src/lib/employee-ai/__tests__/feature-flags.test.ts"
run_test "Employee AI Diff/隐私/权限" "npx tsx src/lib/employee-ai/__tests__/diff-and-privacy.test.ts"
run_test "Employee AI 候选方法边界" "npx tsx src/lib/employee-ai/__tests__/practice-and-playbook.test.ts"
run_test "Employee AI 静态验收" "npx tsx scripts/verify-employee-ai-learning.ts"
run_test "Employee AI Fake E2E" "npx tsx scripts/e2e-employee-ai-controlled.ts"
run_test "产品内容事实优先级/冲突" "npx tsx src/lib/product-content/__tests__/priority-conflict.test.ts"
run_test "产品内容审批策略" "npx tsx src/lib/product-content/__tests__/approval-policy.test.ts"
run_test "产品内容任务状态机" "npx tsx src/lib/product-content/__tests__/status-machine.test.ts"
run_test "产品内容 Fidelity QA" "npx tsx src/lib/product-content/__tests__/fidelity-qa.test.ts"
run_test "产品内容多模态 QA 合并" "npx tsx src/lib/product-content/__tests__/multimodal-merge.test.ts"
run_test "图像引擎 buffer 证明" "npx tsx src/lib/image-engine/__tests__/buffer-proof.test.ts"
run_test "产品内容家纺缺失字段" "npx tsx src/lib/product-content/__tests__/home-textile-missing.test.ts"
run_test "产品内容多模态QA合并" "npx tsx src/lib/product-content/__tests__/multimodal-merge.test.ts"
run_test "Image Engine buffer 证明" "npx tsx src/lib/image-engine/__tests__/buffer-proof.test.ts"
run_test "Image Engine FormData 传图证明" "npx tsx src/lib/image-engine/__tests__/provider-formdata-proof.test.ts"
run_test "模型配置检查" "npx tsx scripts/check-model-config.ts"
run_test "市场情报竞品监听规则" "npx tsx src/lib/market-intelligence/__tests__/rules.test.ts"
run_test "市场情报深度研究模型与超时配置" "npx tsx src/lib/market-intelligence/__tests__/research-runtime.test.ts"
run_test "销售可视化产品参考资产" "npx tsx src/lib/visualizer/__tests__/catalog-assets.test.ts"
run_test "自动流本地时区调度" "npx tsx src/lib/automation/__tests__/local-time.test.ts"
run_test "通用对话日历工具权限" "npx tsx src/lib/agent-core/tools/calendar-access.test.ts"
run_test "工具调用模型参数适配" "npx tsx src/lib/ai/__tests__/client-tuning.test.ts"
run_test "Growth Center 企业事实/评分/计划" "npx tsx src/lib/marketing/__tests__/growth-center.test.ts"
run_test "Growth Center 研究转计划/团队审批隔离" "npx tsx src/lib/marketing/__tests__/research-plan.test.ts"
run_test "Growth Center Activepieces 签名与配置" "npx tsx src/lib/marketing/__tests__/activepieces.test.ts"

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
