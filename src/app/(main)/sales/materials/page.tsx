"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ImagePlus, Images, Sparkles, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

interface SuiteCard {
  id: string;
  name: string;
  category: string;
  description: string;
  shotCount: number;
  previewImage: string | null;
  fidelityRules: string[];
}

export default function SalesMaterialsPage() {
  const [suites, setSuites] = useState<SuiteCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch("/api/product-content/templates");
        if (!res.ok) {
          if (!cancelled) setSuites([]);
          return;
        }
        const data = (await res.json()) as { suites?: SuiteCard[] };
        if (!cancelled) setSuites(data.suites ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="素材库"
        description="集中管理现场照片、建模参考图，以及可复用的产品套图模版库"
        actions={
          <Link
            href="/sales/cockpit"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={15} />
            返回销售分析
          </Link>
        }
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">产品套图模版库</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              可扩展注册多套构图模板。本页列出已接入套图；后续可继续追加品类，不限于浴袍
              Amazon 套图。
            </p>
          </div>
          <Link
            href="/product-content"
            className="text-xs font-medium text-primary hover:underline"
          >
            打开产品内容 →
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-white/70 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 加载模版库…
          </div>
        ) : suites.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-white/50 px-4 py-6 text-sm text-muted-foreground">
            暂无已注册套图模板
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {suites.map((suite) => (
              <div
                key={suite.id}
                className="overflow-hidden rounded-xl border border-border bg-white/80"
              >
                {suite.previewImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={suite.previewImage}
                    alt=""
                    className="h-36 w-full object-cover"
                  />
                ) : (
                  <div className="flex h-36 items-center justify-center bg-muted/40">
                    <Sparkles className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold">{suite.name}</h3>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {suite.shotCount} 张
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {suite.description}
                  </p>
                  {suite.fidelityRules?.[0] && (
                    <p className="text-[11px] text-muted-foreground">
                      规则示例：{suite.fidelityRules[0]}
                    </p>
                  )}
                  <Link
                    href={`/product-content?suite=${encodeURIComponent(suite.id)}`}
                    className="inline-flex rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                  >
                    用于产品内容
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-white/70 p-4">
          <Images className="h-6 w-6 text-blue-600" />
          <h3 className="mt-3 text-sm font-semibold text-foreground">现场照片</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            用于主画布预览、窗户区域识别和方案封面导出。
          </p>
        </div>
        <div className="rounded-xl border border-border bg-white/70 p-4">
          <ImagePlus className="h-6 w-6 text-sky-700" />
          <h3 className="mt-3 text-sm font-semibold text-foreground">建模参考照片</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            后续可上传房间全景、窗框侧面、轨道细节、旧窗帘现状等参考素材。
          </p>
        </div>
        <div className="rounded-xl border border-border bg-white/70 p-4">
          <Sparkles className="h-6 w-6 text-amber-600" />
          <h3 className="mt-3 text-sm font-semibold text-foreground">套图产出</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            在产品内容任务页选择模版、上传四槽产品图并生成套图，结果写入任务视觉列表。
          </p>
        </div>
      </div>
    </div>
  );
}
