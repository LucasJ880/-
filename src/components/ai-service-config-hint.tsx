import Link from "next/link";
import { Bot, BookOpen, Settings } from "lucide-react";
import { AI_CONFIG_ENV_SNIPPET, AI_CONFIG_INTRO } from "@/lib/copy/ai-config";

type Variant = "full" | "compact";

export function AiServiceConfigHint({ variant = "full" }: { variant?: Variant }) {
  if (variant === "compact") {
    return (
      <div className="rounded-[var(--radius-md)] border border-[rgba(45,106,122,0.25)] bg-[rgba(45,106,122,0.1)] px-4 py-3 text-sm text-foreground">
        <p className="font-medium text-foreground">
          未检测到可用的 AI API 配置
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          本地开发：在项目根目录配置 <code className="rounded bg-card-bg px-1 font-mono text-[11px]">.env</code>
          ；线上部署：在 Vercel（或你的托管平台）填写{" "}
          <code className="rounded bg-card-bg px-1 font-mono text-[11px]">OPENAI_API_KEY</code> 等环境变量。
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <a
            href="https://vercel.com/docs/projects/environment-variables"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-accent hover:text-accent-hover"
          >
            Vercel 环境变量文档 ↗
          </a>
          <Link href="/assistant" className="font-medium text-accent hover:text-accent-hover">
            查看完整配置说明
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-xl)] bg-gradient-to-br from-[#2d6a7a] to-[#2b6055] text-white shadow-card">
        <Bot size={32} />
      </div>
      <h2 className="text-xl font-bold tracking-tight text-foreground">配置 AI 服务</h2>
      <p className="text-sm leading-relaxed text-muted">{AI_CONFIG_INTRO}</p>
      <ul className="w-full space-y-2 rounded-[var(--radius-lg)] border border-border bg-card-bg p-4 text-left text-sm text-foreground shadow-card">
        <li className="flex gap-2">
          <span className="mt-0.5 font-mono text-xs text-accent">①</span>
          <span>
            <strong>本地开发</strong>：复制{" "}
            <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">.env.example</code>{" "}
            为 <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">.env</code>
            ，填写下方变量后重启 <code className="font-mono text-xs">npm run dev</code>。
          </span>
        </li>
        <li className="flex gap-2">
          <span className="mt-0.5 font-mono text-xs text-accent">②</span>
          <span>
            <strong>线上（Vercel 等）</strong>：在项目 →{" "}
            <strong>Settings → Environment Variables</strong> 添加{" "}
            <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">OPENAI_API_KEY</code>、
            <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">OPENAI_BASE_URL</code>、
            <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">OPENAI_MODEL</code>
            ，保存后重新部署（Redeploy）。
          </span>
        </li>
      </ul>
      <div className="w-full rounded-[var(--radius-lg)] border border-border bg-card-bg p-4 text-left shadow-card">
        <pre className="overflow-x-auto text-xs leading-6 text-foreground">
          {AI_CONFIG_ENV_SNIPPET}
        </pre>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted">
        <a
          href="https://vercel.com/docs/projects/environment-variables"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-accent hover:text-accent-hover"
        >
          <BookOpen size={12} />
          Vercel 环境变量
        </a>
        <span className="text-border">|</span>
        <span>仓库内可参考 docs/DEPLOY_VERCEL.md</span>
      </div>
      <Link
        href="/"
        className="mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm transition-colors hover:bg-background"
      >
        <Settings size={14} />
        返回工作台
      </Link>
    </div>
  );
}
