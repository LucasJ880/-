/**
 * 模型输出的统一 Markdown 渲染（openspec change ai-markdown-image-allowlist，
 * spec agents/ai-output-rendering）。
 *
 * 所有把模型或外部系统产出的 Markdown 渲染到页面上的地方都必须用这个组件，
 * 不要直接引入 react-markdown——`src/components/__tests__/ai-markdown.test.tsx`
 * 会扫描全仓库并在出现第二处直接引入时失败。
 *
 * 规则（判定在 src/lib/ai-markdown/url-policy.ts）：
 * - 图片只放行站内文件代理（/api/files/）之下的地址；其余不生成任何会自动加载的元素，
 *   原位置显示一段不可点击的文字提示。
 * - 链接保持可点击；外部链接在新标签页打开、不带来源页与窗口句柄，并显示真实主机名。
 * - `img` 与 `a` 两项由本组件固定，调用方传入的同名覆盖项不生效。
 */
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  blockedImageLabel,
  classifyAiImageSrc,
  classifyAiLinkHref,
  linkHostSuffix,
} from "@/lib/ai-markdown/url-policy";

export type AiMarkdownComponents = Components;

const REMARK_PLUGINS = [remarkGfm];

/** 语法节点里的全部文字（不依赖 React 子节点的形状）。 */
function nodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; value?: unknown; children?: unknown };
  if (n.type === "text" && typeof n.value === "string") return n.value;
  return Array.isArray(n.children) ? n.children.map(nodeText).join("") : "";
}

const GUARDED: Components = {
  img({ src, alt }) {
    const decision = classifyAiImageSrc(src);
    if (!decision.allowed) {
      return (
        <span data-ai-md="blocked-image" className="text-xs text-muted">
          {blockedImageLabel(alt, decision.host)}
        </span>
      );
    }
    return (
      // /api/files 是鉴权代理，不走图片优化
      // eslint-disable-next-line @next/next/no-img-element
      <img src={decision.src} alt={alt ?? ""} loading="lazy" className="max-w-full rounded-md" />
    );
  },
  a({ href, title, children, node }) {
    const info = classifyAiLinkHref(href);
    if (!info.external) {
      return (
        <a href={href} title={title}>
          {children}
        </a>
      );
    }
    const suffix = linkHostSuffix(nodeText(node), info.host);
    return (
      <>
        <a href={href} title={title} target="_blank" rel="noopener noreferrer nofollow">
          {children}
        </a>
        {suffix ? (
          <span data-ai-md="link-host" className="text-xs text-muted">
            （{suffix}）
          </span>
        ) : null}
      </>
    );
  },
};

/** 调用方覆盖项 + 固定的 img / a；后者最后合并，调用方换不掉。按引用缓存合并结果。 */
const mergedCache = new WeakMap<Components, Components>();
function withGuards(components: Components | undefined): Components {
  if (!components) return GUARDED;
  let merged = mergedCache.get(components);
  if (!merged) {
    merged = { ...components, ...GUARDED };
    mergedCache.set(components, merged);
  }
  return merged;
}

export function AiMarkdown({
  children,
  components,
}: {
  /** 模型或外部系统产出的 Markdown 文本 */
  children: string;
  /** 调用方的渲染覆盖项；其中的 img / a 不生效 */
  components?: Components;
}): ReactNode {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={withGuards(components)}>
      {children}
    </ReactMarkdown>
  );
}
