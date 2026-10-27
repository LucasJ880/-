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
npx tsx src/lib/db-safety/__tests__/b0-production-guard.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/enqueue-helpers.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/enqueue-outcome.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/package-ready.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/auto-flags.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/v2-map.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/executive-brief.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/chat-context.test.ts
npx tsx src/lib/trade/__tests__/chat-attachments.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/v2-persist-fence.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/v2-resumable.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/document-units.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/alerts.test.ts
npx tsx src/lib/release/__tests__/drift.test.ts
npx tsx src/lib/tender-understanding/__tests__/extract-prompt-locator.test.ts
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
npx tsx src/lib/workforce-runtime/__tests__/t5-plan-seam.test.ts
npx tsx src/lib/workforce-runtime/__tests__/t5-execution-policy.test.ts
npx tsx src/lib/tender-workforce/__tests__/t5-seg2-v2-spine.test.ts
npx tsx src/lib/workforce-runtime/__tests__/t5-seg25-work-domain.test.ts
npx tsx src/lib/tender-workforce/__tests__/t5-seg3-v2-convergence.test.ts
npx tsx src/lib/tender-workforce/__tests__/t5-p11-resumability.test.ts
npx tsx src/lib/workforce-runtime/__tests__/obs-p1-latency-self-trigger.test.ts
npx tsx src/lib/assistant/__tests__/durable-followup-pure.test.ts
npx tsx src/components/assistant/__tests__/followup-outcome-render.test.tsx
npx tsx src/lib/tender-intel/__tests__/obs-p5-intel-loop.test.ts
npx tsx src/lib/tender-intel/__tests__/intel-slots-p1p2.test.ts
npx tsx src/lib/tender-intel/__tests__/intel-auto-flow.test.ts
npx tsx src/lib/pdf/__tests__/cjk-pdf.test.ts
npx tsx src/components/project-detail/__tests__/workbench-command-deck.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/obs-p2p3-single-pipeline.test.ts
npx tsx src/lib/tender-intel/__tests__/bid-strategy-memo.test.ts
npx tsx src/lib/tender-intel/__tests__/intel-ops.test.ts
npx tsx src/lib/tender-understanding/__tests__/taxonomy-p2.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/bid-fit-usability.test.ts
npx tsx src/lib/tender-pricing/__tests__/pricing-helper.test.ts
npx tsx src/lib/projects/generate/__tests__/rfi-export.test.ts
npx tsx src/lib/tender-bid-draft/__tests__/bid-draft.test.ts
npx tsx src/lib/tender-compliance-memory/__tests__/compliance-memory.test.ts
npx tsx src/lib/tender-profile/__tests__/tender-profile.test.ts
npx tsx src/lib/quote-engine/__tests__/quote-calc.test.ts
npx tsx src/lib/quote-engine/__tests__/quote-engine-contract.test.ts
npx tsx src/lib/quote-engine/__tests__/quote-import.test.ts
npx tsx src/lib/quote-engine/__tests__/quote-ops-customer.test.ts
npx tsx src/lib/quote-engine/__tests__/quote-ops-contract.test.ts
npx tsx src/lib/project-finance/__tests__/performance.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/obs-p4-page-limit.test.ts
npx tsx --test src/lib/corporate-memory/__tests__/t3-schema-contract.test.ts
npx tsx --test src/lib/corporate-memory/__tests__/t3-pure.test.ts
npx tsx --test src/lib/project-finance/__tests__/p15-pure.test.ts
npx tsx --test src/lib/project-finance/__tests__/p15-authz-contract.test.ts
npx tsx --test src/lib/project-finance/__tests__/p16-pure.test.ts
npx tsx --test src/lib/project-finance/__tests__/p16-authz-contract.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/package-fingerprint.test.ts
npx tsx src/lib/tender-auto-analysis/__tests__/extract-core.test.ts
npx tsx src/lib/tender-eval/__tests__/eval-harness.test.ts
npx tsx src/lib/tender-understanding/__tests__/addendum-disposition.test.ts
npx tsx src/lib/tender-understanding/__tests__/input-completeness.test.ts
npx tsx src/lib/tender-understanding/__tests__/org-context.test.ts
npx tsx src/lib/tender-understanding/__tests__/v2-generic.test.ts
npx tsx src/lib/tender-understanding/__tests__/v2-hallucination.test.ts
npx tsx src/lib/tender-understanding/__tests__/v2-evidence.test.ts
npx tsx src/lib/common/__tests__/with-auth-schema-drift.test.ts
npx tsx src/lib/env/__tests__/runtime-isolation.test.ts
npx tsx src/lib/env/__tests__/runtime-isolation-entrypoints.test.ts
npx tsx src/lib/env/__tests__/wave15-seed-target-guard.test.ts
npx tsx scripts/public-route-auth-contracts.test.ts
npx tsx src/lib/automation/__tests__/local-time.test.ts
npx tsx src/lib/automation/__tests__/org-timezone.test.ts
npx tsx src/lib/trade/__tests__/daily-cron-org-scope.isolated.test.ts
npx tsx scripts/check-swc-nullish-logical.test.ts
npx tsx src/lib/navigation/__tests__/nav-active-matcher.test.ts
npx tsx src/lib/navigation/__tests__/navigation-ia.test.ts
npx tsx src/lib/tenancy/__tests__/tenant-context.test.ts
npx tsx src/lib/trade/__tests__/outreach-sequence.test.ts
npx tsx src/lib/trade/__tests__/product-sample.test.ts
npx tsx src/lib/trade/__tests__/website-inquiry.test.ts
npx tsx src/lib/trade/__tests__/website-inquiry-async.test.ts
npx tsx src/lib/trade/__tests__/booth-cards.test.ts
npx tsx src/lib/trade/__tests__/booth-summary.test.ts
npx tsx src/lib/trade/__tests__/style-references.test.ts
npx tsx src/lib/trade/__tests__/email-sender.test.ts
npx tsx src/lib/trade/__tests__/booth-cards-db.isolated.test.ts
npx tsx src/lib/trade/__tests__/website-inquiry-async-db.isolated.test.ts
npx tsx src/lib/trade/__tests__/embed-intake.test.ts
npx tsx src/lib/trade/__tests__/embed-intake-db.isolated.test.ts
npx tsx src/lib/trade/__tests__/email-forward-parse.test.ts
npx tsx src/lib/trade/__tests__/email-inbound.test.ts
npx tsx src/lib/trade/__tests__/email-inbound-db.isolated.test.ts
# WhatsApp / 微信来信进 Revenue Spine + 电话 E.164 去重（PRD F2.2–F2.4；DB e2e 无隔离库自动跳过）
npx tsx src/lib/revenue-spine/__tests__/phone-match.test.ts
npx tsx src/lib/trade/__tests__/whatsapp-inbound.test.ts
npx tsx src/lib/trade/__tests__/channels-to-spine-db.isolated.test.ts
# WhatsApp phoneNumberId / 公众号原始 ID 跨组织唯一（保存时检查 + 上线前检查脚本；DB 测试无隔离库自动跳过）
npx tsx src/lib/trade/__tests__/inbound-org.test.ts
npx tsx src/lib/trade/__tests__/channel-inbound-id-db.isolated.test.ts
npx tsx src/lib/trade/__tests__/inbox-service.test.ts
npx tsx src/lib/trade/__tests__/inquiry-rules.test.ts
npx tsx src/lib/trade/__tests__/inquiry-sla.test.ts
npx tsx src/lib/trade/__tests__/inquiry-design-rules.test.ts
npx tsx src/lib/navigation/__tests__/trade-layout.test.ts
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
npx tsx src/lib/autopilot/__tests__/observe-dashboard.test.ts
npx tsx src/lib/autopilot/__tests__/evaluate.test.ts
npx tsx src/lib/autopilot/__tests__/evaluate-dashboard.test.ts
npx tsx src/lib/autopilot/__tests__/evaluate-judge.test.ts
npx tsx src/lib/autopilot/__tests__/a2p2-contract.test.ts
npx tsx src/lib/autopilot/__tests__/a2p2-routing.test.ts
npx tsx src/lib/autopilot/__tests__/a2p2-evidence-privacy.test.ts
npx tsx src/lib/autopilot/__tests__/a2p2-evidence-builder.test.ts
npx tsx src/lib/autopilot/__tests__/a2p2-evidence-sufficiency.test.ts
npx tsx src/lib/autopilot/__tests__/a2p2-evidence-tender-adapter.test.ts
npx tsx src/lib/autopilot/__tests__/a2p2-semantic-judge-input.test.ts
npx tsx src/lib/autopilot/__tests__/a2p2-semantic-judge-parser.test.ts
npx tsx src/lib/autopilot/__tests__/a2p2-semantic-judge-gate.test.ts
npx tsx src/lib/autopilot/__tests__/a2p2-semantic-judge.test.ts
npx tsx src/lib/autopilot/__tests__/a2p2-recovery-select.test.ts
npx tsx src/lib/autopilot/__tests__/a2p2-recovery-loop.test.ts
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
npx tsx src/lib/sales/__tests__/action-notify.test.ts
npx tsx src/lib/notifications/__tests__/delivery-gate.test.ts
npx tsx src/lib/blinds/__tests__/discount-permissions.test.ts
npx tsx src/lib/blinds/__tests__/quote-fees.test.ts
npx tsx src/lib/blinds/__tests__/cost-rates.test.ts
npx tsx src/lib/blinds/__tests__/deduction-rules.test.ts
npx tsx src/lib/vinyl/__tests__/vinyl-engine.test.ts
npx tsx src/lib/work-orders/__tests__/from-quote-mapping.test.ts
npx tsx src/lib/visualizer/__tests__/render-job.test.ts
npx tsx src/lib/visualizer/__tests__/texture-fill.test.ts
npx tsx src/lib/bid-workflow/__tests__/bid-workflow-phase1.test.ts
npx tsx src/lib/bid-workflow/__tests__/schema-drift.test.ts
npx tsx src/lib/bid-workflow/__tests__/supplier-link-idempotency.test.ts
npx tsx src/lib/bid-workflow/__tests__/china-supplier-brief.test.ts
npx tsx src/lib/tender/__tests__/detail-tabs.test.ts
npx tsx src/components/project-detail/__tests__/tender-detail-ia.test.ts
npx tsx src/components/project-detail/__tests__/project-context-panel.test.ts
npx tsx src/lib/mention-gateway/__tests__/m0-safety-gate.test.ts
npx tsx src/lib/mention-gateway/__tests__/m1-gateway.test.ts
npx tsx src/lib/mention-gateway/__tests__/m1-tool-policy.test.ts
npx tsx src/lib/mention-gateway/__tests__/m1-static-policy.test.ts
npx tsx src/lib/mention-gateway/__tests__/m1-final-review.test.ts
npx tsx src/lib/tenancy/__tests__/b1-tenant-authz.test.ts
npx tsx src/lib/agent-core/__tests__/b1-tenant-context-static.test.ts
npx tsx src/lib/pending-actions/__tests__/b2-approval-cas-static.test.ts
npx tsx src/lib/pending-actions/__tests__/b2-approval-cas.isolated.test.ts
npx tsx src/lib/quote-engine/__tests__/b3-ledger-producer.test.ts
npx tsx src/lib/quote-engine/__tests__/b3-ledger-producer.isolated.test.ts
npx tsx src/lib/tender-bid-draft/__tests__/b4-memory-gate-static.test.ts
npx tsx src/lib/tender-bid-draft/__tests__/b4-memory-gate.isolated.test.ts
npx tsx src/lib/agent-runtime/__tests__/b5-supervisor-cancel-static.test.ts
npx tsx src/lib/agent-runtime/__tests__/b5-supervisor-cancel.isolated.test.ts
npx tsx src/lib/agent-runtime/__tests__/concurrency-slot-release.isolated.test.ts
npx tsx src/lib/mention-gateway/__tests__/m2c-tool-policy.test.ts
npx tsx src/lib/mention-gateway/__tests__/m2a-identity-policy.test.ts
# Supplier Intelligence M1-S1（DB 套件无 DATABASE_URL 时自跳过）
npx tsx src/lib/supplier-intel/__tests__/score-contract.test.ts
npx tsx src/lib/supplier-intel/__tests__/submission-parser.test.ts
npx tsx src/lib/supplier-intel/__tests__/governance.test.ts
npx tsx src/lib/supplier-intel/__tests__/supplier-intel-db.isolated.test.ts
npx tsx src/lib/supplier-intel/__tests__/search-brief.test.ts
npx tsx src/lib/supplier-intel/__tests__/providers-policy.test.ts
npx tsx src/lib/supplier-intel/__tests__/adapters.test.ts
npx tsx src/lib/supplier-intel/__tests__/entity-resolution.test.ts
npx tsx src/lib/supplier-intel/__tests__/supplier-intel-s2-db.isolated.test.ts
npx tsx src/lib/supplier-intel/__tests__/supplier-intel-s2fr-db.isolated.test.ts
# Supplier Intelligence M1-S2 Final Remediation（BL-2/BL-3/BL-4：纯核在 CI 真实执行；DB 套件无隔离库自跳过）
npx tsx src/lib/supplier-intel/__tests__/identity-scan.test.ts
npx tsx src/lib/supplier-intel/__tests__/egress-plan.test.ts
npx tsx src/lib/supplier-intel/__tests__/run-finalization.test.ts
npx tsx src/lib/supplier-intel/__tests__/supplier-intel-s2rem-db.isolated.test.ts

# Supplier Intelligence S2 Trust-Boundary Closure（R1 信号项目 ACL / R2 canonical 来源判定）
npx tsx src/lib/supplier-intel/__tests__/signal-scope.test.ts
npx tsx src/lib/supplier-intel/__tests__/canonical-source.test.ts
npx tsx src/lib/supplier-intel/__tests__/supplier-intel-s2tb-db.isolated.test.ts

# Supplier Intelligence S3-A 国内采购工作台（纯核在 CI 真实执行；DB 套件无隔离库自跳过）
npx tsx src/lib/supplier-intel/__tests__/procurement-view.test.ts

# S3-A Final Review 整改（FR1 执行声明所有权 / FR2 异步上下文隔离）
npx tsx src/lib/supplier-intel/__tests__/run-execution-claim.test.ts
npx tsx src/lib/supplier-intel/__tests__/scope-guard.test.ts

# S4-A 强制项硬门 / 确定性匹配（纯核）
npx tsx src/lib/supplier-intel/__tests__/mandatory-gate.test.ts
npx tsx src/lib/supplier-intel/__tests__/deterministic-match.test.ts

# S3-B 供应商能力与资质归一（DB 套件无隔离库自跳过）
npx tsx src/lib/supplier-intel/__tests__/evidence-display.test.ts
npx tsx src/lib/supplier-intel/__tests__/supplier-intel-s3b-db.isolated.test.ts

# S4-A 评估运行 + 硬门（DB 套件无隔离库自跳过）
npx tsx src/lib/supplier-intel/__tests__/supplier-intel-s4a-db.isolated.test.ts
# S4-B：找厂优先级 / 评分组件 / 项目排名 read-model（纯核）+ 评分收口 DB 套件（隔离库，否则跳过）
npx tsx src/lib/supplier-intel/__tests__/discovery-priority.test.ts
npx tsx src/lib/supplier-intel/__tests__/score-components.test.ts
npx tsx src/lib/supplier-intel/__tests__/project-ranking-model.test.ts
npx tsx src/lib/supplier-intel/__tests__/score-breakdown-view.test.ts
npx tsx src/lib/supplier-intel/__tests__/supplier-intel-s4b-db.isolated.test.ts
npx tsx src/lib/supplier-intel/__tests__/supplier-intel-s3a-db.isolated.test.ts

# Mengxin FDE V1 — Revenue Spine（阶段状态机 / RFQ 抽取 / 评分与草稿守卫；DB e2e 无隔离库自动跳过）
npx tsx src/lib/revenue-spine/__tests__/opportunity-stage.test.ts
npx tsx src/lib/revenue-spine/__tests__/rfq-extract.test.ts
npx tsx src/lib/revenue-spine/__tests__/scoring-draft.test.ts
npx tsx src/lib/revenue-spine/__tests__/tricky-inquiries.test.ts
npx tsx src/lib/revenue-spine/__tests__/no-reply-followup.test.ts
npx tsx src/lib/revenue-spine/__tests__/booth-email.test.ts
npx tsx src/lib/revenue-spine/__tests__/commercial-facts.test.ts
npx tsx src/lib/trade/__tests__/message-normalize.test.ts
npx tsx src/lib/revenue-spine/__tests__/revenue-spine-db.isolated.test.ts
# 老板今日询盘 / 早报 / 新草稿提醒；微信回数字不批询盘回复；微信绑定只改本人（DB e2e 无隔离库自动跳过）
npx tsx src/lib/revenue-spine/__tests__/owner-today.test.ts
npx tsx src/lib/revenue-spine/__tests__/owner-brief.test.ts
npx tsx src/lib/ai-grader/actions/__tests__/wechat-confirm-scope.test.ts
npx tsx src/lib/messaging/__tests__/binding-preferences.test.ts
npx tsx src/lib/revenue-spine/__tests__/owner-today-db.isolated.test.ts

# 厂家入驻向导（PRD F6）：纯函数 + 路由静态契约；DB e2e 无隔离库自动跳过
npx tsx src/lib/organizations/__tests__/onboarding-rules.test.ts
npx tsx src/lib/organizations/__tests__/onboarding-db.isolated.test.ts
# 首响 SLA 分级提醒 / 工作时间日历 / SLA 指标（DB e2e 无隔离库自动跳过）
npx tsx src/lib/revenue-spine/__tests__/sla-tiers.test.ts
npx tsx src/lib/revenue-spine/__tests__/sla-metrics.test.ts
npx tsx src/lib/revenue-spine/__tests__/sla-tiers-db.isolated.test.ts
npx tsx src/lib/ai-grader/actions/__tests__/wechat-confirm-policy.test.ts
npx tsx src/lib/messaging/__tests__/binding-proof.test.ts
npx tsx src/lib/messaging/__tests__/wechat-binding-confirm-db.isolated.test.ts
npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts
npx tsx scripts/wave15-smoke-readonly.ts --self-check-only

npx tsx src/lib/ai/__tests__/client-tuning.test.ts
npx tsx src/lib/ai/model-policy/__tests__/flags.test.ts
npx tsx src/lib/ai/model-policy/__tests__/resolve.test.ts
npx tsx src/lib/ai/model-policy/__tests__/reasoning.test.ts
npx tsx src/lib/ai/model-policy/__tests__/compat.test.ts
npx tsx src/lib/ai/model-policy/__tests__/retry.test.ts
npx tsx src/lib/ai/model-policy/__tests__/guardrails.test.ts
npx tsx src/lib/ai/model-policy/__tests__/failure-modes.test.ts
npx tsx src/lib/ai/model-policy/__tests__/benchmark-harness.test.ts
npx tsx src/lib/ai/model-policy/__tests__/tender.test.ts
npx tsx src/lib/ai/model-policy/__tests__/tender-org-propagation.test.ts

# R1 架构边界冻结守卫（QYANE_RUNTIME_CONVERGENCE_T3_5）
bash scripts/test-runtime-architecture.sh

# 测试注册校验（fix-taskflow-status-drift）：只加进本 CI 子集、没注册进 scripts/test-all.sh 的测试文件直接让 CI 失败
bash scripts/check-test-registry.sh

echo ""
echo "CI unit subset PASS"
