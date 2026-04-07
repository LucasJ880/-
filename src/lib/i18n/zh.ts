/**
 * 中文文案集中管理 — i18n 预留
 *
 * 当前阶段：把最高频的 UI 文案集中在此，方便后续扩展多语言。
 * 未来接入 i18n 框架时，只需将此文件替换为 locale loader。
 *
 * 使用方式：import { t } from "@/lib/i18n/zh";
 */

export const t = {
  // 通用
  app_name: "青砚",
  loading: "加载中...",
  save: "保存",
  cancel: "取消",
  confirm: "确认",
  delete: "删除",
  edit: "编辑",
  create: "创建",
  search: "搜索",
  export: "导出",
  copy: "复制",
  copied: "已复制",
  close: "关闭",
  back: "返回",
  more: "更多",
  collapse: "收起",
  expand: "展开",
  retry: "重试",
  submit: "提交",
  refresh: "刷新",

  // 导航
  nav_dashboard: "工作台",
  nav_tasks: "任务",
  nav_projects: "项目",
  nav_assistant: "AI 助手",
  nav_calendar: "日历",
  nav_notifications: "通知",
  nav_settings: "设置",
  nav_reports: "周报",

  // 状态
  status_active: "进行中",
  status_completed: "已完成",
  status_abandoned: "已放弃",
  status_todo: "待办",
  status_in_progress: "进行中",
  status_done: "已完成",
  status_cancelled: "已取消",

  // 优先级
  priority_urgent: "紧急",
  priority_high: "高",
  priority_medium: "中",
  priority_low: "低",

  // 项目阶段
  stage_initiation: "立项",
  stage_distribution: "项目分发",
  stage_interpretation: "项目解读",
  stage_supplier_inquiry: "供应商询价",
  stage_supplier_quote: "供应商报价",
  stage_submission: "项目提交",

  // 错误
  error_unauthorized: "未登录",
  error_forbidden: "无权执行此操作",
  error_not_found: "资源不存在",
  error_server: "服务器内部错误",
  error_network: "网络连接失败，请检查网络",

  // 空状态
  empty_tasks: "暂无任务",
  empty_projects: "暂无项目",
  empty_notifications: "暂无通知",
} as const;

export type TranslationKey = keyof typeof t;
