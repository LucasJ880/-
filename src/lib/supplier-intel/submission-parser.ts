/**
 * 用户提交解析器（层 A USER_SUBMITTED / 层 C MANUAL_ENTRY）
 *
 * 安全边界（B.1 §16/§17，T19）：
 *   - 本模块**永不发起网络请求**——不 fetch、不 DNS、不打开 URL。用户提交的 URL
 *     只做纯字符串解析与平台归类；解析不到的元数据一律 null，禁止猜。
 *     服务器绝不把 user-submitted URL 变成 SSRF primitive。
 *   - scheme 白名单 http/https；长度上限见 SUPPLIER_INTEL_LIMITS。
 */

import {
  SIGNAL_PLATFORMS,
  SUPPLIER_INTEL_LIMITS,
  type SignalPlatform,
} from "./constants";
import { SupplierIntelError } from "./errors";

export interface ParsedSubmission {
  platform: SignalPlatform;
  contentType: "USER_SUBMITTED";
  contentUrl: string | null;
  rawText: string | null;
  /** 以下字段 S1 不做抓取，解析不到即 null（禁止猜） */
  accountName: null;
  accountUrl: null;
  title: null;
  description: null;
  publishedAt: null;
}

const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/i;

function classifyHost(url: URL): SignalPlatform {
  const host = url.hostname.toLowerCase();
  const matches = (domain: string) => host === domain || host.endsWith(`.${domain}`);

  if (matches("douyin.com") || matches("iesdouyin.com")) return "DOUYIN";
  if (matches("xiaohongshu.com") || matches("xhslink.com")) return "XIAOHONGSHU";
  if (matches("channels.weixin.qq.com")) return "WECHAT_CHANNELS";
  if (matches("weixin.qq.com") && url.pathname.toLowerCase().startsWith("/sph")) {
    return "WECHAT_CHANNELS";
  }
  if (matches("1688.com")) return "ONE688";
  return "WEBSITE";
}

function parseCandidateUrl(raw: string): URL {
  if (raw.length > SUPPLIER_INTEL_LIMITS.URL_MAX_LENGTH) {
    throw new SupplierIntelError(
      "URL_TOO_LONG",
      `URL 超出上限 ${SUPPLIER_INTEL_LIMITS.URL_MAX_LENGTH} 字符`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SupplierIntelError("INVALID_URL_SCHEME", "URL 无法解析");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SupplierIntelError(
      "INVALID_URL_SCHEME",
      `仅支持 http/https 链接（收到 ${parsed.protocol}）`,
    );
  }
  return parsed;
}

/**
 * 解析用户提交（链接和/或粘贴文案）。纯函数：零网络、零副作用。
 * - url 缺失时从 rawText 提取第一个 http(s) 链接（微信分享文案常见形态）；
 * - 完全无链接的手工线索 → platform=MANUAL。
 */
export function parseUserSubmission(input: {
  url?: string | null;
  rawText?: string | null;
}): ParsedSubmission {
  const urlRaw = (input.url ?? "").trim();
  const rawText = (input.rawText ?? "").trim();

  if (!urlRaw && !rawText) {
    throw new SupplierIntelError("EMPTY_SUBMISSION", "请提供链接或粘贴分享文案");
  }
  if (rawText.length > SUPPLIER_INTEL_LIMITS.RAW_TEXT_MAX_LENGTH) {
    throw new SupplierIntelError(
      "RAW_TEXT_TOO_LONG",
      `文本超出上限 ${SUPPLIER_INTEL_LIMITS.RAW_TEXT_MAX_LENGTH} 字符`,
    );
  }

  let effectiveUrl: URL | null = null;
  if (urlRaw) {
    effectiveUrl = parseCandidateUrl(urlRaw);
  } else {
    const found = rawText.match(URL_IN_TEXT)?.[0];
    if (found) {
      // 文案里嵌的链接同样过 scheme/长度校验；超限/非法时不猜、不截断出错误来源——直接拒收
      effectiveUrl = parseCandidateUrl(found);
    }
  }

  const platform: SignalPlatform = effectiveUrl ? classifyHost(effectiveUrl) : "MANUAL";

  return {
    platform,
    contentType: "USER_SUBMITTED",
    contentUrl: effectiveUrl ? effectiveUrl.toString() : null,
    rawText: rawText || null,
    accountName: null,
    accountUrl: null,
    title: null,
    description: null,
    publishedAt: null,
  };
}

/** 目录自检（供测试引用，防止 classifyHost 返回目录外值） */
export function isKnownPlatform(v: string): v is SignalPlatform {
  return (SIGNAL_PLATFORMS as readonly string[]).includes(v);
}
