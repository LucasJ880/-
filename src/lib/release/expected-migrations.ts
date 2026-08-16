/**
 * 当前代码期望的 active migration 全集（**单一事实源**）
 *
 * 两类消费者共用同一份列表，避免"改了一处忘了另一处"：
 *   - 构建期治理：scripts/verify-migration-history.ts（顺序 + checksum 不可变）
 *   - 运行期漂移检查：src/lib/release/drift.ts（生产库缺哪些迁移）
 *
 * 新增 migration 时必须同时：
 *   1. 追加到本数组（保持字典序）
 *   2. 在 scripts/verify-migration-history.ts 的 IMMUTABLE 登记 sha256
 *   3. 在 scripts/check-release-safety.test.ts 的名单里追加
 */
export const EXPECTED_ACTIVE_MIGRATIONS = [
  "00000000000000_greenfield_baseline_pre_phase4",
  "20260728120000_project_work_domain",
  "20260728180000_project_handoff",
  "20260729120000_matrix_account_playbook",
  "20260729180000_phase_c_publish_job_pipeline",
  "20260803200000_bid_workflow_phase1",
  "20260804130000_sunny_motor_price",
  "20260804190000_sales_action_loop",
  "20260804200000_sales_action_auto_sync",
  "20260804210000_sales_effectiveness_promotion_approval",
  "20260805090000_marketing_economics",
  "20260805180000_tender_auto_analysis_phase1_1",
  "20260811002000_add_tender_t2_ledger_archive_foundation",
  "20260811040000_add_tender_t3_corporate_memory_foundation",
  // 字典序：P1.5(0811050000) < T4(0814150000) < A0(0814220000) < A1P0(0815010000)
  "20260811050000_add_project_financial_control",
  "20260814150000_add_tender_t4_award_record_foundation",
  "20260814220000_add_autopilot_a0_foundation",
  "20260815010000_add_autopilot_a1_p0_telemetry_outbox",
  "20260816060000_add_document_page_unit_metadata",
] as const;

export type ExpectedMigrationName = (typeof EXPECTED_ACTIVE_MIGRATIONS)[number];
