/**
 * i18n 消息结构定义
 *
 * 所有语言文件（zh.ts, en.ts）必须实现此接口
 */

export interface Messages {
  // 通用
  app_name: string;
  loading: string;
  save: string;
  cancel: string;
  confirm: string;
  delete: string;
  edit: string;
  create: string;
  search: string;
  export: string;
  copy: string;
  copied: string;
  close: string;
  back: string;
  more: string;
  collapse: string;
  expand: string;
  retry: string;
  submit: string;
  refresh: string;

  // 导航分组
  nav_group_workspace: string;
  nav_group_sales: string;
  nav_group_trade: string;
  nav_group_collaboration: string;
  nav_group_intelligence: string;
  nav_group_admin: string;
  nav_group_system: string;

  // 导航项
  nav_dashboard: string;
  nav_notifications: string;
  nav_tasks: string;
  nav_sales_pipeline: string;
  nav_quote_tool: string;
  nav_all_quotes: string;
  nav_appointment_calendar: string;
  nav_field_measure: string;
  nav_cockpit: string;
  nav_work_orders: string;
  nav_fabric_inventory: string;
  nav_sales_knowledge: string;
  nav_quote_sheet: string;
  nav_trade_dashboard: string;
  nav_trade_cockpit: string;
  nav_ai_assistant: string;
  nav_trade_quotes: string;
  nav_trade_import: string;
  nav_email_templates: string;
  nav_message_channels: string;
  nav_trade_knowledge: string;
  nav_trade_watch_signals: string;
  nav_organizations: string;
  nav_projects: string;
  nav_suppliers: string;
  nav_wechat_messages: string;
  nav_ai_memory: string;
  nav_ai_activity: string;
  nav_weekly_reports: string;
  nav_project_intake: string;
  nav_user_management: string;
  nav_invite_codes: string;
  nav_audit_logs: string;
  nav_orders_admin: string;
  nav_help: string;
  nav_settings: string;

  // Sidebar
  sidebar_expand: string;
  sidebar_collapse: string;
  sidebar_badge_industry: string;
  sidebar_badge_beta: string;
  sidebar_coming_soon: string;
  sidebar_manage_orgs: string;
  sidebar_org_members: string;
  sidebar_org_projects: string;

  // Header
  header_open_menu: string;
  header_search_placeholder: string;
  header_search_loading: string;
  header_search_no_results: string;
  header_search_tasks: string;
  header_search_projects: string;
  header_search_n_tasks: string;
  header_project_active: string;
  header_project_archived: string;
  header_notif_title: string;
  header_notif_only_unread: string;
  header_notif_show_unread: string;
  header_notif_mark_all_read: string;
  header_notif_empty: string;
  header_notif_no_unread: string;
  header_notif_all_clear: string;
  header_notif_mark_read: string;
  header_notif_mark_done: string;
  header_notif_preferences: string;
  header_notif_view_all: string;
  header_logout: string;

  // 状态
  status_active: string;
  status_completed: string;
  status_abandoned: string;
  status_todo: string;
  status_in_progress: string;
  status_done: string;
  status_cancelled: string;

  // 优先级
  priority_urgent: string;
  priority_high: string;
  priority_medium: string;
  priority_low: string;

  // 项目阶段
  stage_initiation: string;
  stage_distribution: string;
  stage_interpretation: string;
  stage_supplier_inquiry: string;
  stage_supplier_quote: string;
  stage_submission: string;

  // 错误
  error_unauthorized: string;
  error_forbidden: string;
  error_not_found: string;
  error_server: string;
  error_network: string;

  // 空状态
  empty_tasks: string;
  empty_projects: string;
  empty_notifications: string;
}

export type Locale = "zh" | "en";

export type MessageKey = keyof Messages;
