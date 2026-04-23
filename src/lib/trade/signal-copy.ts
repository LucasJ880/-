/**
 * P1-alpha：变化信号固定文案（弱信号、需人工复核；strength 由调用方固定 low）
 */

export const WATCH_PAGE_TYPES = [
  "products",
  "collections",
  "news",
  "blog",
  "about",
  "careers",
  "custom",
] as const;

export type WatchPageType = (typeof WATCH_PAGE_TYPES)[number];

export function isWatchPageType(s: string): s is WatchPageType {
  return (WATCH_PAGE_TYPES as readonly string[]).includes(s);
}

/** 页面文本 hash 与上次不同 → 仅表示监测到变化 */
export function signalTitleForPageType(pageType: string): string {
  switch (pageType) {
    case "products":
      return "产品页文本已变化";
    case "collections":
      return "集合页文本已变化";
    case "news":
      return "新闻/公告页文本已变化";
    case "blog":
      return "博客页文本已变化";
    case "about":
      return "公司介绍页文本已变化";
    case "careers":
      return "招聘页文本已变化";
    default:
      return "页面文本已变化";
  }
}

export function signalDescriptionForPageType(pageType: string): string {
  const tail = "此为弱信号，不能替代您亲自打开链接核对；系统未判断具体改动内容。";

  switch (pageType) {
    case "products":
      return `监测到该 URL 页面文本与上次快照不一致。可能与产品信息或上新相关，也可能为排版、库存文案等无关调整。${tail}`;
    case "collections":
      return `监测到该 URL 页面文本与上次快照不一致。可能与类目/系列展示有关，不能推断已上架新品。${tail}`;
    case "news":
      return `监测到该 URL 页面文本与上次快照不一致。可能有新闻或公告更新。${tail}`;
    case "blog":
      return `监测到该 URL 页面文本与上次快照不一致。可能有博客内容更新。${tail}`;
    case "about":
      return `监测到该 URL 页面文本与上次快照不一致。可能有公司信息或表述更新。${tail}`;
    case "careers":
      return `监测到该 URL 页面文本与上次快照不一致。可能与招聘/团队页面更新相关，不能推断业务规模变化。${tail}`;
    default:
      return `监测到该 URL 页面文本与上次快照不一致，原因多样。${tail}`;
  }
}
