"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { VinylOrderForm } from "@/components/vinyl-order-form";

export default function NewVinylOrderPage() {
  return (
    <div className="mx-auto max-w-7xl p-6">
      <Link href="/vinyl-orders" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft size={15} /> 返回工艺单列表
      </Link>
      <h1 className="mb-6 text-2xl font-bold text-foreground">新建 Vinyl 工艺单</h1>
      <VinylOrderForm />
    </div>
  );
}
