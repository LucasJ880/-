/**
 * 浏览器 Notification API 封装
 *
 * P0 范围：15分钟内日程 + followup 到期提醒。
 */

export function requestNotificationPermission(): void {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

export function canNotify(): boolean {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window)) return false;
  return Notification.permission === "granted";
}

export function showNotification(
  title: string,
  body: string,
  onClick?: () => void
): void {
  if (!canNotify()) return;

  const n = new Notification(title, {
    body,
    icon: "/favicon.ico",
    tag: body,
  });

  if (onClick) {
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  }

  setTimeout(() => n.close(), 10_000);
}
