"use client";

import Link from "next/link";
import { ArrowLeft, ImagePlus, Images, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";

export default function SalesMaterialsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="素材库"
        description="集中管理现场照片、建模参考图和后续 Visualizer 素材"
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

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-white/70 p-4">
          <Images className="h-6 w-6 text-purple-600" />
          <h3 className="mt-3 text-sm font-semibold text-foreground">现场照片</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            用于主画布预览、窗户区域识别和方案封面导出。
          </p>
        </div>
        <div className="rounded-xl border border-border bg-white/70 p-4">
          <ImagePlus className="h-6 w-6 text-blue-600" />
          <h3 className="mt-3 text-sm font-semibold text-foreground">建模参考照片</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            后续可上传房间全景、窗框侧面、轨道细节、旧窗帘现状等参考素材。
          </p>
        </div>
        <div className="rounded-xl border border-border bg-white/70 p-4">
          <Sparkles className="h-6 w-6 text-amber-600" />
          <h3 className="mt-3 text-sm font-semibold text-foreground">素材处理</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            支持窗户区域识别、旧窗帘清理、高清渲染和空间方案展示。
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-purple-200 bg-purple-50/60 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white text-purple-700">
          <Images className="h-6 w-6" />
        </div>
        <h3 className="mt-3 text-sm font-semibold text-foreground">销售素材归档</h3>
        <p className="mx-auto mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
          按客户、商机和可视化方案统一归档现场照片与建模参考素材。
        </p>
      </div>
    </div>
  );
}
