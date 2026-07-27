"use client";

import { PageHeader } from "@/components/page-header";
import { AppearanceThemePicker } from "@/components/appearance-theme-picker";
import { useUiTheme } from "@/lib/theme";

export default function AppearanceSettingsPage() {
  const { themeLabel } = useUiTheme();

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <PageHeader
          title="外观"
          description="在经典版与新视觉版之间切换。偏好保存在本机浏览器，立即生效。"
        />
      </div>

      <section className="rounded-xl border border-border bg-card-bg p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">界面风格</h2>
            <p className="mt-1 text-xs text-muted">当前：{themeLabel}</p>
          </div>
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
            全站生效
          </span>
        </div>
        <AppearanceThemePicker />
        <p className="mt-4 text-xs leading-relaxed text-muted">
          新视觉版为基础主题框架（深色玻璃拟态 tokens）。后续会逐步细化任务页与组件皮肤，不会改变业务逻辑。
        </p>
      </section>
    </div>
  );
}
