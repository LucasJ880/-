/**
 * 模型起草的 HTML 在页面上预览前的净化（openspec change ai-html-preview-no-autoload，
 * spec agents/ai-output-rendering）。
 *
 * 两层：
 * 1. DOMPurify 按标签 / 属性允许清单去掉脚本与危险属性；
 * 2. 在它返回的 DOM 上再处理两样会让浏览器「不经点击就发请求」的东西：
 *    - 图片：与 Markdown 渲染同一套判定（src/lib/ai-markdown/url-policy.ts），只放行站内文件代理
 *      （/api/files/）之下的地址；其余整个元素换成一段不可点击的文字提示；
 *    - 内联样式：去掉任何能加载资源的声明（src/lib/common/inline-style-policy.ts）。
 *
 * 只影响预览怎么显示，不改发出去的邮件。
 * 没有浏览器环境（服务端渲染）时返回空字符串——不放行原文。
 */
import DOMPurify from "dompurify";
import { blockedImageLabel, classifyAiImageSrc } from "@/lib/ai-markdown/url-policy";
import { sanitizeInlineStyle } from "@/lib/common/inline-style-policy";

const ALLOWED_TAGS = [
  "p", "br", "b", "i", "u", "strong", "em", "a", "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code",
  "span", "div", "table", "thead", "tbody", "tr", "th", "td",
  "img", "hr",
];
const ALLOWED_ATTR = ["href", "src", "alt", "title", "class", "style", "target", "rel"];

/** 图片：放行的改成规范化后的站内路径；不放行的换成只含文字的 span */
function guardImages(root: HTMLElement): void {
  for (const img of Array.from(root.querySelectorAll("img"))) {
    const decision = classifyAiImageSrc(img.getAttribute("src"));
    if (decision.allowed) {
      img.setAttribute("src", decision.src);
      continue;
    }
    const note = root.ownerDocument.createElement("span");
    note.setAttribute("data-html-preview", "blocked-image");
    note.textContent = blockedImageLabel(img.getAttribute("alt"), decision.host);
    img.replaceWith(note);
  }
}

/** 内联样式：只留不加载资源的声明；一条不剩就去掉属性 */
function guardInlineStyles(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll("[style]"))) {
    const safe = sanitizeInlineStyle(el.getAttribute("style"));
    if (safe) el.setAttribute("style", safe);
    else el.removeAttribute("style");
  }
}

export function sanitizeHtml(dirty: string): string {
  if (typeof window === "undefined") return "";
  // DOMPurify 在惰性文档里解析，拿到的 DOM 还没有挂进页面，这一步不会触发任何加载
  const root = DOMPurify.sanitize(dirty, { ALLOWED_TAGS, ALLOWED_ATTR, RETURN_DOM: true }) as unknown as HTMLElement;
  guardImages(root);
  guardInlineStyles(root);
  return root.innerHTML;
}
