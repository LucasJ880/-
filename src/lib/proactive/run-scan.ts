import { executeAutoActions } from "./auto-actions";
import { getUserAutomationPrefs } from "./automation-prefs";
import { syncSuggestionsToNotifications } from "./notify";
import { scanSalesForUser } from "./sales-scanner";
import { scanProjectsForUser } from "./scanner";

/**
 * 为一个用户跑一次主动扫描：扫项目 / 销售 → urgent / warning 建议写通知（按 dedupeKey 去重）→ 开了自动化偏好时执行低风险自动动作。
 * options.autoActions = false：只扫描、只写通知，不执行任何自动动作（定时任务为管理层补发用，A-3b）。不传时行为不变。
 */
export async function runProactiveScanForUser(userId: string, userRole: string, options?: { autoActions?: boolean }) {
  const [projectResult, salesSuggestions, prefs] = await Promise.all([
    scanProjectsForUser(userId, userRole),
    scanSalesForUser(userId),
    getUserAutomationPrefs(userId),
  ]);
  const suggestions = [...projectResult.suggestions, ...salesSuggestions];
  const notificationsCreated = await syncSuggestionsToNotifications(userId, suggestions);
  const autoActions = prefs.enabled && options?.autoActions !== false
    ? await executeAutoActions(userId, suggestions, prefs)
    : [];

  return {
    ...projectResult,
    suggestions,
    notificationsCreated,
    autoActions,
    automationEnabled: prefs.enabled,
  };
}
