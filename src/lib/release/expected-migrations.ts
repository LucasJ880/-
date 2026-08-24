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
  // 字典序：P1.5(0811050000) < P1.6(0814090000) < T4(0814150000) < A0(0814220000) < A1P0(0815010000)
  "20260811050000_add_project_financial_control",
  "20260814090000_add_tender_profitability_settlement",
  "20260814150000_add_tender_t4_award_record_foundation",
  "20260814220000_add_autopilot_a0_foundation",
  "20260815010000_add_autopilot_a1_p0_telemetry_outbox",
  "20260816060000_add_document_page_unit_metadata",
  "20260819190000_add_autopilot_a2_p0_evaluation",
  "20260821150000_add_quote_cost_engine_phase1",
  "20260821233000_add_quote_operations_phase2",
  "20260824170000_add_mention_gateway_external_identity",
] as const;

export type ExpectedMigrationName = (typeof EXPECTED_ACTIVE_MIGRATIONS)[number];

/**
 * Greenfield 重基线**之前**已在生产应用、之后被归档到
 * `prisma/migrations_legacy_pre_greenfield_baseline/` 的历史迁移。
 *
 * 它们仍然合法地留在生产 `_prisma_migrations` 里，因此漂移检查必须把它们视为
 * 「已知的多余项」——否则每次检查都会误报 85 条（本清单即由该目录生成）。
 */
export const ARCHIVED_MIGRATIONS = [
  "20260318200000_add_project_discussion",
  "20260319230000_init_postgresql",
  "20260320120000_add_auth_provider_and_indexes",
  "20260416120000_baseline_before_launch",
  "20260417000000_user_sales_rep_initials",
  "20260417010000_quote_discount_settings",
  "20260417020000_quote_discount_tracking",
  "20260418010000_promo_thresholds",
  "20260419010000_pending_action",
  "20260420010000_customer_permissions",
  "20260421010000_deposit_thresholds",
  "20260422010000_sales_quote_deposit",
  "20260422130000_quote_agreed_payment",
  "20260423090000_trade_watch_p1_alpha",
  "20260424180000_add_visualizer_mvp",
  "20260429120000_trade_research_confidence",
  "20260429140000_trade_prospect_sales_conversion",
  "20260429180000_sales_core_org_id",
  "20260429200000_sales_quote_source_trade_quote_id",
  "20260429210000_trade_intelligence_case",
  "20260430103000_trade_intelligence_asset",
  "20260507150000_visualizer_catalog_product",
  "20260618000000_sales_orgid_not_null",
  "20260618200000_trade_service_request",
  "20260618210000_wechat_gateway_trade_intake",
  "20260618220000_wechat_context",
  "20260623180000_wechat_grader_context",
  "20260705000000_drop_tool_execution",
  "20260708040000_service_inbox",
  "20260708160000_quote_pdf_paths",
  "20260712200000_ops_matrix_pipeline",
  "20260712230000_brand_profile",
  "20260713000000_content_plan",
  "20260713010000_account_tier",
  "20260713030000_company_cobrand",
  "20260715010000_market_intelligence_monitoring",
  "20260715020000_automation_reliability",
  "20260715030000_visualizer_catalog_assets",
  "20260717090000_growth_center_phase1",
  "20260718110000_marketing_automation_mmm",
  "20260718170000_market_research_jobs",
  "20260718193000_marketing_team_approval",
  "20260719193000_content_plan_intel_source",
  "20260719210000_org_knowledge_vector",
  "20260719220000_agent_session_run",
  "20260719230000_user_memory_org_id",
  "20260719240000_agent_run_queue",
  "20260719250000_pending_action_agent_run",
  "20260719260000_project_ai_phase1",
  "20260719270000_org_project_rules_phase2",
  "20260720010000_project_duty_and_milestones",
  "20260720020000_user_active_org",
  "20260720150000_marketing_pmc_json",
  "20260720180000_agent_run_supervisor_state",
  "20260721010000_employee_ai_learning_phase1",
  "20260721020000_user_memory_supersede_timeline",
  "20260721120000_product_content_director_phase1",
  "20260721140000_product_content_acceptance",
  "20260721180000_tenancy_workspace_modules",
  "20260721190000_phase2a_org_rules_industry_pack",
  "20260721200000_phase2b_business_semantics",
  "20260721210000_rename_line_discount_unlock_hash",
  "20260722190000_phase3a1_agent_run_trace_ids",
  "20260722195000_phase3a2_ai_usage_ledger",
  "20260722198000_phase3a3_approvals_integrity",
  "20260722201000_phase3a4_governance_quotas_audit",
  "20260723010000_security1_org_access_mode",
  "20260723020000_security1_org_owner",
  "20260723030000_security1_role_profiles",
  "20260723040000_security1_fix_org_switch_grants",
  "20260723120000_phase3b_bind_ai_threads_to_org",
  "20260724120000_agent_runtime_v2_steps",
  "20260724160000_project_fact_memory_phase2",
  "20260724170000_project_orchestrator_task_lease",
  "20260724180000_pending_action_idempotency_key",
  "20260724190000_project_orchestrator_3i_persistence",
  "20260724200000_agent_task_cancel_requested_at",
  "20260725010000_phase4_bid_data_layer",
  "20260725020000_phase4a2_bid_data_review",
  "20260725030000_phase4a2_pricing_line_reviewer_note",
  "20260725120000_visualizer_catalog_template",
  "20260727200000_sales_monthly_target",
  "20260728010000_task_waiting_blocked_fields",
  "20260728120000_project_work_domain",
  "20260728180000_project_handoff",
] as const;
