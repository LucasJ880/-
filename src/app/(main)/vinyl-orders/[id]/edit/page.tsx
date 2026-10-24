"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";
import {
  VinylOrderForm,
  type VinylFormItem,
  type VinylFormOrder,
} from "@/components/vinyl-order-form";

interface OrderData {
  id: string;
  code: string;
  status: string;
  customerName: string;
  phone: string | null;
  address: string | null;
  installDate: string | null;
  remarks: string | null;
  louverSize: number;
  color: string;
  items: {
    location: string;
    width: number;
    height: number;
    panelCount: number;
    panelCode: string;
    dividerSpec: string | null;
    specialMidRail: number | null;
    midRailRatio: number | null;
    tiltRodPosition: string | null;
    frameType: string;
    frameCount: string;
    inOut: string;
    structure: string;
    itemRemark: string | null;
  }[];
}

const s = (v: number | null | undefined) => (v == null ? "" : String(v));

export default function EditVinylOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson<OrderData>(`/api/vinyl/orders/${id}`)
      .then(setOrder)
      .catch(() => setOrder(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        <Loader2 size={20} className="animate-spin" />
        <span className="ml-2">加载中...</span>
      </div>
    );
  }
  if (!order) {
    return <div className="mx-auto max-w-4xl p-6 text-danger">工艺单不存在</div>;
  }

  const initialOrder: VinylFormOrder = {
    code: order.code,
    customerName: order.customerName,
    phone: order.phone ?? "",
    address: order.address ?? "",
    installDate: order.installDate ?? "",
    remarks: order.remarks ?? "",
    louverSize: String(order.louverSize),
    color: order.color ?? "白色",
  };

  const initialItems: VinylFormItem[] = order.items.map((it) => {
    // dividerSpec "2T" → 数量 2 + 柱型 T；解析不出就留空，让人重填而不是猜
    const m = /^(\d+)\s*([TH])$/i.exec(String(it.dividerSpec ?? "").trim());
    return {
      key: crypto.randomUUID(),
      location: it.location,
      width: s(it.width),
      height: s(it.height),
      panelCount: s(it.panelCount),
      panelCode: it.panelCode,
      dividerCount: m ? m[1] : "",
      dividerType: m ? m[2].toUpperCase() : "",
      specialMidRail: s(it.specialMidRail),
      midRailRatio: s(it.midRailRatio),
      tiltRodPosition: it.tiltRodPosition ?? "",
      frameType: it.frameType,
      frameCount: it.frameCount,
      inOut: it.inOut,
      structure: it.structure,
      itemRemark: it.itemRemark ?? "",
    };
  });

  return (
    <div className="mx-auto max-w-7xl p-6">
      <Link href={`/vinyl-orders/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft size={15} /> 返回工艺单
      </Link>
      <h1 className="mb-6 font-mono text-2xl font-bold text-foreground">编辑 {order.code}</h1>
      <VinylOrderForm
        mode="edit"
        orderId={id}
        orderStatus={order.status}
        initialOrder={initialOrder}
        initialItems={initialItems}
      />
    </div>
  );
}
