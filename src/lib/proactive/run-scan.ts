import { executeAutoActions } from "./auto-actions";
import { getUserAutomationPrefs } from "./automation-prefs";
import { syncSuggestionsToNotifications } from "./notify";
import { scanSalesForUser } from "./sales-scanner";
import { scanProjectsForUser } from "./scanner";

export async function runProactiveScanForUser(userId: string, userRole: string) {
  const [projectResult, salesSuggestions, prefs] = await Promise.all([
    scanProjectsForUser(userId, userRole),
    scanSalesForUser(userId),
    getUserAutomationPrefs(userId),
  ]);
  const suggestions = [...projectResult.suggestions, ...salesSuggestions];
  const notificationsCreated = await syncSuggestionsToNotifications(userId, suggestions);
  const autoActions = prefs.enabled
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
