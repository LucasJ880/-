/**
 * 锁定应用主滚动（AppShell 的滚动容器是 main，不是 body）。
 * 必须恢复 previous 内联样式，避免破坏其他合法状态。
 */

function asStyleHost(
  el: Element | null,
): { style: { overflow: string } } | null {
  if (!el || !("style" in el)) return null;
  const style = (el as { style?: { overflow?: string } }).style;
  if (!style || typeof style.overflow !== "string") return null;
  return el as { style: { overflow: string } };
}

export function lockAppScroll(): () => void {
  if (typeof document === "undefined") return () => {};

  const body = document.body;
  const html = document.documentElement;
  const main = asStyleHost(document.querySelector("main"));

  const previousBodyOverflow = body.style.overflow;
  const previousHtmlOverflow = html.style.overflow;
  const previousMainOverflow = main ? main.style.overflow : null;

  body.style.overflow = "hidden";
  html.style.overflow = "hidden";
  if (main) {
    main.style.overflow = "hidden";
  }

  return () => {
    body.style.overflow = previousBodyOverflow;
    html.style.overflow = previousHtmlOverflow;
    if (main && previousMainOverflow !== null) {
      main.style.overflow = previousMainOverflow;
    }
  };
}
